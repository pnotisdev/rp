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

// Proactive outreach: characters that can text the player first, unprompted. Eligibility is pure,
// deterministic code (no model call) deciding whether and why to reach out; the model
// (`generateOutreachMessage`) only writes the text.

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
  /** 'skip': no roll attempted — caller should NOT touch `lastOutreachCheckedAt`. 'rolled': a roll happened — caller SHOULD persist `lastOutreachCheckedAt` regardless of `eligible`, so a "no" isn't re-rolled inside the cooldown. */
  status: 'skip' | 'rolled'
  eligible: boolean
  /** Only set when `eligible` — the dominant reason this check fired, folded into the outreach prompt as a natural-language nudge. The model never decides this itself. */
  reason?: OutreachReason
}

export interface EvaluateOutreachOptions {
  character: Pick<Character, 'id' | 'outreach' | 'schedule' | 'likes' | 'goals' | 'frequentedLocations' | 'weatherPreferences'>
  chat: Pick<Chat, 'id' | 'affection' | 'relationshipStats' | 'activeEvent' | 'participants' | 'lastOutreachCheckedAt'>
  lastMessage: Pick<StoredMessage, 'createdAt'> | undefined
  /** `id` optional (unlike the rest of `WorldCard`) so weather-based ambient hooks have a stable seed; omitted means those specific hooks are skipped. */
  world: (Pick<WorldCard, 'currentDay' | 'currentPhaseIndex'> & { id?: string }) | undefined
  now: number
}

export function evaluateOutreach(opts: EvaluateOutreachOptions): OutreachCheck {
  const frequency = opts.character.outreach?.frequency
  if (!frequency || frequency === 'never') return { status: 'skip', eligible: false }
  // Group chats and a chat mid-live-event are skipped outright.
  if (opts.chat.participants?.length) return { status: 'skip', eligible: false }
  if (!opts.lastMessage) return { status: 'skip', eligible: false }
  if (opts.chat.activeEvent) return { status: 'skip', eligible: false }

  const elapsedSinceMessage = opts.now - opts.lastMessage.createdAt
  const thresholdMs = SILENCE_THRESHOLD_HOURS[frequency] * HOUR_MS
  if (elapsedSinceMessage < thresholdMs) return { status: 'skip', eligible: false }

  const lastChecked = opts.chat.lastOutreachCheckedAt ?? 0
  if (opts.now - lastChecked < CHECK_COOLDOWN_MS) return { status: 'skip', eligible: false }

  // No mapping from real elapsed time to fictional day/phase — the world clock stays exactly as manually-advanced, untouched by this feature.
  const presence = getCurrentActivity(opts.character.schedule, opts.world?.currentDay ?? 0, opts.world?.currentPhaseIndex ?? 0)
  if (presence.status === 'sleeping') return { status: 'skip', eligible: false }

  const warmth = computeWarmth(opts.chat.affection ?? 0, getRelationshipStats(opts.chat))
  const chance = BASE_CHANCE[frequency] + (warmth / 100) * MAX_WARMTH_BONUS
  // Seeded off an hour-bucket of real elapsed silence, not the frozen world day/phase, so the roll still varies while the player leaves the world clock untouched.
  const hourBucket = Math.floor(elapsedSinceMessage / HOUR_MS)
  const roll = seededFraction(`outreach:${opts.character.id}:${opts.chat.id}:${hourBucket}`)
  if (roll >= chance) return { status: 'rolled', eligible: false }

  // A concrete ambient-event hook beats every generic reason below when one's available. Seeded off the world day/phase, not the hour bucket, so it doesn't change every silent hour.
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

/** Natural-language reason fed into the outreach message's `styleGuidance`. Real names, no macros — `styleGuidance` is never macro-substituted. */
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
      // Falls back to 'silence' text if somehow called with no event on hand.
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

/** Generates the actual text of an unprompted message — deliberately narrower than a live turn's `buildCurrentPrompt` (last few messages, character + world lorebooks only). Whether/why to reach out is already decided by `evaluateOutreach`. */
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
  // Recomputed rather than threaded through from evaluateOutreach — both calls are pure over the same state, cheap to redo.
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
  // Same dynamic stop-sequence treatment as useChatSession.ts's live-turn generation — outreach risks a model imitating a card's own example-dialogue delimiters more than a normal reply does (two character turns back to back, no player line between). `truncateAtStrayTurnMarker` below is a defensive backstop, not a replacement.
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
