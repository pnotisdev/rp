/**
 * Reply length and register, derived per-character instead of set globally. `deriveCardReplyBand`
 * measures a card's own example dialogue/greeting; `resolveReplyLength` turns that (or an explicit
 * override) into a concrete sentence-count instruction; `replyMaxTokens` turns the same band into
 * a hard sampler cap that only ever lowers the user's own `max_length`, never raises it.
 */

import type { CharacterCardData } from './cardSpec'

/** `auto` reads the card's own example dialogue; the rest are an explicit authorial override. */
export type ReplyLength = 'auto' | 'brief' | 'moderate' | 'detailed'

/** The three real bands that `auto` resolves to. */
export type ReplyLengthBand = Exclude<ReplyLength, 'auto'>

export const REPLY_LENGTH_LABELS: Record<ReplyLength, string> = {
  auto: 'Match their example dialogue',
  brief: 'Brief',
  moderate: 'Moderate',
  detailed: 'Detailed',
}

export const REPLY_LENGTH_HINTS: Record<ReplyLength, string> = {
  auto: "Measures this card's own example dialogue and greeting, and asks for turns that long. The right choice for a well-written card.",
  brief: 'A line or two. Dialogue-led, at most one short action beat. Good for banter and messaging-style chats.',
  moderate: 'A short paragraph. A couple of lines of speech plus what they are physically doing.',
  detailed: 'Two short paragraphs at most. Room for the character to describe what they notice, still not an essay.',
}

interface BandSpec {
  /** Approx. words per turn in this band, used only for the token cap. */
  words: number
  /** The instruction the model actually reads. */
  instruction: string
}

const BANDS: Record<ReplyLengthBand, BandSpec> = {
  brief: {
    words: 45,
    instruction:
      'Length: keep this turn to one to three sentences. Lead with what they say or do; at most one short action beat. Stop as soon as the turn has landed, even if there is more you could add.',
  },
  moderate: {
    words: 95,
    instruction:
      'Length: keep this turn to one short paragraph, around three to five sentences. Enough for a line or two of speech and what they are physically doing, and no more. Stop there.',
  },
  detailed: {
    words: 175,
    instruction:
      'Length: two short paragraphs at most. Every sentence has to carry something new; cut anything that only restates the mood. Stop once the turn has landed rather than rounding it off.',
  },
}

/** Cut points on measured example-turn length, in words. */
const AUTO_BRIEF_MAX_WORDS = 55
const AUTO_MODERATE_MAX_WORDS = 130

/** SillyTavern's example-dialogue format: `<START>` blocks of alternating `{{user}}:` / `{{char}}:` lines. */
const CHAR_TURN_RE = /^\s*(?:\{\{char\}\}|\{\{CHAR\}\})\s*:\s*(.*)$/
const USER_TURN_RE = /^\s*(?:\{\{user\}\}|\{\{USER\}\})\s*:\s*/
const START_MARKER_RE = /^\s*<START>\s*$/i

