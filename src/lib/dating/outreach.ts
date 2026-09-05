import type { Character, OutreachFrequency } from '@/lib/characters/cardSpec'
import { buildCharacterProfileNote } from '@/lib/characters/profile'
import type { Chat, StoredMessage, WorldCard } from '@/lib/types'
import { describePresence, describeWorldMoment, getCurrentActivity, seededFraction } from '@/lib/world/calendar'
import { computeWarmth, getRelationshipStats } from '@/lib/dating/stage'
import { buildRelationshipDescription } from '@/lib/dating/relationshipDescription'
import { buildPrompt, estimateTokens, type ChatMessage } from '@/lib/prompt/builder'
import type { InstructTemplate } from '@/lib/prompt/instructTemplates'
import type { ChatBackend } from '@/lib/api/chatBackend'
import type { GenerationParams } from '@/lib/api/types'
import { truncateAtStrayTurnMarker } from '@/lib/text/slop'

export { truncateAtStrayTurnMarker } from '@/lib/text/slop'

/**
 * ROADMAP.md 10f's "proactive outreach" — characters that can text the player first, unprompted.
 * Eligibility here is pure, deterministic code (no model call), matching the project's established
 * judge-call principle (`relationshipAssist.ts`): plain code decides *whether* and *why* a
 * character would reach out; the model (`generateOutreachMessage` below) only writes the text.
 */

const HOUR_MS = 3_600_000

/** A floor between successive rolls for the SAME chat, so rapidly reopening the app doesn't re-roll constantly. Independent of (and much shorter than) the silence thresholds below. */
const CHECK_COOLDOWN_MS = 30 * 60 * 1000

/** Hours of real silence before a frequency tier is even eligible to roll. */
const SILENCE_THRESHOLD_HOURS: Record<Exclude<OutreachFrequency, 'never'>, number> = {
  rare: 48,
  normal: 20,
  eager: 8,
}

/** Base probability of reaching out once the silence threshold is crossed, before the warmth bonus below. */
const BASE_CHANCE: Record<Exclude<OutreachFrequency, 'never'>, number> = {
  rare: 0.12,
  normal: 0.25,
  eager: 0.4,
}

/** How much a maxed-out relationship warmth (100) adds to the base roll chance. */
const MAX_WARMTH_BONUS = 0.2

export type OutreachReason = 'silence' | 'schedule' | 'warmth'

export interface OutreachCheck {
  /**
   * 'skip': no probability roll was attempted (frequency off, group chat, no prior message, a
   * live event in progress, silence threshold not yet crossed, still inside the cooldown floor,
   * or currently asleep) — the caller should NOT touch `lastOutreachCheckedAt` for a 'skip', so a
   * chat that hasn't even reached its threshold yet doesn't start burning cooldown for no reason.
   * 'rolled': a roll was attempted — the caller SHOULD persist `lastOutreachCheckedAt` regardless
   * of `eligible`, so a "no" doesn't get re-rolled again inside the cooldown window.
   */
  status: 'skip' | 'rolled'
  eligible: boolean
  /** Only set when `eligible` — the dominant reason this check fired, folded into the outreach prompt as a natural-language nudge. The model never decides this itself. */
  reason?: OutreachReason
}

export interface EvaluateOutreachOptions {
  character: Pick<Character, 'id' | 'outreach' | 'schedule'>
  chat: Pick<Chat, 'id' | 'affection' | 'relationshipStats' | 'activeEvent' | 'participants' | 'lastOutreachCheckedAt'>
  lastMessage: Pick<StoredMessage, 'createdAt'> | undefined
  world: Pick<WorldCard, 'currentDay' | 'currentPhaseIndex'> | undefined
  now: number
}

export function evaluateOutreach(opts: EvaluateOutreachOptions): OutreachCheck {
  const frequency = opts.character.outreach?.frequency
  if (!frequency || frequency === 'never') return { status: 'skip', eligible: false }
  // v1 scope: multi-participant (group) chats and a chat mid-live-event are skipped outright,
  // the same way relationship-tracking/choice-suggestion already skip non-primary speakers.
  if (opts.chat.participants?.length) return { status: 'skip', eligible: false }
  if (!opts.lastMessage) return { status: 'skip', eligible: false }
  if (opts.chat.activeEvent) return { status: 'skip', eligible: false }

  const elapsedSinceMessage = opts.now - opts.lastMessage.createdAt
  const thresholdMs = SILENCE_THRESHOLD_HOURS[frequency] * HOUR_MS
  if (elapsedSinceMessage < thresholdMs) return { status: 'skip', eligible: false }

  const lastChecked = opts.chat.lastOutreachCheckedAt ?? 0
  if (opts.now - lastChecked < CHECK_COOLDOWN_MS) return { status: 'skip', eligible: false }

  // Reads the world clock exactly as it stands right now — there's no mapping from real elapsed
  // time to fictional day/phase, by design (see the plan this shipped from: the world clock stays
  // exactly as manually-advanced as it always has been, untouched by this feature).
  const presence = getCurrentActivity(opts.character.schedule, opts.world?.currentDay ?? 0, opts.world?.currentPhaseIndex ?? 0)
  if (presence.status === 'sleeping') return { status: 'skip', eligible: false }

  const warmth = computeWarmth(opts.chat.affection ?? 0, getRelationshipStats(opts.chat))
  const chance = BASE_CHANCE[frequency] + (warmth / 100) * MAX_WARMTH_BONUS
  // Seeded off an hour-bucket of real elapsed silence, NOT the frozen world day/phase — seeding
  // off the fictional clock would make a character either permanently eligible or permanently not
  // for as long as the player leaves the world clock alone (nothing else advances it), which
  // defeats a wall-clock-driven feature. This still stays fully deterministic/reproducible for the
  // same inputs, just varying (getting a fresh "chance") roughly every hour of continued silence.
  const hourBucket = Math.floor(elapsedSinceMessage / HOUR_MS)
  const roll = seededFraction(`outreach:${opts.character.id}:${opts.chat.id}:${hourBucket}`)
  if (roll >= chance) return { status: 'rolled', eligible: false }

  const reason: OutreachReason =
    elapsedSinceMessage >= thresholdMs * 2 ? 'silence' : presence.activity ? 'schedule' : warmth >= 60 ? 'warmth' : 'silence'
  return { status: 'rolled', eligible: true, reason }
}

