import type { Character, OutreachFrequency } from '@/lib/characters/cardSpec'
import { buildCharacterProfileNote } from '@/lib/characters/profile'
import type { Chat, StoredMessage, WorldCard } from '@/lib/types'
import { describePresence, describeWorldMoment, getCurrentActivity, seededFraction } from '@/lib/world/calendar'
import { describeAmbientEvent, selectAmbientEvent, type AmbientEvent } from '@/lib/world/ambientEvents'
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

export type OutreachReason = 'silence' | 'schedule' | 'warmth' | 'life_event'

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
  character: Pick<Character, 'id' | 'outreach' | 'schedule' | 'likes' | 'goals' | 'frequentedLocations' | 'weatherPreferences'>
  chat: Pick<Chat, 'id' | 'affection' | 'relationshipStats' | 'activeEvent' | 'participants' | 'lastOutreachCheckedAt'>
  lastMessage: Pick<StoredMessage, 'createdAt'> | undefined
  /**
   * `id` is optional here — unlike the rest of `WorldCard` — purely so `world/ambientEvents.ts`'s
   * weather-based hooks have a stable per-world seed to key off. Omit it (or omit `world` entirely)
   * and those specific hooks are simply skipped, exactly as if there were no world at all; every
   * other ambient-event kind still works with no `id` present.
   */
  world: (Pick<WorldCard, 'currentDay' | 'currentPhaseIndex'> & { id?: string }) | undefined
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

  // A concrete "something's actually going on in their world" hook (`world/ambientEvents.ts`) beats
  // every generic reason below whenever one is available — the model gets something real to text
  // about instead of generic "thinking of you" filler. Seeded off the world day/phase, not the hour
  // bucket above: what the hook actually IS shouldn't change every single silent hour, only as the
  // (fictional) day genuinely moves on.
  const ambientEvent = selectAmbientEvent({
    worldId: opts.world?.id,
    characterId: opts.character.id,
    day: opts.world?.currentDay ?? 0,
    phaseIndex: opts.world?.currentPhaseIndex ?? 0,
    schedule: opts.character.schedule,
    likes: opts.character.likes,
    goals: opts.character.goals,
    frequentedLocations: opts.character.frequentedLocations,
    weatherPreferences: opts.character.weatherPreferences,
  })
  const reason: OutreachReason = ambientEvent
    ? 'life_event'
    : elapsedSinceMessage >= thresholdMs * 2
      ? 'silence'
      : presence.activity
        ? 'schedule'
        : warmth >= 60
          ? 'warmth'
          : 'silence'
  return { status: 'rolled', eligible: true, reason }
}

/**
 * The natural-language reason fed into the outreach message's `styleGuidance` — pure and directly
 * testable, unlike the async `generateOutreachMessage` it feeds into. Interpolates real names
 * directly rather than `{{user}}`/`{{char}}` macros: `styleGuidance` is never macro-substituted (only
 * specific named `buildPrompt` fields are — see `prompt/mindGuidance.ts`'s own note on the same
 * point), which the three original reasons here got wrong until this pass fixed it in place.
 */
export function outreachReasonHint(
  reason: OutreachReason,
  opts: { charName: string; userName: string; ambientEvent?: AmbientEvent },
): string {
  switch (reason) {
    case 'silence':
      return `You haven't heard from ${opts.userName} in a while and decided to reach out first, unprompted — a short, casual check-in, the kind of thing you'd actually text someone.`
    case 'schedule':
      return `Given what you're currently doing right now, you decided to text ${opts.userName} first, unprompted — casual and brief, mentioning what's going on with you only if it comes up naturally.`
    case 'warmth':
      return `Things have been going well between you and ${opts.userName} lately, and you found yourself wanting to reach out first, unprompted — just a short, warm text because you were thinking of them.`
    case 'life_event':
      // Falls back to the same text as 'silence' if somehow called with no event on hand — should
      // not happen in practice (evaluateOutreach only ever picks 'life_event' once selectAmbientEvent
      // already found one), but keeps this exhaustive and safe against a future caller doing so.
      return opts.ambientEvent
        ? `Something concrete just gave you a real reason to text ${opts.userName} first, unprompted: ${describeAmbientEvent(opts.charName, opts.ambientEvent)} Let that actually shape what you say — specific, not a generic "thinking of you" text — the way a real text message would bring it up.`
        : `You haven't heard from ${opts.userName} in a while and decided to reach out first, unprompted — a short, casual check-in, the kind of thing you'd actually text someone.`
  }
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
  // Recomputed rather than threaded through from evaluateOutreach's own OutreachCheck: both calls
  // are pure and take the same character/world state, so recomputing here is cheap and means the
  // caller (`useOutreachTick.ts`) only ever has to pass the reason through, not a second bespoke field.
  const ambientEvent =
    params.reason === 'life_event'
      ? selectAmbientEvent({
          worldId: world?.id,
          characterId: character.id,
          day: world?.currentDay ?? 0,
          phaseIndex: world?.currentPhaseIndex ?? 0,
          schedule: character.schedule,
          likes: character.likes,
          goals: character.goals,
          frequentedLocations: character.frequentedLocations,
          weatherPreferences: character.weatherPreferences,
        })
      : undefined
  const styleGuidance = [
    outreachReasonHint(params.reason, { charName: character.card.name, userName: params.personaName || 'You', ambientEvent }),
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
