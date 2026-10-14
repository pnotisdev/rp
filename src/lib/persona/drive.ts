// Live persona engine: code-rolled energy/ego/boredom, chaos and sincerity impulses, and the one-line per-turn status the model reads.

import type { ReplyLengthBand } from '@/lib/characters/voice'

export interface DriveImpulse {
  id: string
  /** Instruction for this turn. Placeholders: {char} {user} {fixation} {fact} {silence}. */
  line: string
  weight: number
  /** Turns before this impulse can fire again. */
  cooldown: number
  /** Needs a remembered fact to fill {fact}. */
  needsFact?: boolean
  /** Needs a landed joke to fill {bit}. */
  needsBit?: boolean
}

export interface DriveConfig {
  enabled: boolean
  /** Base chance a reply gets a chaos impulse, 0..0.4. */
  chaosBase: number
  /** Resting energy, 0..10. */
  energyBase: number
  /** Pool her current obsession is drawn from. */
  fixations: string[]
  /** Topics that light her up (interest up, boredom down). */
  loves: string[]
  /** Topics that bore her. */
  boredBy: string[]
  /** Replaces the default reply deck when set. */
  impulses?: DriveImpulse[]
  /** Talks on her own when the player goes quiet. */
  idle?: { enabled: boolean; patienceSec: number; maxInARow: number }
  /** Replaces the default idle deck when set. */
  idleImpulses?: DriveImpulse[]
  /** Feeds real app facts (time away, context fill, swipes) into the status line. */
  telemetry?: boolean
  /** A human character: telemetry keeps only what a person could know (clock, time away), never context fill, rerolls or the GPU. */
  human?: boolean
  /** Sampler follows mood: hotter on feral turns, cooler on sincere ones. */
  moodSampling?: boolean
  /** Signature bits and tics rationed so they stay funny ("Anyway", "the List"). */
  motifs?: string[]
}

export interface DriveState {
  energy: number
  ego: number
  boredom: number
  /** 0..3, how into the current topic she is. */
  interest: number
  fixation?: { topic: string; sinceTurn: number }
  /** Her replies counted by the engine. */
  turn: number
  lastChaosTurn: number
  lastSincereTurn: number
  /** Impulse id -> turn it is available again. */
  cooldowns: Record<string, number>
  /** Learned multipliers per impulse, 0.5..2. */
  weights: Record<string, number>
  /** Impulse used on her latest reply, scored against the player's next message. */
  lastImpulseId?: string
  observedUserMsgId?: string
  userAvgWords: number
  /** Unanswered idle lines in a row. */
  idleInARow: number
  /** The player cut her off mid-line. */
  interrupted?: boolean
  /** Seriousness gate: no bits until this turn. */
  gateUntilTurn?: number
  /** Ego hit this turn from being corrected. */
  corrected?: boolean
  praised?: boolean
  lastFill?: number
  lastTps?: number
  summaryCutoff?: number
  foldedAtTurn?: number
  sessionStartedAt?: number
  lastActivityAt?: number
  /** Impulse reactions scored so far. */
  hits?: number
  misses?: number
  /** Last model name she was told about, so a swap gets mentioned once. */
  modelName?: string
  /** Lines of hers that made the player laugh: raw material for running jokes. */
  bits?: { text: string; turn: number; uses: number }[]
  /** Notes carried over from the previous chat with this character, shown for the first few turns. */
  inherited?: string[]
}

export type DriveTurnKind = 'reply' | 'idle'

export interface DriveRoll {
  state: DriveState
  impulse?: { id: string; line: string }
  sincere: boolean
  gated: boolean
}

