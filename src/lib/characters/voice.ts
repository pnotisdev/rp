/**
 * Reply length and register, derived from the character rather than set globally.
 *
 * The problem this solves: `sampler.max_length` is one number for the whole app, and the system
 * prompt asks in prose for a character's voice to be honoured, which a model interprets loosely.
 * The result is that a tsundere who says nine words in her own example dialogue gets the same
 * three-hundred-token budget as a verbose narrator, and fills it. Nothing in the prompt pipeline
 * previously said how long a turn should be in any concrete unit, and nothing stopped the sampler
 * from producing an essay.
 *
 * Three things happen here:
 *
 *  1. `deriveCardReplyBand` measures the character's OWN authored turns (their `mes_example`
 *     lines, falling back to `first_mes`) and reports how long they actually write. This is the
 *     ground truth for "fit the character description" — an author who wrote curt examples has
 *     already said what they want, in the most direct way available to them, and the app simply
 *     wasn't reading it.
 *  2. `resolveReplyLength` turns that (or an explicit per-character override) into a band with a
 *     concrete instruction in sentences, which is the unit a model can actually count in.
 *  3. `replyMaxTokens` turns the same band into a hard sampler cap, so brevity does not depend on
 *     the model choosing to comply. The cap only ever lowers the user's own `max_length`, never
 *     raises it: their slider stays the ceiling.
 */

import type { CharacterCardData } from './cardSpec'

/**
 * How long this character's replies should run. `auto` (the default for every character, including
 * every already-saved one) reads the card's own example dialogue; the other three are an explicit
 * authorial override for a card whose examples are unrepresentative or missing.
 */
export type ReplyLength = 'auto' | 'brief' | 'moderate' | 'detailed'

/** The three real bands. `auto` always resolves to one of these. */
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
  /** Roughly how many words a turn in this band runs. Used for the token cap, not shown to the model (a word count is something models estimate badly; sentences they count well). */
  words: number
  /** The instruction the model actually reads. Concrete and countable, never "keep it short". */
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

/**
 * SillyTavern's example-dialogue format, which this app reads verbatim out of imported cards:
 * `<START>` blocks of alternating `{{user}}:` / `{{char}}:` lines. Only the `{{char}}:` lines
 * matter here — the user lines are the author's prompts, not the character's voice.
 */
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

/**
 * Pulls the character's own turns out of a card's `mes_example`. A card that uses the `<START>` /
 * `{{char}}:` convention gives one entry per example turn; a card whose examples are just loose
 * prose with no speaker labels yields nothing, and the caller falls back to `first_mes`.
 */
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
    // A continuation line of whichever turn is open. Loose lines before any speaker label belong
    // to nobody and are ignored.
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

/** The median of a non-empty list. Median, not mean, so one long scene-setting example doesn't drag the whole card up a band. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * What length this card is already written at.
 *
 * Prefers `mes_example` (the author demonstrating a normal turn) over `first_mes` (a greeting,
 * which is conventionally longer than a normal turn because it has to establish a scene). When
 * only a greeting exists it is measured, but discounted for that reason before being banded.
 */
