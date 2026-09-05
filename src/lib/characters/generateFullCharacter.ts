import type { ChatBackend } from '@/lib/api/chatBackend'
import type { Outfit } from '@/lib/vn/outfits'
import type { CharacterCardData, Lorebook, LorebookEntry } from './cardSpec'
import {
  draftCharacterBonds,
  draftCharacterFromBrief,
  draftCharacterFromPortrait,
  draftCharacterOutfits,
  draftCharacterProfile,
  suggestLoreEntries,
  type AiLoreSubject,
  type DraftedBonds,
  type DraftedProfile,
} from './aiAssist'

/**
 * The "let the AI fill in a whole character" orchestrator. A local model can't reliably emit a card
 * plus a life profile plus dating traits plus a lorebook as one JSON blob — it drifts or breaks JSON
 * halfway — so this runs one focused, individually-parseable call per artifact and feeds each result
 * forward as grounding context for the next.
 *
 * Only the `card` stage is load-bearing: if it fails the whole run fails, because everything after it
 * needs a name and a description to ground on. Every later stage is best-effort — a parse failure
 * there is recorded in `failed` and the run continues, since a character with no drafted goals is
 * still a perfectly good character the user can finish by hand.
 *
 * The caller owns review-before-save: this returns a draft, it never touches the database.
 */
export type FullCharacterStage = 'card' | 'profile' | 'bonds' | 'outfits' | 'lore'

/** The optional stages, in run order — `card` always runs and isn't listed here. */
export const OPTIONAL_STAGES: readonly Exclude<FullCharacterStage, 'card'>[] = ['profile', 'bonds', 'outfits', 'lore']

export const STAGE_LABELS: Record<FullCharacterStage, string> = {
  card: 'Core card',
  profile: 'Life & background',
  bonds: 'Gifts & relationship starters',
  outfits: 'Wardrobe / outfits',
  lore: 'Character lore',
}

export interface FullCharacterSeed {
  /** A written brief. Used when there's no portrait, or as extra guidance alongside one. */
  brief?: string
  /** Base64 (no data: prefix) of a reference portrait, for a vision-capable model. */
  portraitBase64?: string
  /** A selected world's description — every stage folds this in so the character fits it. */
  worldTone?: string
  /** The user's global "Writing style" setting — folded into every prose-bearing stage so the
   *  generated card matches the style they've asked for in chat. */
  styleGuidance?: string
}

export interface FullCharacterDraft {
  card: CharacterCardData
  /** The very first model output, kept for the failure-path "show raw output" UI. */
  cardRawOutput: string
  profile: DraftedProfile | null
  bonds: DraftedBonds | null
  outfits: Outfit[] | null
  characterBook: Lorebook | null
  completed: FullCharacterStage[]
  failed: { stage: FullCharacterStage; error: string }[]
}

export type StageStatus = 'start' | 'done' | 'failed'

export interface DraftFullCharacterOpts {
  /** Hitting Stop aborts the in-flight call and stops before the next stage. */
  signal?: AbortSignal
  /** Progress for the staged UI. Fires start → done|failed for every stage that actually runs. */
  onStage?: (stage: FullCharacterStage, status: StageStatus) => void
  /** Which optional stages to run. Defaults to all of `OPTIONAL_STAGES`. `card` always runs. */
  stages?: readonly Exclude<FullCharacterStage, 'card'>[]
  /** How many character-lore entries to ask for in the `lore` stage. */
  loreCount?: number
}

const abortError = () => new DOMException('The character generation was stopped.', 'AbortError')

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

function loreEntry(id: number, keys: string[], content: string): LorebookEntry {
  return {
    id,
    keys,
    content,
    constant: false,
    selective: false,
    insertion_order: 100,
    enabled: true,
    position: 'before_char',
    activationMode: 'keyword',
  }
}

export async function draftFullCharacter(
  client: ChatBackend,
  seed: FullCharacterSeed,
  opts: DraftFullCharacterOpts = {},
): Promise<FullCharacterDraft> {
  const { signal, onStage, stages = OPTIONAL_STAGES, loreCount = 4 } = opts
  const brief = seed.brief?.trim()
  const worldTone = seed.worldTone?.trim() || undefined
  const styleGuidance = seed.styleGuidance?.trim() || undefined
  if (!brief && !seed.portraitBase64) {
    throw new Error('Give a brief or a reference portrait to generate a character from.')
  }
  const throwIfAborted = () => {
    if (signal?.aborted) throw abortError()
  }

  const completed: FullCharacterStage[] = []
  const failed: FullCharacterDraft['failed'] = []

  // Stage 1 — the card. Required: a failure here aborts the whole run.
  throwIfAborted()
  onStage?.('card', 'start')
  let card: CharacterCardData
  let cardRawOutput: string
  try {
    const result = seed.portraitBase64
      ? await draftCharacterFromPortrait(client, seed.portraitBase64, { brief, worldTone, styleGuidance, signal })
      : await draftCharacterFromBrief(client, brief ?? '', { worldTone, styleGuidance, signal })
    card = result.card
    cardRawOutput = result.rawOutput
    if (!card.name.trim()) card.name = brief?.slice(0, 40) || 'New Character'
    completed.push('card')
    onStage?.('card', 'done')
  } catch (e) {
    onStage?.('card', 'failed')
    throw e
  }

  const subject: AiLoreSubject = {
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    extra: card.first_mes?.trim() ? `First message: ${card.first_mes.trim()}` : undefined,
  }

  let profile: DraftedProfile | null = null
  let bonds: DraftedBonds | null = null
  let outfits: Outfit[] | null = null
  let characterBook: Lorebook | null = null

  const runStage = async (stage: Exclude<FullCharacterStage, 'card'>, fn: () => Promise<void>) => {
    if (!stages.includes(stage)) return
    throwIfAborted()
    onStage?.(stage, 'start')
    try {
      await fn()
      completed.push(stage)
      onStage?.(stage, 'done')
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) throw abortError()
      failed.push({ stage, error: e instanceof Error ? e.message : String(e) })
      onStage?.(stage, 'failed')
    }
  }

  await runStage('profile', async () => {
    profile = await draftCharacterProfile(client, subject, { worldTone, styleGuidance, signal })
  })

  await runStage('bonds', async () => {
    bonds = await draftCharacterBonds(client, subject, { worldTone, styleGuidance, signal })
  })

  await runStage('outfits', async () => {
    const drafted = await draftCharacterOutfits(client, subject, { worldTone, signal })
    if (drafted.length === 0) throw new Error('The model did not propose any usable outfits.')
    outfits = drafted
  })

  await runStage('lore', async () => {
    const entries = await suggestLoreEntries(client, subject, [], loreCount, signal)
    if (entries.length === 0) throw new Error('The model did not propose any usable lore entries.')
    characterBook = {
      name: `${card.name} Lore`,
      token_budget: 512,
      scan_depth: 8,
      recursive_scanning: false,
      entries: entries.map((e, i) => loreEntry(i + 1, e.keys, e.content)),
    }
  })

  return { card, cardRawOutput, profile, bonds, outfits, characterBook, completed, failed }
}