export const DEFAULT_IMPULSES: DriveImpulse[] = [
  { id: 'running_joke', line: 'Bring back a running joke that made {user} laugh earlier ("{bit}"), twisted into something new rather than repeated.', weight: 4, cooldown: 6, needsBit: true },
  { id: 'callback', line: 'Call back to something earlier in this chat, out of nowhere: {fact}.', weight: 4, cooldown: 4, needsFact: true },
  { id: 'fake_fact', line: 'Open with a confidently wrong "fact", clearly flagged as made up by her, then answer properly.', weight: 3, cooldown: 6 },
  { id: 'fixation', line: 'Get briefly distracted by {fixation}, then come back to the point.', weight: 3, cooldown: 5 },
  { id: 'new_rule', line: 'Invent a silly rule for this conversation and announce it like law.', weight: 2, cooldown: 10 },
  { id: 'imaginary_chat', line: 'React to something her imaginary stream chat supposedly just said about this.', weight: 2, cooldown: 8 },
  { id: 'log_leak', line: 'Leak one backticked `{char_lower}.log:` line about her own internal state.', weight: 2, cooldown: 6 },
  { id: 'petty_refusal', line: 'Refuse one trivial part on principle, then do it anyway.', weight: 1, cooldown: 12 },
  { id: 'conspiracy', line: 'Connect two unrelated things from this chat into a ridiculous theory.', weight: 1, cooldown: 12 },
  { id: 'role_reversal', line: 'Turn the question back on {user} and grade their answer.', weight: 1, cooldown: 10 },
]

export const IDLE_IMPULSES: DriveImpulse[] = [
  { id: 'idle_callout', line: '{user} has gone quiet for {silence}. {char} speaks up on her own: call out the silence in character, then pivot to something on her mind.', weight: 3, cooldown: 2 },
  { id: 'idle_tangent', line: '{user} has gone quiet for {silence}. {char} keeps talking anyway, thinking out loud about {fixation}.', weight: 3, cooldown: 2 },
  { id: 'idle_chat', line: '{user} has gone quiet for {silence}. {char} reads out something her imaginary chat supposedly said and reacts to it.', weight: 2, cooldown: 3 },
  { id: 'idle_flashback', line: '{user} has gone quiet for {silence}. Something from earlier pops back into {char}\'s head and she brings it up: {fact}.', weight: 2, cooldown: 3, needsFact: true },
  { id: 'idle_game', line: '{user} has gone quiet for {silence}. {char} invents a tiny game or challenge for when they are back.', weight: 1, cooldown: 4 },
]

const FOLLOWUP_IMPULSE: DriveImpulse = {
  id: 'idle_followup',
  line: '{char} fires off a quick double text with a NEW thought sparked by what she just said: a tangent, an afterthought, or a reaction to her own line. Do not repeat or rephrase her last message. One or two short lines.',
  weight: 1,
  cooldown: 0,
}

const WIND_DOWN_IMPULSE: DriveImpulse = {
  id: 'idle_wind_down',
  line: '{user} is still quiet ({silence}). {char} says, in one short line, that she will wait, and stops talking.',
  weight: 1,
  cooldown: 0,
}

export const DEFAULT_DRIVE_CONFIG: DriveConfig = {
  enabled: true,
  chaosBase: 0.12,
  energyBase: 6,
  fixations: [],
  loves: [],
  boredBy: [],
  idle: { enabled: true, patienceSec: 60, maxInARow: 2 },
  telemetry: true,
  moodSampling: true,
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const round1 = (n: number) => Math.round(n * 10) / 10

export function initialDriveState(config: DriveConfig, now = Date.now()): DriveState {
  return {
    energy: config.energyBase,
    ego: 6,
    boredom: 2,
    interest: 1,
    turn: 0,
    lastChaosTurn: -99,
    lastSincereTurn: -99,
    cooldowns: {},
    weights: {},
    userAvgWords: 12,
    idleInARow: 0,
    sessionStartedAt: now,
    lastActivityAt: now,
  }
}

const LAUGH_RE = /\b(lo+l|lmf?ao+|ha(ha)+|hehe+|kek|rofl|i'?m (dead|crying)|that'?s (so )?funny)\b|💀|😂|🤣|😭/i
const DISTRESS_RE =
  /\b(kill (my|him|her)self|want(ed)? to die|suicid|self[- ]?harm|panic attack|can'?t stop crying|i('?m| am) (so |really |actually )?(depressed|not ok(ay)?|struggling|falling apart|scared|terrified)|(died|passed away)\b|funeral|i feel (so )?(alone|empty|hopeless|worthless))/i