/** Words in a stretch of RP prose, ignoring the asterisks and quote marks that wrap it. */
export function countProseWords(text: string): number {
  return text
    .replace(/[*"“”]/g, ' ')
    .split(/\s+/)
    .filter((w) => /[a-zA-Z0-9]/.test(w)).length
}

/** Pulls the character's own turns out of a card's `mes_example`. Yields nothing for loose prose with no speaker labels; the caller falls back to `first_mes`. */
export function extractExampleCharTurns(mesExample: string | undefined): string[] {
  if (!mesExample?.trim()) return []
  const turns: string[] = []
  let current: string[] | null = null
  for (const line of mesExample.split('\n')) {
    if (START_MARKER_RE.test(line) || USER_TURN_RE.test(line)) {
      if (current) turns.push(current.join('\n'))
      current = null
      continue
    }
    const charMatch = line.match(CHAR_TURN_RE)
    if (charMatch) {
      if (current) turns.push(current.join('\n'))
      current = [charMatch[1]]
      continue
    }
    // Continuation line of whichever turn is open; ignored if no speaker label has opened one yet.
    if (current) current.push(line)
  }
  if (current) turns.push(current.join('\n'))
  return turns.map((t) => t.trim()).filter(Boolean)
}

export interface DerivedReplyBand {
  band: ReplyLengthBand
  /** The measured median turn length that produced `band`, in words. 0 when nothing was measurable. */
  measuredWords: number
  /** What the measurement was taken from, so the editor can say so instead of showing a bare guess. */
  source: 'examples' | 'greeting' | 'default'
}

/** Median of a non-empty list — so one long scene-setting example doesn't drag the whole card up a band. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/** What length this card is already written at. Prefers `mes_example` over `first_mes` (a greeting runs longer since it has to establish a scene, so it's discounted before banding). */
export function deriveCardReplyBand(card: Pick<CharacterCardData, 'mes_example' | 'first_mes'>): DerivedReplyBand {
  const exampleTurns = extractExampleCharTurns(card.mes_example)
  const exampleWords = exampleTurns.map(countProseWords).filter((n) => n > 0)
  if (exampleWords.length > 0) {
    const words = median(exampleWords)
    return { band: bandForWords(words), measuredWords: words, source: 'examples' }
  }

  const greetingWords = countProseWords(card.first_mes ?? '')
  if (greetingWords > 0) {
    // Discount the greeting length; greetings run longer than normal turns.
    const words = Math.round(greetingWords * 0.6)
    return { band: bandForWords(words), measuredWords: words, source: 'greeting' }
  }

  // Nothing authored: default to moderate rather than brief.
  return { band: 'moderate', measuredWords: 0, source: 'default' }
}

function bandForWords(words: number): ReplyLengthBand {
  if (words <= AUTO_BRIEF_MAX_WORDS) return 'brief'
  if (words <= AUTO_MODERATE_MAX_WORDS) return 'moderate'
  return 'detailed'
}

export interface ResolvedReplyLength {
  band: ReplyLengthBand
  /** The instruction to inject right before generation. */
  instruction: string
  /** True when the band came from measuring the card rather than from an explicit setting. */
  derived: boolean
  measuredWords: number
}

/** Entry point for both the prompt line and the token cap. `setting` unset behaves as `auto`. */
export function resolveReplyLength(
  setting: ReplyLength | undefined,
  card: Pick<CharacterCardData, 'mes_example' | 'first_mes'>,
): ResolvedReplyLength {
  if (setting && setting !== 'auto') {
    return { band: setting, instruction: BANDS[setting].instruction, derived: false, measuredWords: 0 }
  }
  const derived = deriveCardReplyBand(card)
  const spec = BANDS[derived.band]
  // Point the model at its own card's examples when the band was measured from them.
  const instruction =
    derived.source === 'examples'
      ? `${spec.instruction} Match the length and rhythm of this character's example dialogue; that is how long their turns are meant to run.`
      : spec.instruction
  return { band: derived.band, instruction, derived: true, measuredWords: derived.measuredWords }
}

/**
 * Deterministic "voice fingerprint" extraction (see `VoiceFingerprint` in `cardSpec.ts`) — a
 * zero-cost heuristic pass over the card's own authored dialogue. Never touches `ChatBackend`;
 * the "Detect from examples" button in `CharacterEditor` calls it directly and synchronously.
 */
export interface DetectedVoiceFingerprint {
  /** Filler words/phrases recurring across at least two distinct turns. */
  verbalTics: string[]
  /** 2-4 word phrases repeated verbatim across at least two distinct turns. */
  catchphrases: string[]
  /** Plain-English read on average sentence length, or undefined if not enough prose. */
  sentenceRhythm?: string
  /** Ellipsis/exclamation/question habits, or undefined if none stand out. */
  punctuationNotes?: string
  /** How many of the character's own turns were available to analyze. */
  turnsAnalyzed: number
}

/** Common English function words excluded from n-gram candidates. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'but', 'is', 'are', 'was',
  'were', 'be', 'been', 'it', 'this', 'that', 'i', 'you', 'he', 'she', 'they', 'we', 'my', 'your',
  'his', 'her', 'their', 'our', 'me', 'him', 'them', 'us', 'with', 'as', 'so', 'if', 'not', 'no',
  'do', 'did', 'does', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'then', 'than',
  'there', 'here', 'what', 'who', 'how', 'why', 'when', 'where', 'which', 'from', 'by', 'out',
  'up', 'down', 'over', 'about', 'into', 'some', 'all', 'any', 'one', 'get', 'got', 'im', "i'm",
])

/** Curated filler words/discourse markers worth flagging as a possible verbal tic. */
const TIC_CANDIDATES = [
  'well', 'i mean', 'you know', 'look', 'listen', 'honestly', 'anyway', 'huh', 'hmph', 'hmm',
  'ugh', 'tch', 'geez', 'whatever', 'seriously', 'obviously', 'frankly', 'i guess', 'sort of',
  'kind of', 'or something', 'and stuff', 'basically', 'i suppose', 'i swear', 'for what it\'s worth',
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Lowercased word tokens; punctuation stripped except an internal apostrophe. */
function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[*_~]/g, ' ')
    .split(/[^a-z0-9']+/i)
    .filter(Boolean)
}

/** Text inside quotes — what the character actually said, as opposed to narration. Falls back to the whole turn when dialogue is unquoted. */
function spokenText(turn: string): string {
  const quoted = [...turn.matchAll(/["“]([^"”]+)["”]/g)].map((m) => m[1])
  return quoted.length ? quoted.join(' ') : turn
}

/** Every stretch of this character's own authored dialogue: `mes_example` turns plus `first_mes` and `alternate_greetings`. */
export function collectCharacterTurns(
  card: Pick<CharacterCardData, 'mes_example' | 'first_mes' | 'alternate_greetings'>,
): string[] {
  const exampleTurns = extractExampleCharTurns(card.mes_example)
  const greetings = [card.first_mes, ...(card.alternate_greetings ?? [])]
    .map((t) => t?.trim())
    .filter((t): t is string => !!t)
  return [...exampleTurns, ...greetings]
}

/** Whether this card's own authored text uses the `*action*` / `"speech"` convention — i.e. the
 *  author opted into it. Used to decide whether the prompt should hold a weak model to it; a
 *  deliberately plain-prose card (no asterisks anywhere) is left alone. */
export function usesActionMarkup(card: Pick<CharacterCardData, 'mes_example' | 'first_mes' | 'alternate_greetings'>): boolean {
  return collectCharacterTurns(card).some((t) => /\*[^*\n]+\*/.test(t))
}

/** Detects a `VoiceFingerprint` draft from the card's examples/greetings. Needs at least two turns to find recurring patterns; below that every list comes back empty. */
export function detectVoiceFingerprint(
  card: Pick<CharacterCardData, 'mes_example' | 'first_mes' | 'alternate_greetings'>,
): DetectedVoiceFingerprint {
  const turns = collectCharacterTurns(card)
  if (turns.length < 2) return { verbalTics: [], catchphrases: [], turnsAnalyzed: turns.length }

  const spokenPerTurn = turns.map(spokenText)

  // Verbal tics: candidates appearing in at least two distinct turns, most-recurring first.
  const ticHits = TIC_CANDIDATES.map((tic) => {
    const re = new RegExp(`(^|[^a-z'])${escapeRegExp(tic)}([^a-z']|$)`, 'i')
    const count = spokenPerTurn.filter((s) => re.test(s)).length
    return { tic, count }
  })
    .filter((h) => h.count >= 2)
    .sort((a, b) => b.count - a.count || a.tic.localeCompare(b.tic))
  const verbalTics = ticHits.slice(0, 6).map((h) => h.tic)

  // Catchphrases: 2-4-word n-grams repeated across turns, longest/most-recurring first, skipping
  // a shorter gram already covered by a longer accepted one.
  const gramTurns = new Map<string, Set<number>>()
  spokenPerTurn.forEach((s, idx) => {
    const words = tokenizeWords(s)
    for (let n = 4; n >= 2; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n)
        if (gram.every((w) => STOPWORDS.has(w))) continue
        const key = gram.join(' ')
        if (!gramTurns.has(key)) gramTurns.set(key, new Set())
        gramTurns.get(key)!.add(idx)
      }
    }
  })
  const candidates = [...gramTurns.entries()]
    .filter(([, turnSet]) => turnSet.size >= 2)
    .sort((a, b) => b[1].size - a[1].size || b[0].length - a[0].length)
  const catchphrases: string[] = []
  for (const [gram] of candidates) {
    if (catchphrases.some((c) => c.includes(gram))) continue
    catchphrases.push(gram)
    if (catchphrases.length >= 5) break
  }

  // Sentence rhythm: average words/sentence, banded into a plain-English read.
  const sentenceLengths = spokenPerTurn
    .flatMap((s) => s.split(/(?<=[.!?])\s+/))
    .map(countProseWords)
    .filter((n) => n > 0)
  let sentenceRhythm: string | undefined
  if (sentenceLengths.length >= 2) {
    const avg = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
    sentenceRhythm =
      avg <= 6
        ? 'Short, clipped sentences.'
        : avg >= 16
          ? 'Long, winding sentences.'
          : 'Medium-length, even sentences.'
  }

  // Punctuation habits: only surfaced when a clear majority of turns share the habit.
  const total = spokenPerTurn.length
  const share = (re: RegExp) => spokenPerTurn.filter((s) => re.test(s)).length / total
  const punctuationBits: string[] = []
  if (share(/\.\.\.|…/) >= 0.4) punctuationBits.push('trails off with ellipses often')
  if (share(/!/) >= 0.5) punctuationBits.push('frequent exclamation points')
  if (share(/\?/) >= 0.5) punctuationBits.push('asks a lot of questions')
  const punctuationNotes = punctuationBits.length ? punctuationBits.join('; ') : undefined

  return { verbalTics, catchphrases, sentenceRhythm, punctuationNotes, turnsAnalyzed: turns.length }
}

/** Words to tokens, plus headroom to finish the sentence the model is in. */
const TOKENS_PER_WORD = 1.6
const SENTENCE_HEADROOM = 1.5

/** Hard ceiling on this turn's `max_length`. Never above `userMaxLength` — only ever tightens it. */
export function replyMaxTokens(band: ReplyLengthBand, userMaxLength: number): number {
  const cap = Math.ceil(BANDS[band].words * TOKENS_PER_WORD * SENTENCE_HEADROOM)
  return Math.max(48, Math.min(userMaxLength, cap))
}
