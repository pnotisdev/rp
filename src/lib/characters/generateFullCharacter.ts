import type { ChatBackend } from '@/lib/api/chatBackend'
import type { AssistShaping } from '@/lib/api/generateWithTimeout'
import { DEFAULT_GIFT_CATALOG } from '@/lib/dating/gifts'
import type { GiftItem } from '@/lib/types'
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
import {
  draftDrive,
  draftGiftScores,
  draftGreetings,
  draftIntimacy,
  draftRoutine,
  draftSocial,
  draftVoice,
  type DraftExtras,
  type StageOpts,
} from './draftSections'
import { describesMinor } from './minor'

/** The "let the AI fill in a whole character" orchestrator. */
export type FullCharacterStage = 'card' | 'greetings' | 'profile' | 'bonds' | 'social' | 'voice' | 'gifts' | 'worldsim' | 'drive' | 'intimacy' | 'outfits' | 'lore'
export type OptionalStage = Exclude<FullCharacterStage, 'card'>

/** The optional stages, in run order: later ones read what earlier ones wrote. `card` always runs and isn't listed. */
export const OPTIONAL_STAGES: readonly OptionalStage[] = ['greetings', 'profile', 'bonds', 'social', 'voice', 'gifts', 'worldsim', 'drive', 'intimacy', 'outfits', 'lore']

export const STAGE_LABELS: Record<FullCharacterStage, string> = {
  card: 'Core card',
  greetings: 'Alternate greetings',
  profile: 'Life & background',
  bonds: 'Gifts & relationship starters',
  social: 'Connections & rules',
  voice: 'Voice',
  gifts: 'Gift scores',
  worldsim: 'Schedule & routine',
  drive: 'Persona engine settings',
  intimacy: 'Intimacy settings',
  outfits: 'Wardrobe / outfits',
  lore: 'Character lore',
}

/** A stage that deliberately leaves its section blank; the reason is shown to the user. */
export class StageSkipped extends Error {}

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
  /** The gifts the character is scored against: the selected world's own, else the default catalog. */
  giftCatalog?: readonly GiftItem[]
  /** The world the character will live in; carried onto the draft so saving links them. */
  worldId?: string
}

/** The card plus every section drafted so far: what the editor applies and the Assistant saves. */
export interface DraftSections {
  card: CharacterCardData
  profile?: DraftedProfile | null
  bonds?: DraftedBonds | null
  outfits?: Outfit[] | null
  characterBook?: Lorebook | null
  extras?: DraftExtras
  /** What the user asked for. Shown to the intimacy stage as context. */
  brief?: string
  worldId?: string
}

export interface FullCharacterDraft extends DraftSections {
  profile: DraftedProfile | null
  bonds: DraftedBonds | null
  outfits: Outfit[] | null
  characterBook: Lorebook | null
  extras: DraftExtras
  /** The very first model output, kept for the failure-path "show raw output" UI. */
  cardRawOutput: string
  completed: FullCharacterStage[]
  failed: { stage: FullCharacterStage; error: string }[]
  /** Stages that chose to do nothing, with why. */
  skipped: { stage: FullCharacterStage; reason: string }[]
}

export type StageStatus = 'start' | 'done' | 'failed' | 'skipped'

export interface DraftFullCharacterOpts {
  /** Hitting Stop aborts the in-flight call and stops before the next stage. */
  signal?: AbortSignal
  /** Progress for the staged UI. Fires start → done|failed for every stage that actually runs. */
  onStage?: (stage: FullCharacterStage, status: StageStatus) => void
  /** Which optional stages to run. Defaults to all of `OPTIONAL_STAGES`. `card` always runs. */
  stages?: readonly OptionalStage[]
  /** How many character-lore entries to ask for in the `lore` stage. */
  loreCount?: number
  /** Template wrapping for strict chat-template models (see assistShaping.ts). */
  shaping?: AssistShaping
}