export function deriveCardReplyBand(card: Pick<CharacterCardData, 'mes_example' | 'first_mes'>): DerivedReplyBand {
  const exampleTurns = extractExampleCharTurns(card.mes_example)
  const exampleWords = exampleTurns.map(countProseWords).filter((n) => n > 0)
  if (exampleWords.length > 0) {
    const words = median(exampleWords)
    return { band: bandForWords(words), measuredWords: words, source: 'examples' }
  }

  const greetingWords = countProseWords(card.first_mes ?? '')
  if (greetingWords > 0) {
    // A greeting typically runs longer than the turns that follow it; measured live against the
    // bundled Sumire card, whose greeting is roughly double her example turns.
    const words = Math.round(greetingWords * 0.6)
    return { band: bandForWords(words), measuredWords: words, source: 'greeting' }
  }

  // Nothing authored to read. `moderate` rather than `brief`, so a blank new card behaves like an
  // ordinary chat partner instead of a terse one the author never asked for.
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

/**
 * The single entry point for both the prompt line and the token cap. `setting` is the character's
 * own `replyLength` (unset behaves as `auto`).
 */
export function resolveReplyLength(
  setting: ReplyLength | undefined,
  card: Pick<CharacterCardData, 'mes_example' | 'first_mes'>,
): ResolvedReplyLength {
  if (setting && setting !== 'auto') {
    return { band: setting, instruction: BANDS[setting].instruction, derived: false, measuredWords: 0 }
  }
  const derived = deriveCardReplyBand(card)
  const spec = BANDS[derived.band]
  // When the band was measured from real authored examples, say so: pointing the model at its own
  // card's examples is a stronger and more specific instruction than any sentence count, because
  // it also carries register, punctuation habits, and how much narration the author wanted.
  const instruction =
    derived.source === 'examples'
      ? `${spec.instruction} Match the length and rhythm of this character's example dialogue; that is how long their turns are meant to run.`
      : spec.instruction
  return { band: derived.band, instruction, derived: true, measuredWords: derived.measuredWords }
}

/**
 * Automated "voice fingerprint" extraction (see `VoiceFingerprint` in `cardSpec.ts`) — a deterministic,
 * zero-cost heuristic pass over the card's own authored dialogue, in the same spirit as
 * `deriveCardReplyBand` above: the ground truth for how this character actually talks is what the
 * author already wrote, not a fresh model call reinterpreting it. Purely mechanical properties
 * (a word repeating, a sentence running long, an ellipsis habit) are exactly the kind of thing a
 * small local model counts unreliably and a `String.split` counts perfectly, so this never touches
 * `ChatBackend` — the "Detect from examples" button in `CharacterEditor` calls it directly and gets
 * a result instantly, with no backend, no failure mode, and nothing to mock in a test.
 */
export interface DetectedVoiceFingerprint {
  /** Filler words/phrases from a curated candidate list that recur across at least two distinct turns. */
  verbalTics: string[]
  /** Multi-word phrases (2-4 words) that repeat verbatim across at least two distinct turns, excluding stopword-only combinations. */
  catchphrases: string[]
  /** A plain-English read on average sentence length, or undefined when there isn't enough measurable prose. */
  sentenceRhythm?: string
  /** Ellipsis/exclamation/question habits that show up often enough across turns to be a pattern, or undefined. */
  punctuationNotes?: string
  /** How many of the character's own turns were available to analyze — 0 or 1 means "not enough data," surfaced by the editor rather than shown as a confident (but meaningless) empty result. */
  turnsAnalyzed: number
}

/** Common English function words, excluded from n-gram candidates so a repeated "of the" or "and I"
 *  never gets surfaced as a "catchphrase" — a catchphrase has to carry actual content. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'but', 'is', 'are', 'was',
  'were', 'be', 'been', 'it', 'this', 'that', 'i', 'you', 'he', 'she', 'they', 'we', 'my', 'your',
  'his', 'her', 'their', 'our', 'me', 'him', 'them', 'us', 'with', 'as', 'so', 'if', 'not', 'no',
  'do', 'did', 'does', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'then', 'than',
  'there', 'here', 'what', 'who', 'how', 'why', 'when', 'where', 'which', 'from', 'by', 'out',
  'up', 'down', 'over', 'about', 'into', 'some', 'all', 'any', 'one', 'get', 'got', 'im', "i'm",
])

/** Curated filler words/discourse markers worth flagging as a possible verbal tic — deliberately not
 *  an open-ended n-gram scan like catchphrases below, since single common words ("well", "look")
 *  are only meaningful as a *tic* when a candidate list keeps them from drowning in ordinary prose. */
const TIC_CANDIDATES = [
  'well', 'i mean', 'you know', 'look', 'listen', 'honestly', 'anyway', 'huh', 'hmph', 'hmm',
  'ugh', 'tch', 'geez', 'whatever', 'seriously', 'obviously', 'frankly', 'i guess', 'sort of',
  'kind of', 'or something', 'and stuff', 'basically', 'i suppose', 'i swear', 'for what it\'s worth',
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Lowercased word tokens, punctuation stripped except an internal apostrophe (so "don't" stays one token). */
function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[*_~]/g, ' ')
    .split(/[^a-z0-9']+/i)
    .filter(Boolean)
}

/** Text inside "double quotes" (straight or curly) — what the character actually said, as opposed to
 *  the narration/action text wrapped in asterisks around it. Falls back to the whole turn when a
 *  card writes unquoted dialogue, since some do. */
function spokenText(turn: string): string {
  const quoted = [...turn.matchAll(/["“]([^"”]+)["”]/g)].map((m) => m[1])
  return quoted.length ? quoted.join(' ') : turn
}

/**
 * Every stretch of this character's own authored dialogue available to measure: their `mes_example`
 * turns (the same extraction `deriveCardReplyBand` uses), plus `first_mes` and every
 * `alternate_greetings` entry — greetings are prose rather than the `<START>`/`{{char}}:` convention,
 * but they're still the character's own voice and often the only text a brand-new card has.
 */
export function collectCharacterTurns(
  card: Pick<CharacterCardData, 'mes_example' | 'first_mes' | 'alternate_greetings'>,
): string[] {
  const exampleTurns = extractExampleCharTurns(card.mes_example)
  const greetings = [card.first_mes, ...(card.alternate_greetings ?? [])]
    .map((t) => t?.trim())
    .filter((t): t is string => !!t)
  return [...exampleTurns, ...greetings]
}

/** Detects a `VoiceFingerprint` draft from what the card's own examples/greetings already show. Needs
 *  at least two turns to say anything about *recurring* patterns; with fewer, only `turnsAnalyzed`
 *  is meaningful and every list comes back empty rather than a guess dressed up as a finding. */
export function detectVoiceFingerprint(
  card: Pick<CharacterCardData, 'mes_example' | 'first_mes' | 'alternate_greetings'>,
): DetectedVoiceFingerprint {
  const turns = collectCharacterTurns(card)
  if (turns.length < 2) return { verbalTics: [], catchphrases: [], turnsAnalyzed: turns.length }

  const spokenPerTurn = turns.map(spokenText)

  // Verbal tics: a candidate appearing in at least two distinct turns, most-recurring first.
  const ticHits = TIC_CANDIDATES.map((tic) => {
    const re = new RegExp(`(^|[^a-z'])${escapeRegExp(tic)}([^a-z']|$)`, 'i')
    const count = spokenPerTurn.filter((s) => re.test(s)).length
    return { tic, count }
  })
    .filter((h) => h.count >= 2)
    .sort((a, b) => b.count - a.count || a.tic.localeCompare(b.tic))
  const verbalTics = ticHits.slice(0, 6).map((h) => h.tic)

  // Catchphrases: 2-4-word n-grams repeated verbatim across at least two distinct turns, longest
  // and most-recurring first, skipping a shorter gram already covered by a longer accepted one.
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

  // Sentence rhythm: average words/sentence across all spoken text, banded into a plain-English read.
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

  // Punctuation habits: only surfaced when a clear majority of turns share the habit, so one dramatic
  // line in an otherwise plain card doesn't get generalized into a "trait".
  const total = spokenPerTurn.length
  const share = (re: RegExp) => spokenPerTurn.filter((s) => re.test(s)).length / total
  const punctuationBits: string[] = []
  if (share(/\.\.\.|…/) >= 0.4) punctuationBits.push('trails off with ellipses often')
  if (share(/!/) >= 0.5) punctuationBits.push('frequent exclamation points')
  if (share(/\?/) >= 0.5) punctuationBits.push('asks a lot of questions')
  const punctuationNotes = punctuationBits.length ? punctuationBits.join('; ') : undefined

  return { verbalTics, catchphrases, sentenceRhythm, punctuationNotes, turnsAnalyzed: turns.length }
}

/** Words to tokens, plus room to finish the sentence the model is in when it reaches the band's target. */
const TOKENS_PER_WORD = 1.6
const SENTENCE_HEADROOM = 1.5

/**
 * A hard ceiling on this turn's `max_length`, so brevity survives a model that ignores the
 * instruction. Never above `userMaxLength` — the Settings slider stays the user's ceiling, and
 * this only ever tightens it.
 *
 * The headroom above the band's target is deliberate: cutting a reply off mid-word to save forty
 * tokens reads far worse than a turn running slightly long, and `trimToLastSentence` in
 * `src/lib/text/slop.ts` cleans up the case where it still happens.
 */
export function replyMaxTokens(band: ReplyLengthBand, userMaxLength: number): number {
  const cap = Math.ceil(BANDS[band].words * TOKENS_PER_WORD * SENTENCE_HEADROOM)
  return Math.max(48, Math.min(userMaxLength, cap))
}