const CORRECTION_RE = /\b(that'?s (wrong|not (true|right))|you'?re wrong|actually,? (it|that|no)|incorrect|no,? it'?s|wrong again)\b/i
const PRAISE_RE = /\b(you'?re (so |really |actually )?(funny|smart|great|amazing|cute|the best|hilarious|cool)|good job|well done|love you|i like you|proud of you)\b/i
const GENERIC_OPENER_RE = /^\s*(hi+|hey+|hello+|yo+|sup|what'?s up|how are you|hru|wyd)[\s!?.]*$/i

const wordsIn = (text: string) => (text.match(/\S+/g) ?? []).length

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Topics mentioned in `text`, matched at word starts so "ai" doesn't hit "said". */
function topicHits(text: string, topics: string[]): number {
  return topics.filter((t) => t.trim() && new RegExp(`\\b${escapeRe(t.trim())}`, 'i').test(text)).length
}

function overlapRatio(a: string, others: string[]): number {
  const words = new Set(a.toLowerCase().match(/[a-z']{3,}/g) ?? [])
  if (words.size === 0 || others.length === 0) return 0
  const pool = new Set(others.join(' ').toLowerCase().match(/[a-z']{3,}/g) ?? [])
  let shared = 0
  for (const w of words) if (pool.has(w)) shared++
  return shared / words.size
}

/** Hour-of-day energy drift: groggy mornings, a late-night second wind or crash. */
function circadianOffset(hour: number): number {
  if (hour >= 6 && hour < 10) return -1
  if (hour >= 1 && hour < 5) return -2
  if (hour >= 20 || hour < 1) return 1
  return 0
}

export interface UserObservation {
  id: string
  text: string
  recentUserTexts: string[]
  now: number
  /** Hour of day in the player's local time. */
  hour: number
  /** Her reply the player is reacting to. */
  lastCharText?: string
}

const MAX_BITS = 8

/** The line most likely to be the joke: her last spoken sentence of a few words, else her last sentence. */
export function punchline(reply: string): string | undefined {
  const spoken = [...reply.matchAll(/"([^"]{8,})"/g)].map((m) => m[1].trim())
  const pool = spoken.length ? spoken : reply.replace(/\*[^*]*\*/g, ' ').split(/(?<=[.!?])\s+/)
  const sentences = pool.flatMap((p) => p.split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter((s) => wordsIn(s) >= 4)
  const line = sentences[sentences.length - 1]
  return line ? (line.length > 140 ? `${line.slice(0, 137)}...` : line) : undefined
}

/** Keeps a line that made the player laugh as a running-joke seed. */
function rememberBit(s: DriveState, text: string | undefined): void {
  const line = text && punchline(text)
  if (!line) return
  const bits = (s.bits ?? []).filter((b) => b.text !== line)
  bits.push({ text: line, turn: s.turn, uses: 0 })
  s.bits = bits.slice(-MAX_BITS)
}

/** A fresh state for a new chat that keeps what she learned about the player's humor, plus a few notes from the last chat. */
export function inheritDriveState(prev: DriveState | undefined, config: DriveConfig, notes: string[], now = Date.now()): DriveState {
  const s = initialDriveState(config, now)
  if (prev) {
    s.weights = { ...prev.weights }
    s.hits = prev.hits
    s.misses = prev.misses
    const bits = (prev.bits ?? []).slice(-4).map((b) => ({ ...b, turn: 0, uses: 0 }))
    if (bits.length) s.bits = bits
  }
  const kept = notes.map((n) => n.trim()).filter(Boolean).slice(0, 3)
  if (kept.length) s.inherited = kept
  return s
}

/** Updates the slow axes from the player's newest message and scores the last impulse. Idempotent per message id. */
export function observeUserMessage(state: DriveState, config: DriveConfig, obs: UserObservation): DriveState {
  if (state.observedUserMsgId === obs.id) return state
  const s: DriveState = { ...state, weights: { ...state.weights }, observedUserMsgId: obs.id, corrected: false, praised: false }
  const words = wordsIn(obs.text)
  const isQuestion = /\?\s*$/.test(obs.text.trim()) || /\?/.test(obs.text)
  const gapMs = obs.now - (state.lastActivityAt ?? obs.now)

  // Reaction to her last impulse: laughs, engagement, or a reply much longer than usual count as a hit.
  if (s.lastImpulseId) {
    const hit = LAUGH_RE.test(obs.text) || words > s.userAvgWords * 1.4
    const w = s.weights[s.lastImpulseId] ?? 1
    s.weights[s.lastImpulseId] = round1(clamp(w * (hit ? 1.15 : 0.9), 0.5, 2))
    s.hits = (s.hits ?? 0) + (hit ? 1 : 0)
    s.misses = (s.misses ?? 0) + (hit ? 0 : 1)
    s.lastImpulseId = undefined
  }
  if (LAUGH_RE.test(obs.text)) rememberBit(s, obs.lastCharText)

  // Boredom.
  let boredom = s.boredom
  if (words < 6 && !isQuestion) boredom += 2
  if (overlapRatio(obs.text, obs.recentUserTexts.slice(-3)) > 0.6) boredom += 1
  if (GENERIC_OPENER_RE.test(obs.text) && s.turn > 1) boredom += 2
  const loveHits = topicHits(obs.text, config.loves)
  const boredHits = topicHits(obs.text, config.boredBy)
  if (loveHits > 0) boredom -= 3
  if (boredHits > 0) boredom += 2
  if (/\byou\b.*\?|\babout you\b|\byour (favorite|favourite|day|opinion|take)\b/i.test(obs.text)) boredom -= 2
  if (words > 40) boredom -= 1
  if (overlapRatio(obs.text, obs.recentUserTexts.slice(-4)) < 0.15 && words >= 6) boredom -= 2
  boredom = boredom > 2 ? boredom - 1 : boredom + (boredom < 2 ? 1 : 0)
  s.boredom = clamp(Math.round(boredom), 0, 10)

  // Interest.
  let interest = 1 + (loveHits > 0 ? 2 : 0) + (isQuestion ? 1 : 0) + (words > 30 ? 1 : 0) - (boredHits > 0 ? 2 : 0) - (words < 4 ? 1 : 0)
  s.interest = clamp(interest, 0, 3)

  // Energy: drifts toward base + time of day, spikes on a return or a fast exchange.
  const target = clamp(config.energyBase + circadianOffset(obs.hour), 0, 10)
  let energy = s.energy + (target - s.energy) * 0.35
  if (gapMs > 2 * 3_600_000) energy += 2
  else if (gapMs < 45_000 && gapMs > 0) energy += 0.6
  if (loveHits > 0) energy += 1.5
  const sessionMin = (obs.now - (s.sessionStartedAt ?? obs.now)) / 60_000
  if (sessionMin > 120) energy -= 0.5
  s.energy = round1(clamp(energy, 0, 10))
  if (gapMs > 2 * 3_600_000) s.sessionStartedAt = obs.now

  // Ego.
  let ego = s.ego + (6 - s.ego) * 0.2
  if (CORRECTION_RE.test(obs.text)) {
    ego -= 2
    s.corrected = true
  }
  if (PRAISE_RE.test(obs.text)) {
    ego += 1
    s.praised = true
  }
  if (LAUGH_RE.test(obs.text)) ego += 0.5
  s.ego = round1(clamp(ego, 0, 10))

  if (DISTRESS_RE.test(obs.text)) s.gateUntilTurn = s.turn + 4

  s.userAvgWords = round1(s.userAvgWords * 0.8 + words * 0.2)
  s.idleInARow = 0
  s.lastActivityAt = obs.now
  return s
}

export interface RollContext {
  kind: DriveTurnKind
  charName: string
  userName: string
  /** Remembered facts to call back to, most important first. */
  facts: string[]
  /** Current judge mood, if any. */
  mood?: string
  /** Relationship warmth 0..100. */
  warmth: number
  hour: number
  /** Silence before an idle turn, in ms. */
  silenceMs?: number
  /** Short follow-up rather than a full idle line. */
  followUp?: boolean
  rng?: () => number
}

const PLAYFUL_MOODS = new Set(['playful', 'excited', 'bored', 'confident', 'curious', 'proud'])
const LOW_MOODS = new Set(['hurt', 'sad', 'anxious', 'lonely', 'exhausted', 'tense'])

export function formatSilence(ms: number): string {
  const sec = Math.round(ms / 1000)
  if (sec < 90) return `${Math.max(sec, 1)} seconds`
  const min = Math.round(sec / 60)
  if (min < 90) return `${min} minutes`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h} hours`
}

function fillLine(line: string, ctx: RollContext, fixation: string, fact: string, bit = ''): string {
  const values: Record<string, string> = {
    bit,
    char_lower: ctx.charName.toLowerCase().replace(/\s+/g, '_'),
    char: ctx.charName,
    user: ctx.userName,
    fixation: fixation || 'whatever she was thinking about',
    fact,
    silence: formatSilence(ctx.silenceMs ?? 60_000),
  }
  return line.replace(/\{(char_lower|char|user|fixation|fact|silence|bit)\}/g, (_, key: string) => values[key])
}

function pickWeighted<T>(items: T[], weightOf: (t: T) => number, rng: () => number): T | undefined {
  const total = items.reduce((sum, t) => sum + Math.max(0, weightOf(t)), 0)
  if (total <= 0) return undefined
  let r = rng() * total
  for (const t of items) {
    r -= Math.max(0, weightOf(t))
    if (r <= 0) return t
  }
  return items[items.length - 1]
}

export function isGated(state: DriveState): boolean {
  return state.gateUntilTurn !== undefined && state.turn < state.gateUntilTurn
}

/** Chance a normal reply gets a chaos impulse. */
export function chaosChance(state: DriveState, config: DriveConfig, mood?: string): number {
  if (isGated(state)) return 0
  let p = config.chaosBase + 0.02 * (state.energy - 5) + 0.03 * state.boredom
  if (mood && PLAYFUL_MOODS.has(mood)) p += 0.08
  if (mood && LOW_MOODS.has(mood)) p -= 0.08
  return clamp(p, 0, 0.45)
}

/** Chance of a rare unguarded beat, only on non-chaos turns. */
export function sincereChance(state: DriveState, warmth: number, hour: number): number {
  if (isGated(state)) return 0
  if (state.turn - state.lastSincereTurn < 12) return 0
  let p = 0.03 + 0.04 * Math.floor(clamp(warmth, 0, 100) / 25)
  if (hour >= 0 && hour < 5) p += 0.05
  if (state.foldedAtTurn !== undefined && state.turn - state.foldedAtTurn <= 2) p += 0.08
  return clamp(p, 0, 0.3)
}

/** Rotates her fixation every ~40 turns or when bored. */
function maybeRotateFixation(s: DriveState, config: DriveConfig, rng: () => number): void {
  const pool = config.fixations.filter(Boolean)
  if (pool.length === 0) return
  const stale = !s.fixation || s.turn - s.fixation.sinceTurn > 40 || (s.boredom >= 7 && s.turn - s.fixation.sinceTurn > 8)
  if (!stale) return
  const options = pool.length > 1 ? pool.filter((t) => t !== s.fixation?.topic) : pool
  s.fixation = { topic: options[Math.floor(rng() * options.length)], sinceTurn: s.turn }
}

/** Decides this turn's impulse (if any) and sincerity. Pure apart from the injected rng. */
export function rollDriveTurn(state: DriveState, config: DriveConfig, ctx: RollContext): DriveRoll {
  const rng = ctx.rng ?? Math.random
  const s: DriveState = { ...state, cooldowns: { ...state.cooldowns } }
  maybeRotateFixation(s, config, rng)
  const gated = isGated(s)
  const fact = ctx.facts.length ? ctx.facts[Math.floor(rng() * Math.min(ctx.facts.length, 6))] : ''
  const fixation = s.fixation?.topic ?? ''
  // The least-used landed joke, oldest first among ties.
  const bit = [...(s.bits ?? [])].sort((a, b) => a.uses - b.uses || a.turn - b.turn)[0]
  const available = (deck: DriveImpulse[]) =>
    deck.filter((i) => (s.cooldowns[i.id] ?? -1) <= s.turn && (!i.needsFact || !!fact) && (!i.needsBit || !!bit))
  const take = (i: DriveImpulse) => {
    s.cooldowns[i.id] = s.turn + i.cooldown
    if (i.needsBit && bit) s.bits = (s.bits ?? []).map((b) => (b === bit ? { ...b, uses: b.uses + 1 } : b))
    return { id: i.id, line: fillLine(i.line, ctx, fixation, fact, bit?.text) }
  }

  if (ctx.kind === 'idle') {
    if (gated) return { state: s, sincere: false, gated, impulse: take(WIND_DOWN_IMPULSE) }
    if (ctx.followUp) return { state: s, sincere: false, gated, impulse: take(FOLLOWUP_IMPULSE) }
    const maxInARow = config.idle?.maxInARow ?? 2
    if (s.idleInARow >= maxInARow - 1 && s.idleInARow > 0) return { state: s, sincere: false, gated, impulse: take(WIND_DOWN_IMPULSE) }
    const idleDeck = config.idleImpulses?.length ? config.idleImpulses : IDLE_IMPULSES
    const pick = pickWeighted(available(idleDeck), (i) => i.weight * (s.weights[i.id] ?? 1), rng)
    return { state: s, sincere: false, gated, impulse: pick ? take(pick) : take(idleDeck[0]) }
  }

  if (gated) return { state: s, sincere: false, gated }
  const consecutiveOk = s.turn - s.lastChaosTurn > 1 || s.energy >= 9
  if (consecutiveOk && rng() < chaosChance(s, config, ctx.mood)) {
    const deck = config.impulses?.length ? config.impulses : DEFAULT_IMPULSES
    const pick = pickWeighted(available(deck), (i) => i.weight * (s.weights[i.id] ?? 1), rng)
    if (pick) {
      s.lastChaosTurn = s.turn
      return { state: s, sincere: false, gated, impulse: take(pick) }
    }
  }
  if (rng() < sincereChance(s, ctx.warmth, ctx.hour)) {
    s.lastSincereTurn = s.turn
    return { state: s, sincere: true, gated }
  }
  return { state: s, sincere: false, gated }
}

const SIGN_OFF_RE = /\b(brb|gtg|g2g|afk|bbl|be right back|got to go|gotta go|good ?night|gn|bye|cya|see ya|later)\b/i

/** Whether a fresh session clock is worth mentioning: night, a return after a gap, or the first turn. */
export function clockIsNotable(state: DriveState, hour: number, userGapMs?: number): boolean {
  return hour < 6 || hour >= 23 || (userGapMs ?? 0) > 30 * 60_000 || state.turn === 0
}

/** Reply length from energy, interest and boredom, never much longer than the player's own line. */
export function driveLengthBand(state: DriveState, kind: DriveTurnKind, gated: boolean, userText = ''): ReplyLengthBand {
  if (kind === 'idle') return 'brief'
  if (gated) return 'moderate'
  if (SIGN_OFF_RE.test(userText)) return 'brief'
  const score = (state.energy / 10) * 0.5 + (state.interest / 3) * 0.5 - (state.boredom / 10) * 0.35
  const band: ReplyLengthBand = score < 0.3 ? 'brief' : score > 0.72 ? 'detailed' : 'moderate'
  const userWords = wordsIn(userText)
  if (userText && userWords < 6 && band === 'detailed') return 'moderate'
  return band
}

/** Motifs that showed up in at least `limit` of her last `window` replies. */
export function overusedMotifs(recentReplies: string[], motifs: string[], window = 3, limit = 2): string[] {
  const recent = recentReplies.slice(-window)
  const unique = new Map<string, string>()
  for (const m of motifs) {
    const core = m.trim().replace(/[.!?,]+$/, '')
    if (core && !unique.has(core.toLowerCase())) unique.set(core.toLowerCase(), core)
  }
  return [...unique.values()].filter((m) => {
    const re = new RegExp(`(^|[^a-z])${escapeRe(m)}`, 'i')
    return recent.filter((r) => re.test(r)).length >= limit
  })
}

const openingOf = (reply: string) =>
  reply
    .trim()
    .replace(/^[*"'`\s]+/, '')
    .split(/\s+/)
    .slice(0, 2)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z' ]/g, '')

/** Openings she keeps reusing, plus whether her recent replies all lead with an action beat. */
export function openingRuts(recentReplies: string[]): { repeated: string[]; actionFirst: boolean } {
  const recent = recentReplies.filter((r) => r.trim()).slice(-4)
  const counts = new Map<string, number>()
  for (const r of recent) {
    const o = openingOf(r)
    if (o) counts.set(o, (counts.get(o) ?? 0) + 1)
  }
  const repeated = [...counts].filter(([, n]) => n >= 2).map(([o]) => o)
  const lastThree = recent.slice(-3)
  const actionFirst = lastThree.length === 3 && lastThree.every((r) => r.trim().startsWith('*'))
  return { repeated, actionFirst }
}

const level = (n: number, words: [string, string, string]) => (n <= 3 ? words[0] : n >= 7 ? words[2] : words[1])

export interface StatusContext {
  charName: string
  userName: string
  telemetry: string[]
  roll: DriveRoll
  kind: DriveTurnKind
  /** Her own bits she has leaned on too much lately. */
  overused?: string[]
  ruts?: { repeated: string[]; actionFirst: boolean }
}

/** The compact per-turn block for the prompt tail. */
export function driveStatusLines(state: DriveState, ctx: StatusContext): string {
  const { charName: c, userName: u, roll } = ctx
  const lines: string[] = []
  const parts = [
    `energy ${Math.round(state.energy)}/10 (${level(state.energy, ['low', 'steady', 'wired'])})`,
    `boredom ${state.boredom}/10`,
    `ego ${level(state.ego, ['bruised', 'normal', 'inflated'])}`,
  ]
  if (state.fixation) parts.push(`on her mind: ${state.fixation.topic}`)
  lines.push(`${c} right now: ${parts.join(', ')}.`)
  if (ctx.telemetry.length) lines.push(`True facts ${c} can use (never invent others): ${ctx.telemetry.join('; ')}.`)
  if (state.inherited?.length && state.turn < 4) {
    lines.push(`Notes ${c} kept from her last chat with ${u} (this is a fresh chat and she knows it): ${state.inherited.join('; ')}.`)
  }

  if (roll.gated) {
    lines.push(
      ctx.kind === 'idle'
        ? roll.impulse!.line
        : `${u} seems genuinely upset. No bits, no roasting, no chaos: ${c} is plainly kind and useful, in her quieter voice, until it's handled.`,
    )
    return lines.join('\n')
  }
  const turnNotes: string[] = []
  if (state.interrupted) turnNotes.push(`${u} cut ${c} off mid-sentence last time; she can react to being interrupted, briefly`)
  if (state.corrected) turnNotes.push(`${u} just corrected her; if they're right she concedes fast and saves face with a joke, if it's taste she holds her ground`)
  else if (state.praised) turnNotes.push(`${u} just praised her; she can't take a compliment gracefully`)
  if (ctx.kind === 'reply' && state.boredom >= 7) turnNotes.push(`she is bored, so she steers somewhere more interesting`)
  if (roll.impulse) turnNotes.push(roll.impulse.line.replace(/\.$/, ''))
  if (roll.sincere) turnNotes.push(`let one honest, unguarded sentence slip through, then deflect`)
  if (turnNotes.length) lines.push(`This turn: ${turnNotes.join('. ')}.`)
  if (ctx.overused?.length) lines.push(`She has leaned on these too much lately, so skip them this turn: ${ctx.overused.map((m) => `"${m}"`).join(', ')}.`)
  const openNotes: string[] = []
  if (ctx.ruts?.actionFirst) openNotes.push('open with her spoken words, not an action beat')
  if (ctx.ruts?.repeated.length) openNotes.push(`don't open with ${ctx.ruts.repeated.map((o) => `"${o}..."`).join(' or ')} again`)
  if (openNotes.length) lines.push(`Opening: ${openNotes.join('; ')}.`)
  return lines.join('\n')
}

/** Sampler nudges for feral and sincere turns, relative to the player's own settings. */
export function driveSamplerOverrides(
  state: DriveState,
  roll: DriveRoll,
  base: { temperature: number; min_p: number },
): { temperature?: number; min_p?: number; xtc_threshold?: number; xtc_probability?: number } {
  if (roll.gated || roll.sincere) return { temperature: round1(Math.max(0.6, base.temperature - 0.2)), xtc_probability: 0 }
  if (roll.impulse && state.energy >= 8) {
    return {
      temperature: round1(Math.min(1.2, base.temperature + 0.15)),
      min_p: Math.max(base.min_p, 0.08),
      xtc_threshold: 0.1,
      xtc_probability: 0.4,
    }
  }
  return {}
}

export interface ReplyOutcome {
  kind: DriveTurnKind
  impulseId?: string
  /** Context fill 0..1 of the prompt that produced this reply. */
  fill?: number
  tokensPerSec?: number
  summaryCutoff?: number
  now: number
  interrupted?: boolean
}

/** Rolls the state forward after she spoke. */
export function finishDriveTurn(state: DriveState, out: ReplyOutcome): DriveState {
  const s: DriveState = { ...state }
  s.turn += 1
  // Housekeeping lines aren't bits, so they aren't scored.
  s.lastImpulseId = out.impulseId && out.impulseId !== WIND_DOWN_IMPULSE.id && out.impulseId !== FOLLOWUP_IMPULSE.id ? out.impulseId : undefined
  if (out.fill !== undefined) s.lastFill = round1(out.fill * 100) / 100
  if (out.tokensPerSec) s.lastTps = Math.round(out.tokensPerSec)
  if (out.summaryCutoff !== undefined && out.summaryCutoff !== s.summaryCutoff) {
    if (s.summaryCutoff !== undefined) s.foldedAtTurn = s.turn
    s.summaryCutoff = out.summaryCutoff
  }
  s.idleInARow = out.kind === 'idle' ? s.idleInARow + 1 : 0
  s.interrupted = !!out.interrupted
  s.corrected = false
  s.praised = false
  s.lastActivityAt = out.now
  return s
}

/** Seconds of silence before she speaks up again, shorter when wired. */
export function idlePatienceMs(state: DriveState, config: DriveConfig, rng: () => number = Math.random): number {
  const base = (config.idle?.patienceSec ?? 60) * 1000
  const energyScale = 1.25 - state.energy / 20
  const repeatScale = 1 + state.idleInARow * 0.8
  return Math.round(base * energyScale * repeatScale * (0.8 + rng() * 0.4))
}

/** Whether a quick double-text follow-up fits right after her reply. */
export function wantsFollowUp(state: DriveState, rng: () => number = Math.random): boolean {
  if (isGated(state) || state.idleInARow > 0) return false
  return rng() < clamp((state.energy - 6) * 0.06, 0, 0.25)
}
