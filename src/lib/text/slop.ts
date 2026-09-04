/**
 * The "AI slop" layer: the recognisable tells of machine-written roleplay prose, plus the two
 * deterministic passes that act on them.
 *
 * Two different jobs live here, deliberately in one file because they share the corpus below:
 *
 *  1. `cleanModelOutput` — a *rewrite*. Runs once on the model's completion before it's stored, so
 *     it fixes what's displayed AND what gets fed back into every later prompt (a tell left in
 *     history is a tell the model imitates next turn). Strictly limited to artifacts that are
 *     never legitimate character speech: an echoed speaker prefix, an assistant preamble, an OOC
 *     aside, a markdown heading. It never touches phrasing inside the fiction, because a rewrite
 *     that guesses wrong silently corrupts an author's scene. `StoredMessage.rawText` keeps the
 *     untouched original, so the Prompt Inspector's raw/processed toggle always shows exactly what
 *     was removed.
 *
 *  2. `findSlop` + `buildSlopAvoidanceNote` — *steering*. Phrasing clichés get handled by telling
 *     the model to stop, not by editing them out. And crucially it only names the ones this
 *     character has actually just used: a generic "avoid clichés" line is weak and every model
 *     nods along to it, whereas "you have already written 'couldn't help but' twice in this chat,
 *     don't reach for it again" is specific enough to actually change the next completion.
 */

import { normalizeRpMarkup } from '@/lib/text/messageSegments'

/** One recognisable tell of machine-written prose. */
export interface SlopPattern {
  id: string
  /**
   * How this gets named back to the model. Phrased as the offending phrasing itself wherever
   * possible ("couldn't help but") rather than as a category ("cliché verb constructions"), since
   * the concrete string is what a model can actually match against and avoid.
   */
  label: string
  re: RegExp
}

/**
 * The corpus. Every entry is case-insensitive and global, and every one earns its place by being
 * a phrase that a local model reaches for constantly and a human writer almost never does twice.
 *
 * Deliberately NOT in here: anything that is merely *plain* ("she said", "he nodded"), anything
 * that depends on frequency rather than the phrase itself (rule-of-three lists, heavy
 * parallelism), and anything a character might plausibly say out loud as dialogue. This list is
 * read by `findSlop`, which is used for steering only, but a false positive still costs prompt
 * tokens and, worse, teaches the model to avoid ordinary English.
 */
