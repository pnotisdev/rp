import type { PresenceStatus, ScheduleEntry, WeatherPreferences } from '@/lib/world/calendar'
import { daysUntilAnnualDate, describeWeather, getCalendarInfo, getCurrentActivity, getWeather, pickFrom, seededFraction } from '@/lib/world/calendar'

/**
 * Deterministic "something is going on" hooks derived from a character's already-authored world
 * state (weather preferences, schedule, likes, goals, frequented locations) — no new persisted
 * state of its own. Feeds `dating/outreach.ts`'s proactive texts and the per-turn style-guidance
 * channel; also covers off-screen social-connection reactions and schedule-conflict friction.
 */

export const AMBIENT_EVENT_KINDS = [
  'holiday',
  'birthday',
  'birthday_soon',
  'weather_loved',
  'weather_hated',
  'routine_absence',
  'goal_on_mind',
  'free_time_interest',
] as const
export type AmbientEventKind = (typeof AMBIENT_EVENT_KINDS)[number]

export interface AmbientEvent {
  kind: AmbientEventKind
  /** The concrete specific substituted into `describeAmbientEvent`'s line. */
  detail: string
  /** Only set for `'routine_absence'`. */
  daysSinceVisited?: number
  /** Only set for `'birthday_soon'`. */
  daysUntil?: number
}

export interface AmbientEventContext {
  /** Undefined with no bound world — weather-based hooks are skipped outright. */
  worldId?: string
  characterId: string
  day: number
  phaseIndex: number
  schedule?: ScheduleEntry[]
  likes?: string[]
  goals?: string[]
  frequentedLocations?: string[]
  weatherPreferences?: WeatherPreferences
  /** Day-of-year (`Character.birthday`) — powers the `'birthday'`/`'birthday_soon'` hooks below. */
  birthday?: number
}

/** How many days out a birthday starts being worth an ambient "it's coming up" mention. */
const BIRTHDAY_SOON_WINDOW_DAYS = 7

/** 1–`BIRTHDAY_SOON_WINDOW_DAYS` days out only — the day itself is `selectAmbientEvent`'s own unconditional `'birthday'` check, not this. */
function selectBirthdaySoon(ctx: AmbientEventContext): AmbientEvent | undefined {
  if (ctx.birthday === undefined) return undefined
  const daysUntil = daysUntilAnnualDate(ctx.day, ctx.birthday)
  if (daysUntil <= 0 || daysUntil > BIRTHDAY_SOON_WINDOW_DAYS) return undefined
  return { kind: 'birthday_soon', detail: '', daysUntil }
}

/** Plausible range for a "hasn't been there in a while" gap, in in-fiction days. */
const ROUTINE_ABSENCE_MIN_DAYS = 5
const ROUTINE_ABSENCE_MAX_DAYS = 18

/** How often (in in-fiction days) which authored goal feels topical can change. */
const GOAL_CYCLE_DAYS = 3

/** A location not in the character's current schedule slot, absence gap week-bucketed so it holds steady rather than rerolling daily. */
function selectRoutineAbsence(ctx: AmbientEventContext): AmbientEvent | undefined {
  if (!ctx.frequentedLocations?.length) return undefined
  const currentLocation = getCurrentActivity(ctx.schedule, ctx.day, ctx.phaseIndex).location
  const eligible = ctx.frequentedLocations.filter((loc) => loc !== currentLocation)
  if (!eligible.length) return undefined
  const weekBucket = Math.floor(ctx.day / 7)
  const location = pickFrom(eligible, `ambient:absence-loc:${ctx.characterId}:${weekBucket}`)
  const days =
    ROUTINE_ABSENCE_MIN_DAYS +
    Math.floor(
      seededFraction(`ambient:absence-days:${ctx.characterId}:${location}:${weekBucket}`) *
        (ROUTINE_ABSENCE_MAX_DAYS - ROUTINE_ABSENCE_MIN_DAYS),
    )
  return { kind: 'routine_absence', detail: location, daysSinceVisited: days }
}

/** One authored goal, cycled every `GOAL_CYCLE_DAYS`. */
function selectGoalOnMind(ctx: AmbientEventContext): AmbientEvent | undefined {
  if (!ctx.goals?.length) return undefined
  const cycleBucket = Math.floor(ctx.day / GOAL_CYCLE_DAYS)
  const goal = pickFrom(ctx.goals, `ambient:goal:${ctx.characterId}:${cycleBucket}`)
  return { kind: 'goal_on_mind', detail: goal }
}