export interface RunStageOpts extends StageOpts {
  giftCatalog?: readonly GiftItem[]
  loreCount?: number
  /** For rewriting a saved section: what it says now, and what the writer wants changed. */
  current?: string
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

/** The character block a stage reads: the card plus what earlier stages added, minus the stage's own previous output. */
function subjectOf(draft: DraftSections, stage: OptionalStage, opts: RunStageOpts): AiLoreSubject {
  const { card } = draft
  const p = stage === 'profile' ? null : draft.profile
  const b = stage === 'bonds' ? null : draft.bonds
  const lines = [
    card.first_mes?.trim() && `First message: ${card.first_mes.trim()}`,
    stage === 'voice' && card.mes_example?.trim() && `Example dialogue:\n${card.mes_example.trim().slice(0, 900)}`,
    stage === 'intimacy' && draft.brief?.trim() && `The creator's brief: ${draft.brief.trim()}`,
    stage === 'intimacy' && p?.boundaries?.length && `Boundaries: ${p.boundaries.join('; ')}`,
    p?.occupation && `Occupation: ${p.occupation}${p.workplace ? `, at ${p.workplace}` : ''}`,
    p?.homeLocation && `Home: ${p.homeLocation}`,
    p?.frequentedLocations?.length && `Often found: ${p.frequentedLocations.join(', ')}`,
    b?.giftLikes?.length && `Gifts they love: ${b.giftLikes.join(', ')}`,
    b?.giftDislikes?.length && `Gifts that fall flat: ${b.giftDislikes.join(', ')}`,
    opts.current && `Current version of this section, to be rewritten:\n${opts.current}`,
    opts.hint && `The writer's instruction for this section: ${opts.hint}`,
  ].filter((l): l is string => !!l)
  return { name: card.name, description: card.description, personality: card.personality, scenario: card.scenario, extra: lines.join('\n') || undefined }
}

const isMinor = ({ card, brief }: DraftSections) => describesMinor(card.name, card.description, card.personality, card.scenario, card.first_mes, brief)

/** Runs one optional stage against a draft and returns the draft with that stage's output in place. A stage that fails throws and leaves the draft as it was. */
export async function runDraftStage<D extends DraftSections>(client: ChatBackend, stage: OptionalStage, draft: D, opts: RunStageOpts = {}): Promise<D> {
  const { card } = draft
  const subject = subjectOf(draft, stage, opts)
  /** `clear` names keys this stage owns that a smaller answer must not leave behind. */
  const withExtras = (more: DraftExtras, clear: (keyof DraftExtras)[] = []) => ({
    ...draft,
    extras: { ...draft.extras, ...Object.fromEntries(clear.map((k) => [k, undefined])), ...more },
  })
  switch (stage) {
    case 'greetings':
      return { ...draft, card: { ...card, alternate_greetings: await draftGreetings(client, subject, card.first_mes, opts) } }
    case 'profile':
      return { ...draft, profile: await draftCharacterProfile(client, subject, opts) }
    case 'bonds':
      return { ...draft, bonds: await draftCharacterBonds(client, subject, opts) }
    case 'social':
      return withExtras(await draftSocial(client, subject, opts))
    case 'voice':
      return withExtras(await draftVoice(client, subject, card, opts))
    case 'gifts':
      return withExtras(await draftGiftScores(client, subject, opts.giftCatalog ?? DEFAULT_GIFT_CATALOG, opts))
    case 'worldsim':
      return withExtras(await draftRoutine(client, subject, opts))
    case 'drive':
      return withExtras(await draftDrive(client, subject, opts))
    case 'intimacy': {
      if (isMinor(draft)) throw new StageSkipped('The card describes someone under 18, so the intimacy settings were left blank.')
      // Hard limits come only from what the creator wrote: the brief and the card's own boundaries.
      // Limits already on the card carry over: a rewrite must never drop one.
      const hard = draft.extras?.kinkProfile?.hardLimits ?? []
      const off = draft.extras?.touchProfile?.offLimits ?? []
      const stated = [draft.brief, ...(draft.profile?.boundaries ?? []).map((b) => `Hard limits: ${b}`), hard.length && `Hard limits: ${hard.join(', ')}`, off.length && `Off limits: ${off.join(', ')}`]
        .filter(Boolean)
        .join('\n')
      const drafted = await draftIntimacy(client, subject, stated, opts)
      const union = <T,>(a: readonly T[] | undefined, b: readonly T[]) => [...new Set([...(a ?? []), ...b])]
      const gated = draft.extras?.touchProfile?.gated
      const touchProfile = { ...drafted.touchProfile, ...(off.length || drafted.touchProfile?.offLimits ? { offLimits: union(drafted.touchProfile?.offLimits, off) } : {}), ...(gated ? { gated } : {}) }
      const kinkProfile = { ...drafted.kinkProfile, ...(hard.length || drafted.kinkProfile?.hardLimits ? { hardLimits: union(drafted.kinkProfile?.hardLimits, hard) } : {}) }
      return withExtras(
        { ...drafted, ...(Object.keys(touchProfile).length ? { touchProfile } : {}), ...(Object.keys(kinkProfile).length ? { kinkProfile } : {}) },
        ['touchProfile', 'kinkProfile', 'explicitVoiceNote'],
      )
    }
    case 'outfits': {
      // An undressed state is never proposed for a card under 18.
      const proposed = await draftCharacterOutfits(client, subject, opts)
      const outfits = isMinor(draft) ? proposed.filter((o) => !o.intimate) : proposed
      if (outfits.length === 0) throw new Error('The model did not propose any usable outfits.')
      return { ...draft, outfits }
    }
    case 'lore': {
      const entries = await suggestLoreEntries(client, subject, [], opts.loreCount ?? 4, opts.signal, undefined, opts.shaping)
      if (entries.length === 0) throw new Error('The model did not propose any usable lore entries.')
      const characterBook: Lorebook = {
        name: `${card.name} Lore`,
        token_budget: 512,
        scan_depth: 8,
        recursive_scanning: false,
        entries: entries.map((e, i) => loreEntry(i + 1, e.keys, e.content)),
      }
      return { ...draft, characterBook }
    }
  }
}

export async function draftFullCharacter(
  client: ChatBackend,
  seed: FullCharacterSeed,
  opts: DraftFullCharacterOpts = {},
): Promise<FullCharacterDraft> {
  const { signal, onStage, stages = OPTIONAL_STAGES, loreCount = 4, shaping } = opts
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
  const skipped: FullCharacterDraft['skipped'] = []

  // Stage 1 — the card. Required: a failure here aborts the whole run.
  throwIfAborted()
  onStage?.('card', 'start')
  let card: CharacterCardData
  let cardRawOutput: string
  try {
    const result = seed.portraitBase64
      ? await draftCharacterFromPortrait(client, seed.portraitBase64, { brief, worldTone, styleGuidance, signal, shaping })
      : await draftCharacterFromBrief(client, brief ?? '', { worldTone, styleGuidance, signal, shaping })
    card = result.card
    cardRawOutput = result.rawOutput
    if (!card.name.trim()) card.name = brief?.slice(0, 40) || 'New Character'
    completed.push('card')
    onStage?.('card', 'done')
  } catch (e) {
    onStage?.('card', 'failed')
    throw e
  }

  // The rest are optional: a stage that fails is recorded and the run goes on.
  let draft: Omit<FullCharacterDraft, 'cardRawOutput' | 'completed' | 'failed' | 'skipped'> = {
    card,
    profile: null,
    bonds: null,
    outfits: null,
    characterBook: null,
    extras: {},
    ...(brief ? { brief } : {}),
    ...(seed.worldId ? { worldId: seed.worldId } : {}),
  }
  const stageOpts: RunStageOpts = { worldTone, styleGuidance, giftCatalog: seed.giftCatalog, loreCount, signal, shaping }
  for (const stage of OPTIONAL_STAGES) {
    if (!stages.includes(stage)) continue
    throwIfAborted()
    onStage?.(stage, 'start')
    try {
      draft = await runDraftStage(client, stage, draft, stageOpts)
      completed.push(stage)
      onStage?.(stage, 'done')
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) throw abortError()
      if (e instanceof StageSkipped) {
        skipped.push({ stage, reason: e.message })
        onStage?.(stage, 'skipped')
        continue
      }
      failed.push({ stage, error: e instanceof Error ? e.message : String(e) })
      onStage?.(stage, 'failed')
    }
  }

  return { ...draft, cardRawOutput, completed, failed, skipped }
}