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
