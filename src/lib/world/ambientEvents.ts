import type { PresenceStatus, ScheduleEntry, WeatherPreferences } from '@/lib/world/calendar'
import { describeWeather, getCalendarInfo, getCurrentActivity, getWeather, pickFrom, seededFraction } from '@/lib/world/calendar'

/**
 * The generative half of the World Clock — named directly by the playthrough report that found the
 * gap: `calendar.ts` changes only when the player manually advances it, and even then nothing
 * follows from it. Nothing new to do, notice, or talk about ever surfaces on its own. This module is
 * that missing consequence: a small, concrete "something is going on" hook, deterministically
 * selected from state the world/character already authors — today's calendar/weather against the
 * character's own `weatherPreferences`, their `schedule`, `likes`, `goals`, and
 * `frequentedLocations` — rather than generic filler or any newly-persisted storage.
 *
 * Same split as everything else in `prompt/` (`sceneProgressionNudge`, `mindGuidance.ts`): plain,
 * pure, deterministic code decides *whether* a hook exists and *what* it concretely is; the model
 * only ever writes the actual prose around it. This module deliberately stays agnostic about *how*
 * a hook reaches the player and exposes one core query (`selectAmbientEvent`) plus one shared
 * formatter (`describeAmbientEvent`) that either existing delivery channel can call:
 *  - `dating/outreach.ts` already wires these in as its own `'life_event'` `OutreachReason`, so a
 *    proactive first-text can be grounded in something real instead of generic "thinking of you"
 *    small talk. See that file for the live call site.
 *  - The live per-turn `styleGuidance` channel (`sceneProgressionNudge`'s own channel, assembled in
 *    `useChatSession.ts`) additionally needs `ambientEventGuidance` below for turn-based gating — see
 *    its own doc comment for why that gating can't reuse `evaluateOutreach`'s real-time-silence
 *    approach, and see this module's own report/handoff notes for the exact call site to add it to.
 *
 * Deliberately persists nothing new (no "last fired" timestamp, no visited-location log): every
 * value here is a pure function of inputs the app already has in hand — the world's day/phase, and
 * the character's own authored fields — exactly the constraint `calendar.ts`'s own top comment
 * already documents, which this module inherits rather than works around.
 */

export const AMBIENT_EVENT_KINDS = [
  'holiday',
  'weather_loved',
  'weather_hated',
  'routine_absence',
  'goal_on_mind',
  'free_time_interest',
] as const
export type AmbientEventKind = (typeof AMBIENT_EVENT_KINDS)[number]

export interface AmbientEvent {
  kind: AmbientEventKind
  /** The concrete specific this hook is about — a holiday name, weather description, location, goal, or interest — substituted into `describeAmbientEvent`'s line. */
  detail: string
  /** Only set for `'routine_absence'` — a deterministic, unstored "days since last there" figure, for that kind's phrasing alone. */
  daysSinceVisited?: number
}

export interface AmbientEventContext {
  /** Undefined for a character with no bound world — weather-based hooks are skipped outright, since "today's weather" isn't a meaningful concept with no world to have any. */
  worldId?: string
  characterId: string
  day: number
  phaseIndex: number
  schedule?: ScheduleEntry[]
  likes?: string[]
  goals?: string[]
  frequentedLocations?: string[]
  weatherPreferences?: WeatherPreferences
}

/** How many in-fiction days a "hasn't been there in a while" gap is allowed to claim — plausible without being absurd. */
const ROUTINE_ABSENCE_MIN_DAYS = 5
const ROUTINE_ABSENCE_MAX_DAYS = 18

/** How often (in in-fiction days) which authored goal feels topical can change — long enough to read as something genuinely on their mind for a while, not a new thought every single day. */
const GOAL_CYCLE_DAYS = 3

/**
 * A frequented location the character's own schedule has them at *right now* is never "overdue" —
 * only a place their routine ISN'T presently taking them plausibly reads as a gap in it. Week-
 * bucketed rather than per-day: the gap (which place, how many days) should hold steady for a
 * stretch, not reroll to a different place and a different day-count every single in-fiction day.
 */
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

/** One authored goal, cycled every `GOAL_CYCLE_DAYS` — "on her mind" without literally modeling due dates, which nothing in the card spec authors. */
function selectGoalOnMind(ctx: AmbientEventContext): AmbientEvent | undefined {
  if (!ctx.goals?.length) return undefined
  const cycleBucket = Math.floor(ctx.day / GOAL_CYCLE_DAYS)
  const goal = pickFrom(ctx.goals, `ambient:goal:${ctx.characterId}:${cycleBucket}`)
  return { kind: 'goal_on_mind', detail: goal }
}

/** Only fires while the character's own schedule (or the no-schedule default) reads as free right now — "idle time itching toward a personal interest" is a meaningful signal only when it's actually idle time. */
function selectFreeTimeInterest(ctx: AmbientEventContext): AmbientEvent | undefined {
  if (!ctx.likes?.length) return undefined
  if (getCurrentActivity(ctx.schedule, ctx.day, ctx.phaseIndex).status !== 'available') return undefined
  const like = pickFrom(ctx.likes, `ambient:like:${ctx.characterId}:${ctx.day}:${ctx.phaseIndex}`)
  return { kind: 'free_time_interest', detail: like }
}