const REASON_HINTS: Record<OutreachReason, string> = {
  silence:
    "You haven't heard from {{user}} in a while and decided to reach out first, unprompted — a short, casual check-in, the kind of thing you'd actually text someone.",
  schedule:
    "Given what you're currently doing right now, you decided to text {{user}} first, unprompted — casual and brief, mentioning what's going on with you only if it comes up naturally.",
  warmth:
    'Things have been going well between you and {{user}} lately, and you found yourself wanting to reach out first, unprompted — just a short, warm text because you were thinking of them.',
}

export interface GenerateOutreachParams {
  character: Character
  chat: Pick<Chat, 'affection' | 'relationshipStats' | 'commitmentStatus' | 'relationshipWarning' | 'breakupCount' | 'summary'>
  world: WorldCard | undefined
  personaName: string
  personaDescription: string
  /** Last ~8-10 messages, oldest first — a short window, since this is a check-in, not a scene needing full context. */
  recentHistory: ChatMessage[]
  reason: OutreachReason
  template: InstructTemplate
  sampler: GenerationParams
}

/**
 * Generates the actual text of an unprompted message. Deliberately narrower than a live chat
 * turn's `buildCurrentPrompt` (useChatSession.ts): last few messages only, character + world
 * lorebooks only (no facts lorebook or scoped `WorldInfoBook`s, no VN `sceneOptions`) — a fast
 * follow-up once the core loop is verified live, not an oversight. The model's only job is to
 * write in-character text; whether/why to reach out was already decided by `evaluateOutreach`.
 */
export async function generateOutreachMessage(client: ChatBackend, params: GenerateOutreachParams): Promise<string> {
  const { character, chat, world } = params
  const worldDescription = world
    ? [
        world.description?.trim(),
        world.rules?.trim() ? `World rules: ${world.rules.trim()}` : '',
        describeWorldMoment({
          worldId: world.id,
          characterId: character.id,
          day: world.currentDay ?? 0,
          phaseIndex: world.currentPhaseIndex ?? 0,
          weatherPreferences: character.weatherPreferences,
        }),
        character.schedule?.length
          ? describePresence(getCurrentActivity(character.schedule, world.currentDay ?? 0, world.currentPhaseIndex ?? 0))
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : undefined

  const lorebooks = [
    ...(world?.lorebook ? [{ ...world.lorebook, sourceKey: `world:${world.id}` }] : []),
    ...(character.card.character_book ? [{ ...character.card.character_book, sourceKey: `char:${character.id}` }] : []),
  ]

  const relationshipDescription = buildRelationshipDescription(chat, world, character)
  const styleGuidance = [
    REASON_HINTS[params.reason],
    'Write only the text message itself — no narration, no action asterisks, no scene-setting, no "<START>" or other scene-break marker, and no line written as or on behalf of anyone else. One to three short sentences, exactly how a real text message reads, then stop completely.',
  ].join(' ')

  const contextBudget = Math.max(params.sampler.max_context_length - params.sampler.max_length - 32, 256)
  const countTokens = async (text: string) => {
    if (!text) return 0
    try {
      const r = await client.tokenCount(text)
      return r.count
    } catch {
      return estimateTokens(text)
    }
  }

  const built = await buildPrompt({
    character: character.card,
    characterProfile: buildCharacterProfileNote(character),
    personaName: params.personaName,
    personaDescription: params.personaDescription,
    history: params.recentHistory,
    chatSummary: chat.summary,
    worldDescription,
    lorebooks,
    template: params.template,
    contextBudget,
    scanDepth: 8,
    countTokens,
    relationshipDescription,
    styleGuidance,
    affection: chat.affection ?? 0,
    nextSpeakerName: character.card.name,
  })

  const maxLength = Math.min(params.sampler.max_length, 200)
  // Same dynamic stop-sequence treatment as useChatSession.ts's live-turn generation (see the
  // comment there for the full root cause): the template's own turn-boundary tokens, plus
  // `<START>`/name-prefix stops that catch a model imitating a character card's SillyTavern-style
  // `mes_example` delimiters instead of stopping after one turn — a risk outreach runs into more
  // often than a normal reply, since it deliberately puts two consecutive character turns back to
  // back with no intervening player line, a pattern with no direct precedent in most cards'
  // examples. `truncateAtStrayTurnMarker` below is a defensive backstop on top of this, not a
  // replacement for it — stopping generation early is strictly better than generating the ramble
  // and cutting it off after the fact.
  const personaName = params.personaName || 'You'
  const dynamicStops = ['<START>', `\n${personaName}:`, `\n${character.card.name}:`]
  const stopSequence = [...new Set([...params.template.stopSequences, ...(params.sampler.stop_sequence ?? []), ...dynamicStops])]
  const text = await client.generate({
    ...params.sampler,
    max_length: maxLength,
    stop_sequence: stopSequence,
    max_context_length: await client.getEffectiveMaxContext(params.sampler.max_context_length),
    prompt: built.prompt,
  })
  return truncateAtStrayTurnMarker(text.trim(), character.card.name, params.personaName)
}
