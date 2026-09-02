/**
 * A deterministic, shared "living world" clock — the foundation ROADMAP.md section 10a calls
 * for, and the piece almost everything else in that section reads from. Everything here is a
 * pure function of an absolute day number (plus a seed id for weather/mood), so nothing needs
 * its own storage beyond the two integers that actually change — `WorldCard.currentDay` and
 * `currentPhaseIndex` — season, weekday, holiday, weather, and mood-of-day are all recomputed on
 * demand, never persisted, and always reproducible for the same inputs (weather is "browsable a
 * few days ahead" for free, just by calling getWeather with a larger day number).
 *
 * Deliberately NOT built yet (see ROADMAP.md 10a): the energy/action economy that's meant to
 * drive phase advancement during real play, and the economy/currency system. `advancePhase` is
 * exposed as a plain manual step for now (a creator/testing control in the World editor) so the
 * clock itself is usable and its output can start feeding the prompt before that larger system
 * exists — advancing it is not yet tied to any in-chat action.
 */

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const
export type Season = (typeof SEASONS)[number]

export const DAYS_PER_SEASON = 28
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length // 112

export const PHASES = ['morning', 'afternoon', 'evening', 'night'] as const
export type DayPhase = (typeof PHASES)[number]

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** One fixed holiday per season, placed at each season's midpoint (day 14 of 28). */
const HOLIDAYS: Record<Season, { name: string; dayOfSeason: number }> = {
  spring: { name: 'First Bloom', dayOfSeason: 14 },
  summer: { name: 'Midsummer Night', dayOfSeason: 14 },
  autumn: { name: 'Lantern Festival', dayOfSeason: 14 },
  winter: { name: 'Long Night', dayOfSeason: 14 },
}

export interface CalendarInfo {
  /** Absolute day count, wrapped into the 112-day year. */
  day: number
  season: Season
  /** 1-28. */
  dayOfSeason: number
  weekday: Weekday
  holiday?: string
}