export const SLOP_PATTERNS: SlopPattern[] = [
  // --- Stock emotional shorthand: naming a feeling instead of showing it ---
  { id: 'couldnt-help', label: "couldn't help but", re: /\bcould ?n['’]?t help but\b/gi },
  { id: 'mix-of', label: '"a mix of X and Y" for an expression', re: /\ba mix(ture)? of [a-z\s]{3,30} and [a-z\s]{3,30}/gi },
  { id: 'despite-herself', label: '"despite herself/himself/themselves"', re: /\bdespite (her|him|them)self\b/gi },
  { id: 'ghost-of-smile', label: '"a ghost of a smile"', re: /\b(a|the) ghost of (a|her|his|their) (smile|grin|smirk)\b/gi },
  { id: 'ghost-of-touch', label: '"the ghost of a touch"', re: /\b(a|the) ghost of (a|her|his|their) (touch|breath|laugh)\b/gi },
  { id: 'barely-whisper', label: '"voice barely above a whisper"', re: /\b(barely|scarcely|no louder than) (a|above a) whisper\b/gi },
  { id: 'shiver-down', label: '"sent a shiver down her spine"', re: /\b(sent|sending) (a|an) (shiver|shudder|jolt|spark|thrill) (down|through|up)\b/gi },
  { id: 'heart-hammering', label: '"heart hammering/pounding in her chest"', re: /\b(heart|pulse) (hammer|pound|thunder|thud|race)(ing|ed|s)? (in|against|inside) (her|his|their|its) (chest|ribs|throat)\b/gi },
  { id: 'breath-didnt-know', label: '"a breath she didn\'t know she was holding"', re: /\b(a |the )?breath (she|he|they) did ?n['’]?t (even )?(know|realise|realize) (she|he|they) (was|were) holding\b/gi },
  { id: 'air-thick-with', label: '"the air was thick with"', re: /\b(the )?air (was|felt|hung|grew|turned) (thick|heavy|charged|electric)\b/gi },
  { id: 'silence-stretched', label: '"the silence stretched"', re: /\b(the )?silence (stretch|linger|hang|hung|drag)(ed|ing|s)?\b/gi },
  { id: 'unreadable', label: '"an unreadable expression"', re: /\b(an?|her|his|their) (unreadable|inscrutable|indecipherable) (expression|look|gaze|face)\b/gi },
  { id: 'something-flickered', label: '"something flickered in her eyes"', re: /\bsomething (flicker|flash|shift|dance|glint)(ed|ing|s)? (in|across|behind|through)\b/gi },
  { id: 'eyes-darkened', label: '"her eyes darkened"', re: /\b(her|his|their) (eyes|gaze) (darken|soften|harden)(ed|s|ing)?\b/gi },
  { id: 'smile-didnt-reach', label: '"a smile that didn\'t reach her eyes"', re: /\b(smile|grin) that did ?n['’]?t (quite )?reach (her|his|their) eyes\b/gi },
  { id: 'dangerously-low', label: '"voice dangerously low"', re: /\bvoice (dropp?ing|dropped|going|went|low(er)?)(,)? (dangerous(ly)?|deceptive(ly)?|impossibly) (low|soft|quiet)\b/gi },
  { id: 'beat-passed', label: '"a beat passed"', re: /\b(a|another) beat (passed|of silence|went by)\b/gi },
  { id: 'first-time-in', label: '"for the first time in a long time"', re: /\bfor the first time in (a )?(long time|years|forever)\b/gi },

  // --- Narrator editorialising: the story explaining itself to the reader ---
  { id: 'little-did', label: '"little did she know"', re: /\blittle did (she|he|they|you|[A-Z][a-z]+) (know|suspect|realise|realize)\b/gi },
  { id: 'unbeknownst', label: '"unbeknownst to"', re: /\bunbeknownst to\b/gi },
  { id: 'in-that-moment', label: '"in that moment, she knew"', re: /\bin that moment,? (she|he|they|you) (knew|understood|realised|realized)\b/gi },
  { id: 'not-just-but', label: '"it\'s not just X, it\'s Y" phrasing', re: /\bnot (just|only|merely) [^.,;!?]{2,40}[,;]? (but|it['’]s|they['’]re|she['’]s|he['’]s) \b/gi },
  { id: 'more-than-just', label: '"more than just"', re: /\bmore than (just|merely|simply) (a|an|the)?\b/gi },
  { id: 'seemed-to', label: '"seemed to" / "appeared to" hedging in narration', re: /\b(seemed|appeared) to (be|have|know|understand|sense|want|need)\b/gi },

  // --- Purple prose ---
  { id: 'orbs', label: '"orbs" for eyes', re: /\b(her|his|their|the) (emerald|sapphire|amber|violet|azure|obsidian|crimson|golden|dark|bright)? ?orbs\b/gi },
  { id: 'ministrations', label: '"ministrations"', re: /\bministrations\b/gi },
  { id: 'pools-of', label: '"pools of" for eyes', re: /\bpools of (liquid |molten |dark |warm )?[a-z]{3,12}\b/gi },
  { id: 'electricity', label: '"electricity shot through"', re: /\b(electricity|a current|fire|heat) (shot|surged|coursed|raced) (through|down|up)\b/gi },
  { id: 'every-fibre', label: '"every fibre of her being"', re: /\bevery fib(re|er) of (her|his|their|my) being\b/gi },
  { id: 'tapestry', label: '"a tapestry of"', re: /\ba tapestry of\b/gi },
  { id: 'testament', label: '"a testament to"', re: /\ba testament to\b/gi },
  { id: 'symphony', label: '"a symphony of"', re: /\ba symphony of\b/gi },
  { id: 'dance-of', label: '"a delicate dance of"', re: /\b(a|the) (delicate|intricate|careful) dance of\b/gi },
  { id: 'palpable', label: '"palpable"', re: /\bpalpable\b/gi },

  // --- Scene-closing filler: a turn that ends by gesturing at nothing ---
  { id: 'only-time-will-tell', label: '"only time will tell"', re: /\bonly time (will|would) tell\b/gi },
  { id: 'rest-is-history', label: '"and the rest is history"', re: /\bthe rest (is|was) history\b/gi },
  { id: 'what-happens-next', label: '"whatever happens next" scene-closing filler', re: /\bwhat(ever)? (happens|comes|came) next\b/gi },
  { id: 'one-thing-certain', label: '"one thing was certain"', re: /\bone thing (was|is) (certain|for sure|clear)\b/gi },
]

/**
 * Text that is never part of a character's actual turn, only an artifact of the model slipping out
 * of the roleplay. Handled by `cleanModelOutput` as whole-line removals rather than by steering,
 * because unlike a cliché these have no legitimate reading inside the fiction.
 */
const META_LINE_PATTERNS: RegExp[] = [
  // An OOC aside in any of the conventional wrappers.
  /^\s*[([{]{1,2}\s*ooc\b[^\n]*$/i,
  /^\s*ooc\s*[:\-][^\n]*$/i,
  /^\s*[([{]{2}[^\n]*[)\]}]{2}\s*$/,
  // An assistant addressing the user about the text it just wrote.
  /^\s*\(?\s*(let me know|i hope (this|that)|feel free to|would you like|shall i|do you want me to|if you('| wa)?nt me to)\b[^\n]*$/i,
  /^\s*\(?\s*(note|disclaimer|content warning|cw)\s*[:\-][^\n]*$/i,
  /^\s*as an? (ai|language model|assistant)\b[^\n]*$/i,
  // A model narrating its own compliance.
  /^\s*\(?\s*(continuing|continued|to be continued|end of (reply|response|turn|scene))\s*\.?\s*\)?\s*$/i,
]

/** A leading "Certainly!" style affirmation, only when it stands as its own opening line. */
const LEADING_AFFIRMATION_RE =
  /^\s*(certainly|of course|sure|absolutely|got it|understood|alright|okay|ok|no problem|happy to)[!.,]?\s*(here('s| is) [^\n]*)?\n+/i

/** A markdown heading at the start of a line — RP prose has no headings. */
const MD_HEADING_RE = /^[ \t]*#{1,6}[ \t]+/gm

/** Three or more blank lines collapse to one blank line. */
const EXCESS_BLANKS_RE = /\n{3,}/g

export interface CleanModelOutputOptions {
  /** The speaking character's name, to strip an echoed `Name:` prefix the prompt's own generation cue invited. */
  charName?: string
  /** The player's persona name, to cut the reply short if the model started writing their turn too. */
  personaName?: string
}

/**
 * A stray turn marker in the model's completion — it started narrating a whole back-and-forth
 * exchange (or a `<START>`-style scene break) instead of writing one turn. Stop sequences catch
 * most of this at generation time (see `useChatSession.ts`'s `dynamicStops`); this is the backstop
 * for a server or template that doesn't honour them.
 *
 * Moved here from `src/lib/dating/outreach.ts`, where it shipped first for the proactive-outreach
 * path — the live chat path needs exactly the same defence, and duplicating the escaping was the
 * only alternative.
 */
export function truncateAtStrayTurnMarker(text: string, charName: string, personaName: string): string {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const markers: RegExp[] = [/<START>/i]
  if (charName.trim()) markers.push(new RegExp(`\\n\\s*${escape(charName.trim())}\\s*:`, 'i'))
  if (personaName.trim()) markers.push(new RegExp(`\\n\\s*${escape(personaName.trim())}\\s*:`, 'i'))
  let cut = text.length
  for (const marker of markers) {
    const match = text.match(marker)
    if (match?.index !== undefined && match.index < cut) cut = match.index
  }
  return text.slice(0, cut).trim()
}

/**
 * Trims a reply back to its last complete sentence — for a generation that ran out of token budget
 * mid-word and has no continuation coming.
 *
 * Bails (returning the input unchanged) rather than cutting when the trim would lose more than
 * `maxLossRatio` of the text: a reply that is one long unpunctuated sentence is better shown whole
 * and slightly ragged than reduced to nothing. Treats a closing quote or asterisk after the
 * punctuation as part of the sentence, so `*she leaves.*` and `"fine."` survive intact.
 */
export function trimToLastSentence(text: string, maxLossRatio = 0.35): string {
  const trimmed = text.trimEnd()
  if (!trimmed) return text
  // Already ends cleanly: sentence punctuation, or a closed action/quote.
  if (/[.!?…]["'’”*)\]]*$/.test(trimmed) || /[*"”’]$/.test(trimmed)) return trimmed
  const match = trimmed.match(/[\s\S]*[.!?…]["'’”*)\]]*/)
  if (!match) return text
  const cut = match[0].trimEnd()
  if (!cut) return text
  if ((trimmed.length - cut.length) / trimmed.length > maxLossRatio) return text
  return cut
}

/**
 * The deterministic scrub applied once to a completed generation before it's stored.
 *
 * Order matters: turn markers are cut first (everything after one is another speaker's text and
 * shouldn't be scanned at all), then the whole-line meta removals, then the cosmetic collapses.
 * Every step is idempotent, which matters because an auto-continue round re-runs this over the
 * already-cleaned earlier text plus the new tokens.
 */
export function cleanModelOutput(text: string, opts: CleanModelOutputOptions = {}): string {
  if (!text) return text
  let out = text

  if (opts.charName || opts.personaName) {
    out = truncateAtStrayTurnMarker(out, opts.charName ?? '', opts.personaName ?? '')
  }

  // An echoed speaker prefix. The generation cue already ends with `Sumire:`, so a model that
  // restates it is duplicating the label, not saying its own name. Only stripped at the very
  // start, and only for the actual speaker (never for an arbitrary `Name:`, which could be one
  // character addressing another by name in dialogue).
  if (opts.charName?.trim()) {
    const escaped = opts.charName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`^\\s*${escaped}\\s*:\\s*`, 'i'), '')
  }

  out = out.replace(LEADING_AFFIRMATION_RE, '')
  // `<i>`/`<b>` action tags and `**`/`***` weight runs all become a single `*action*` — the app's
  // one convention. A consistent history is a consistent next reply.
  out = normalizeRpMarkup(out)

  const kept = out
    .split('\n')
    .filter((line) => !META_LINE_PATTERNS.some((re) => re.test(line)))
  out = kept.join('\n')

  out = out.replace(MD_HEADING_RE, '')
  out = out.replace(EXCESS_BLANKS_RE, '\n\n')

  // A lone trailing asterisk with no partner is a half-written action beat, not emphasis.
  const stars = (out.match(/\*/g) ?? []).length
  if (stars % 2 === 1 && /\*\s*$/.test(out)) out = out.replace(/\*\s*$/, '')

  return out.trim()
}

export interface SlopHit {
  id: string
  label: string
  /** How many times it occurs across everything scanned. */
  count: number
}

/** Every slop pattern present in `text`, with occurrence counts. */
export function findSlop(text: string): SlopHit[] {
  return findSlopAcross([text])
}

/** As `findSlop`, but counting across several texts at once (a character's recent turns). */
export function findSlopAcross(texts: string[]): SlopHit[] {
  const hits: SlopHit[] = []
  for (const pattern of SLOP_PATTERNS) {
    let count = 0
    for (const text of texts) {
      if (!text) continue
      // `re` is a shared global regex; matchAll consumes it safely, unlike .test/.exec which
      // would carry lastIndex between calls.
      count += [...text.matchAll(pattern.re)].length
    }
    if (count > 0) hits.push({ id: pattern.id, label: pattern.label, count })
  }
  return hits.sort((a, b) => b.count - a.count)
}

/** Words too common to be evidence of repetition on their own. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'her', 'his', 'i', 'if', 'in', 'is',
  'it', 'its', 'me', 'my', 'not', 'of', 'on', 'or', 'she', 'so', 'that', 'the', 'their', 'them', 'then',
  'they', 'this', 'to', 'was', 'were', 'with', 'you', 'your',
])

/** Normalises a phrase for comparison: lowercase, punctuation and asterisks gone, spaces collapsed. */
function normalisePhrase(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[*"“”'’]/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export interface RepeatedPhrase {
  phrase: string
  count: number
}

/**
 * Word sequences a character has used more than once across `texts` — the actual mechanism behind
 * "this character keeps saying the same thing", which no sampler-level repetition penalty catches
 * because `rep_pen_range` only reaches a couple of thousand tokens back and DRY is off by default.
 *
 * Only returns the longest form of each repeat: if "she tilts her head" recurs, its sub-phrases
 * ("she tilts her", "tilts her head") are dropped rather than reported alongside it, so the prompt
 * line that carries these names one thing per habit instead of four overlapping fragments.
 * Sequences that are entirely stopwords are skipped ("and then she was").
 */
export function findRepeatedPhrases(
  texts: string[],
  opts: { minWords?: number; maxWords?: number; minCount?: number; limit?: number } = {},
): RepeatedPhrase[] {
  const minWords = opts.minWords ?? 4
  const maxWords = opts.maxWords ?? 8
  const minCount = opts.minCount ?? 2
  const limit = opts.limit ?? 5

  const counts = new Map<string, number>()
  for (const text of texts) {
    if (!text) continue
    const words = normalisePhrase(text)
    // Count each n-gram at most once per message: a phrase repeated inside one long turn is a
    // style choice, whereas the same phrase in three separate turns is the habit worth naming.
    const seenHere = new Set<string>()
    for (let n = minWords; n <= maxWords; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const slice = words.slice(i, i + n)
        if (slice.every((w) => STOPWORDS.has(w))) continue
        const phrase = slice.join(' ')
        if (seenHere.has(phrase)) continue
        seenHere.add(phrase)
        counts.set(phrase, (counts.get(phrase) ?? 0) + 1)
      }
    }
  }

  const repeated = [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)

  // Keep only maximal phrases: drop any that is a substring of an already-kept longer one at the
  // same count (its sub-phrases necessarily recur exactly as often as the whole).
  const out: RepeatedPhrase[] = []
  for (const [phrase, count] of repeated) {
    if (out.some((k) => k.count === count && k.phrase.includes(phrase))) continue
    out.push({ phrase, count })
    if (out.length >= limit) break
  }
  return out
}

/** How many of the character's most recent turns the avoidance note looks back over. */
export const SLOP_SCAN_TURNS = 6

export interface SlopAvoidanceOptions {
  /** Cap on named clichés, so the note stays a nudge rather than its own wall of instruction. */
  maxPhrases?: number
  /** Cap on named repeated phrases. */
  maxRepeats?: number
}

/**
 * The steering line: names back to the model the specific tells it has just used, so it has
 * something concrete to avoid instead of an abstract instruction it will agree with and ignore.
 *
 * Returns undefined when the recent turns are clean, which is the common case for a well-behaved
 * model and means this costs zero prompt tokens most turns. Pass the character's own recent turns
 * only (never the player's) — the player's phrasing is theirs to repeat if they like.
 */
export function buildSlopAvoidanceNote(recentCharTurns: string[], opts: SlopAvoidanceOptions = {}): string | undefined {
  const texts = recentCharTurns.filter((t) => t?.trim()).slice(-SLOP_SCAN_TURNS)
  if (texts.length === 0) return undefined

  const maxPhrases = opts.maxPhrases ?? 4
  const maxRepeats = opts.maxRepeats ?? 3

  const slop = findSlopAcross(texts).slice(0, maxPhrases)
  const repeats = findRepeatedPhrases(texts, { limit: maxRepeats })

  const lines: string[] = []
  if (slop.length > 0) {
    lines.push(
      `You have already leaned on these in this chat: ${slop.map((h) => h.label).join('; ')}. Do not use them again. Write the moment a different way.`,
    )
  }
  if (repeats.length > 0) {
    lines.push(
      `You have also repeated these exact phrasings: ${repeats.map((r) => `"${r.phrase}"`).join('; ')}. Say it differently or leave it out.`,
    )
  }
  return lines.length ? lines.join(' ') : undefined
}