/** Only fires while the character's schedule reads as free right now. */
function selectFreeTimeInterest(ctx: AmbientEventContext): AmbientEvent | undefined {
  if (!ctx.likes?.length) return undefined
  if (getCurrentActivity(ctx.schedule, ctx.day, ctx.phaseIndex).status !== 'available') return undefined
  const like = pickFrom(ctx.likes, `ambient:like:${ctx.characterId}:${ctx.day}:${ctx.phaseIndex}`)
  return { kind: 'free_time_interest', detail: like }
}

/** Picks the best concrete ambient hook right now, if any. A holiday always wins; otherwise a seeded uniform pick among whichever other hooks qualify. */
export function selectAmbientEvent(ctx: AmbientEventContext): AmbientEvent | undefined {
  const info = getCalendarInfo(ctx.day)
  if (info.holiday) return { kind: 'holiday', detail: info.holiday }
  // Same unconditional priority as a holiday — a real, once-a-year occasion, not something that
  // should have to win a coin flip against "free time interest" to ever come up on the actual day.
  if (ctx.birthday !== undefined && daysUntilAnnualDate(ctx.day, ctx.birthday) === 0) {
    return { kind: 'birthday', detail: '' }
  }

  const candidates: AmbientEvent[] = []
  const birthdaySoon = selectBirthdaySoon(ctx)
  if (birthdaySoon) candidates.push(birthdaySoon)
  if (ctx.worldId) {
    const weather = getWeather(ctx.worldId, ctx.day)
    if (ctx.weatherPreferences?.loves?.includes(weather)) candidates.push({ kind: 'weather_loved', detail: describeWeather(weather) })
    if (ctx.weatherPreferences?.hates?.includes(weather)) candidates.push({ kind: 'weather_hated', detail: describeWeather(weather) })
  }
  const absence = selectRoutineAbsence(ctx)
  if (absence) candidates.push(absence)
  const goal = selectGoalOnMind(ctx)
  if (goal) candidates.push(goal)
  const freeTime = selectFreeTimeInterest(ctx)
  if (freeTime) candidates.push(freeTime)

  if (!candidates.length) return undefined
  return pickFrom(candidates, `ambient:pick:${ctx.characterId}:${ctx.day}:${ctx.phaseIndex}`)
}

const HOOK_LINES: Record<AmbientEventKind, (charName: string, event: AmbientEvent) => string> = {
  holiday: (charName, event) =>
    `Today is ${event.detail} — a real, recognized occasion in this world. It doesn't have to take over the scene, but it's a fair, specific thing for ${charName} to notice, mention, or feel some way about today.`,
  birthday: (charName) =>
    `Today is ${charName}'s actual birthday — a real, once-a-year occasion for them personally, not just a world holiday. It doesn't have to take over the scene, but it's fair and natural for ${charName} to notice it, feel some way about it (however they'd genuinely feel about their own birthday), or bring it up themselves today.`,
  birthday_soon: (charName, event) =>
    `${charName}'s birthday is coming up in about ${event.daysUntil} day${event.daysUntil === 1 ? '' : 's'} — close enough that it's fair for ${charName} to naturally mention it's coming, drop a hint about wanting something, or seem a little more aware of the date than usual. Not something to force.`,
  weather_loved: (charName, event) =>
    `Today's weather (${event.detail}) happens to be exactly the kind ${charName} genuinely loves. Worth ${charName} noticing or reacting to today, in whatever small way actually fits their mood right now.`,
  weather_hated: (charName, event) =>
    `Today's weather (${event.detail}) happens to be exactly the kind ${charName} genuinely dislikes. It can reasonably color their mood today — a little friction, a complaint, wishing they were elsewhere — without becoming a bigger deal than it is.`,
  routine_absence: (charName, event) =>
    `${charName} hasn't been to ${event.detail}, one of their own regular spots, in about ${event.daysSinceVisited ?? 'quite a few'} days now. A small, real gap in their routine that could plausibly cross their mind or come up today — not something to force into the scene.`,
  goal_on_mind: (charName, event) =>
    `Something ${charName} has genuinely been working toward — ${event.detail} — is weighing on them more than usual today. It can surface as a passing thought, an offhand comment, or a bit of restlessness, without needing to be resolved this turn.`,
  free_time_interest: (charName, event) =>
    `${charName} has no particular obligation pulling at them right now, and ${event.detail} is something they'd genuinely enjoy turning their attention to, if the scene naturally allows for it.`,
}