/**
 * The single entry point for "what's the best concrete ambient hook right now, if any" — pure and
 * deterministic, cheap enough to call every turn. A named holiday takes unconditional priority
 * (the rarest, most self-evidently special case — 4 out of every 112 in-fiction days); everything
 * else pools together and is drawn from with a seeded, uniform pick, so a character authored with
 * several qualifying hooks at once doesn't always favor the same one.
 */
export function selectAmbientEvent(ctx: AmbientEventContext): AmbientEvent | undefined {
  const info = getCalendarInfo(ctx.day)
  if (info.holiday) return { kind: 'holiday', detail: info.holiday }

  const candidates: AmbientEvent[] = []
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

/**
 * Formats a selected hook into a model-facing line — real names interpolated directly, never
 * `{{char}}`/`{{user}}` macros, since neither the per-turn `styleGuidance` channel nor outreach's own
 * style hint is macro-substituted (`prompt/builder.ts`'s `sub()` only runs over specific named
 * fields — see `mindGuidance.ts`'s own note on the same point). Shared by both delivery channels so
 * the wording is one thing, not two copies that quietly drift apart.
 */
export function describeAmbientEvent(charName: string, event: AmbientEvent): string {
  return HOOK_LINES[event.kind](charName, event)
}

/** Below this many of the character's own replies, nothing fires — a brand new chat has no established world/routine texture yet worth surfacing. */
const AMBIENT_EVENT_MIN_TURNS = 4

/**
 * Rolled once per turn (not per world day/phase): the world clock only advances on a deliberate
 * player action, so gating on it would mean this feature going silent for an entire long session
 * sitting on one unchanging day/phase — precisely the "mechanically inert" gap it exists to close.
 * ~1-in-7 chance a turn once eligible: rare enough to read as a genuine, occasional notice rather
 * than a running commentary, frequent enough to actually show up within one normal sitting.
 */
const AMBIENT_EVENT_CHANCE = 0.15

/**
 * The per-turn `styleGuidance` producer — same shape as `sceneProgressionNudge(count, opts)`:
 * deterministic gating in code, `describeAmbientEvent` (i.e. the model) writes the actual prose.
 * `charTurnCount` is the caller's own responsibility to compute (e.g. `countCharReplies(messages)`
 * from `dating/aftercare.ts`, the same helper `afterglowTurnsSince` already uses) — kept as a plain
 * number rather than a message array here so this stays a small, easily-tested function of a few
 * values, callable from more than one place without re-deriving the count differently each time.
 * Returns `''` with no event selected, below the turn floor, or when the seeded roll misses — so a
 * chat that hasn't earned an ambient beat yet, or simply didn't roll one this turn, pays nothing.
 */
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

/**
 * The "NPCs outside the primary notice things" half of world liveliness — a named person from the
 * character's own already-authored `socialConnections` (10e), someone real to this world who isn't
 * actually in the scene, reacting to something that happened (a milestone, a jealousy beat, whatever
 * a world author's own `triggers.ts` rule decided was reaction-worthy via a `social_reaction`
 * action). Deliberately grounded in authored data rather than inventing a name: with no
 * `socialConnections` at all, this simply never fires, exactly like every other hook in this module
 * having nothing to draw from.
 *
 * `topic` itself is NOT decided here — it comes from the trigger action that called this, since
 * *whether* something is reaction-worthy is exactly the kind of authored condition/one-shot-vs-
 * repeatable judgment `triggers.ts` already owns. This function's only job is the one still missing:
 * which of possibly several authored connections plausibly heard about it, deterministically and
 * reproducibly rather than always picking the first one in the list.
 */
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

/**
 * The schedule half of "the world pushes back, not just narrates" — `calendar.ts`'s own top comment
 * already admits `getCurrentActivity`/`describePresence` are flavor-only: nothing today actually
 * costs anything when a character's own authored schedule has them genuinely busy, asleep, or
 * traveling right now. This is deliberately not a hard block — nothing here prevents a date, a deep
 * moment, or an intimacy escalation from starting — it gives the model an honest, concrete cost
 * signal instead of the schedule silently not existing the instant something is suggested for
 * *right now*. Returns `''` while genuinely free (`'available'`), exactly like every other guidance
 * function in this file paying nothing when there's nothing to say.
 */
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

/**
 * Formats a selected reaction into a durable memory line — meant to be written as a `ChatFact`
 * (the same channel a trigger's own `remember` action already uses, per `describeAction`'s doc
 * comment for `social_reaction`), so it rides into every later prompt as a real, secondhand mention
 * rather than a one-off toast that's forgotten the instant the turn ends. Framed explicitly as
 * reported/relayed, not a live appearance — this connection is not actually in the scene.
 */
export function describeSocialReaction(charName: string, reaction: SocialReaction): string {
  return `${reaction.connectionName} (${charName}'s ${reaction.relation}) heard about ${reaction.topic} and had something to say about it — ${charName} can bring this up in a later scene as a real secondhand mention (something ${reaction.connectionName} said, texted, or was overheard saying), relayed in ${charName}'s own words, not as ${reaction.connectionName} literally appearing.`
}