export function getCalendarInfo(day: number): CalendarInfo {
  const wrapped = ((day % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR
  const seasonIndex = Math.floor(wrapped / DAYS_PER_SEASON)
  const season = SEASONS[seasonIndex]
  const dayOfSeason = (wrapped % DAYS_PER_SEASON) + 1
  // Every season starts on a Monday, and DAYS_PER_SEASON (28) is divisible by 7, so the weekday
  // cycle realigns to Monday at the start of every season, not just once a year.
  const weekday = WEEKDAYS[(dayOfSeason - 1) % 7]
  const holiday = HOLIDAYS[season].dayOfSeason === dayOfSeason ? HOLIDAYS[season].name : undefined
  return { day: wrapped, season, dayOfSeason, weekday, holiday }
}

export const WEATHER_KINDS = ['clear', 'rain', 'storm', 'overcast', 'snow', 'wind', 'fog'] as const
export type WeatherKind = (typeof WEATHER_KINDS)[number]

/** Repeating an entry biases the pick toward it — a cheap weighting without a separate weight table. */
const WEATHER_BY_SEASON: Record<Season, WeatherKind[]> = {
  spring: ['clear', 'rain', 'rain', 'overcast', 'wind'],
  summer: ['clear', 'clear', 'clear', 'storm', 'overcast'],
  autumn: ['clear', 'wind', 'rain', 'fog', 'overcast'],
  winter: ['clear', 'clear', 'snow', 'storm', 'fog'],
}

const WEATHER_DESCRIPTIONS: Record<WeatherKind, string> = {
  clear: 'clear and mild',
  rain: 'raining steadily',
  storm: 'stormy',
  overcast: 'gray and overcast',
  snow: 'snowing',
  wind: 'blustery and windy',
  fog: 'thick with fog',
}

export function describeWeather(kind: WeatherKind): string {
  return WEATHER_DESCRIPTIONS[kind]
}

/** A tiny deterministic hash -> [0,1) generator, so the same seed always produces the same pick. */
function seededFraction(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

function pickFrom<T>(options: T[], seed: string): T {
  const idx = Math.min(options.length - 1, Math.floor(seededFraction(seed) * options.length))
  return options[idx]
}

/** Deterministic per-world-per-day weather — same day always reads the same, browsable ahead of time. */
export function getWeather(worldId: string, day: number): WeatherKind {
  const info = getCalendarInfo(day)
  return pickFrom(WEATHER_BY_SEASON[info.season], `weather:${worldId}:${info.day}`)
}

const MOODS = [
  'upbeat',
  'tired',
  'a little anxious',
  'content',
  'irritable',
  'wistful',
  'restless',
  'unusually cheerful',
]

/** Deterministic per-character-per-day mood — nudges tone, never dictates it (see ROADMAP.md 10a). */
export function getMoodOfDay(characterId: string, day: number): string {
  const info = getCalendarInfo(day)
  return pickFrom(MOODS, `mood:${characterId}:${info.day}`)
}

/** Advances the clock by one phase, rolling over to the next day after night. */
export function advancePhase(day: number, phaseIndex: number): { day: number; phaseIndex: number } {
  const next = phaseIndex + 1
  if (next >= PHASES.length) return { day: day + 1, phaseIndex: 0 }
  return { day, phaseIndex: next }
}

export interface WeatherPreferences {
  loves?: WeatherKind[]
  hates?: WeatherKind[]
}

/** A short, deterministic, model-facing line describing "right now" in this world for this character. */
export function describeWorldMoment(opts: {
  worldId: string
  characterId: string
  day: number
  phaseIndex: number
  weatherPreferences?: WeatherPreferences
}): string {
  const info = getCalendarInfo(opts.day)
  const phase = PHASES[Math.max(0, Math.min(PHASES.length - 1, opts.phaseIndex))]
  const weather = getWeather(opts.worldId, opts.day)
  const mood = getMoodOfDay(opts.characterId, opts.day)
  const holidayNote = info.holiday ? ` — today is ${info.holiday}` : ''
  const weatherNote = opts.weatherPreferences?.loves?.includes(weather)
    ? ' (a kind of weather {{char}} loves)'
    : opts.weatherPreferences?.hates?.includes(weather)
      ? ' (a kind of weather {{char}} dislikes)'
      : ''
  return `It's ${phase} on a ${info.season} ${info.weekday}${holidayNote}. The weather is ${describeWeather(weather)}${weatherNote}. {{char}} is feeling ${mood} today.`
}

export type PresenceStatus = 'available' | 'busy' | 'sleeping' | 'traveling'

/**
 * One routine slot in a character's week (ROADMAP.md 10f's "Schedules" bullet) — the prerequisite
 * for proactive outreach: a character can't decide whether they're free to text the player without
 * first having something to be doing at all. Deliberately simple (a flat list of slots, no
 * recurrence rules beyond "every day" vs specific weekdays) rather than a full calendar system.
 */
export interface ScheduleEntry {
  id: string
  /** Which weekdays this applies to — unset/empty means every day. */
  days?: Weekday[]
  phase: DayPhase
  status: PresenceStatus
  activity: string
  location?: string
}

/**
 * Resolves what a character is doing right now: a day-specific entry beats an "every day" one for
 * the same phase; the first match in authoring order wins among ties. No schedule at all, or no
 * matching slot, defaults to available/free time — an unscheduled character isn't assumed busy.
 */
export function getCurrentActivity(
  schedule: ScheduleEntry[] | undefined,
  day: number,
  phaseIndex: number,
): { status: PresenceStatus; activity?: string; location?: string } {
  if (!schedule?.length) return { status: 'available' }
  const info = getCalendarInfo(day)
  const phase = PHASES[Math.max(0, Math.min(PHASES.length - 1, phaseIndex))]
  const forPhase = schedule.filter((e) => e.phase === phase)
  const entry = forPhase.find((e) => e.days?.includes(info.weekday)) ?? forPhase.find((e) => !e.days?.length)
  if (!entry) return { status: 'available' }
  return { status: entry.status, activity: entry.activity, location: entry.location }
}

const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  available: 'free',
  busy: 'busy',
  sleeping: 'asleep',
  traveling: 'traveling',
}

export function presenceLabel(status: PresenceStatus): string {
  return PRESENCE_LABELS[status]
}

/** A short, deterministic, model-facing line describing what a character is doing right now — merged alongside describeWorldMoment's weather/mood line, not a replacement for it. */
export function describePresence(presence: { status: PresenceStatus; activity?: string; location?: string }): string {
  const where = presence.location ? ` at ${presence.location}` : ''
  if (!presence.activity) return `{{char}} is currently ${presenceLabel(presence.status)}.`
  return `{{char}} is currently ${presenceLabel(presence.status)} — ${presence.activity}${where}.`
}