/** Formats a selected hook into a model-facing line, real names interpolated directly (not `{{char}}`/`{{user}}` macros). Shared by both delivery channels. */
export function describeAmbientEvent(charName: string, event: AmbientEvent): string {
  return HOOK_LINES[event.kind](charName, event)
}

/** Below this many of the character's own replies, nothing fires. */
const AMBIENT_EVENT_MIN_TURNS = 4

/** Per-eligible-turn odds of actually firing (rolled once per turn, not per world day/phase). */
const AMBIENT_EVENT_CHANCE = 0.15

/** The per-turn `styleGuidance` producer: deterministic gating here, `describeAmbientEvent` writes the prose. `charTurnCount` is the caller's own computed count (e.g. `countCharReplies(messages)`). Returns `''` with no event, below the turn floor, or on a missed roll. */
export function ambientEventGuidance(opts: {
  charName: string
  characterId: string
  chatId: string
  charTurnCount: number
  event: AmbientEvent | undefined
}): string {
  if (!opts.event) return ''
  if (opts.charTurnCount < AMBIENT_EVENT_MIN_TURNS) return ''
  const roll = seededFraction(`ambient-fire:${opts.characterId}:${opts.chatId}:${opts.charTurnCount}`)
  if (roll >= AMBIENT_EVENT_CHANCE) return ''
  return describeAmbientEvent(opts.charName, opts.event)
}

/** A named person from the character's own `socialConnections`, off-screen, reacting to something a world's `triggers.ts` rule flagged via a `social_reaction` action. `topic` comes from that trigger; this only picks which connection plausibly heard about it. */
export interface SocialConnectionLike {
  name: string
  relation: string
  notes?: string
}

export interface SocialReaction {
  connectionName: string
  relation: string
  topic: string
}

export function selectSocialReaction(params: {
  characterId: string
  chatId: string
  topic: string
  connections: SocialConnectionLike[] | undefined
}): SocialReaction | undefined {
  if (!params.connections?.length) return undefined
  const connection = pickFrom(params.connections, `social-reaction:${params.characterId}:${params.chatId}:${params.topic}`)
  return { connectionName: connection.name, relation: connection.relation, topic: params.topic }
}

/** Gives the model an honest cost signal when the character's schedule has them busy/asleep/traveling right now — not a hard block on starting a date or intimacy, just friction. Returns `''` while genuinely `'available'`. */
export function scheduleConflictGuidance(
  charName: string,
  presence: { status: PresenceStatus; activity?: string; location?: string },
): string {
  if (presence.status === 'available') return ''
  const activityNote = presence.activity ? ` (${presence.activity})` : ''
  const locationNote = presence.location ? ` at ${presence.location}` : ''
  const STAKES: Record<Exclude<PresenceStatus, 'available'>, string> = {
    busy: `is genuinely supposed to be busy right now${activityNote}${locationNote}, per their own routine. Starting a date, a deep unhurried moment, or escalating intimacy right this instant should read as a real, noticed cost, stepping away from something they're actually on the hook for, not a free action. ${charName} can still go along with it, but let some honest friction show (reluctance, a glance at the time, guilt, something they're now not doing) rather than the schedule silently not existing.`,
    sleeping: `is supposed to be asleep right now, per their own routine. Being woken for a date or something intimate is a real disruption, not free — grogginess, a genuinely mixed reaction, or asking why this couldn't wait are all fair, honest responses instead of snapping instantly alert and ready.`,
    traveling: `is currently traveling${locationNote}, not settled somewhere a real date or a deep, unhurried scene can comfortably start. That's a real physical constraint on how this moment can play out right now, not just flavor text to ignore.`,
  }
  return `${charName} ${STAKES[presence.status]}`
}

/** Formats a selected reaction as a durable memory line (meant to be persisted as a `ChatFact`), framed as reported/relayed rather than the connection actually appearing in scene. */
export function describeSocialReaction(charName: string, reaction: SocialReaction): string {
  return `${reaction.connectionName} (${charName}'s ${reaction.relation}) heard about ${reaction.topic} and had something to say about it — ${charName} can bring this up in a later scene as a real secondhand mention (something ${reaction.connectionName} said, texted, or was overheard saying), relayed in ${charName}'s own words, not as ${reaction.connectionName} literally appearing.`
}
