export type MessageSegment = { type: 'text' | 'action' | 'quote' | 'sfx'; content: string }

/** Per-render SFX policy — the global on/off toggle plus any extra vocabulary for this speaker. */
export interface SfxConfig {
  /** true = skip SFX detection entirely (the Appearance → "Sound-effect bursts" toggle is off). */
  disabled?: boolean
  /** Extra onomatopoeia beyond the built-in list — the global custom list plus the speaking
   *  character's own `sfxWords`, already merged by the caller. Single words; punctuation and
   *  casing are normalized here, so "Nyaa~" and "nya" both land. */
  extraWords?: readonly string[]
}

// Non-newline so a stray asterisk/quote used mid-sentence (or not yet closed while streaming)
// doesn't swallow the rest of the message looking for a distant closing mark. `\*{1,3}` on each
// side so `**bold**` and `***both***` narration read the same as plain `*action*` rather than
// leaving stray asterisks around an italic run — models drift between `*`, `**`, and `<i>` for the
// exact same purpose, and a player typing `**word**` expects it to just work.
const SEGMENT_RE = /(\*{1,3}[^*\n]+\*{1,3}|"[^"\n]+")/g

/**
 * Normalise the two ways RP text drifts from this app's one convention (`*action*` / `"speech"`):
 *
 *  - **HTML** — models (RP finetunes especially) format actions with `<i>…</i>` / `<b>…</b>`, and a
 *    confused one emits broken salad (`<b><i><i></b>`). Well-formed pairs become asterisks; block
 *    tags and stray tags are stripped; a bare `<` in prose ("x < y") is left alone.
 *  - **`**` / `***`** — the same drift with markdown weight. The app renders `*x*` and `**x**`
 *    identically (`<em>`), so a `**`/`***` run collapses to a single `*`.
 *
 * Shared by `cleanModelOutput` (scrubs stored text + prompt history), `sendUserMessage` (the
 * player's own typed line), and `splitMessageSegments` (a render-time safety net for old messages
 * and the mid-stream preview). Idempotent.
 */
export function normalizeRpMarkup(text: string): string {
  let out = text
  if (out.includes('<')) {
    out = out
      .replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
      .replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi, '')
  }
  return out
    .replace(/\*\*\s*\*\*/g, '') // `****` / `** **` from stripped-tag salad
    .replace(/\*{2,}([^*\n]+?)\*{2,}/g, '*$1*') // `**bold**` / `***both***` action runs
    .replace(/\*{2,}/g, '*') // any lone `**` straggler
}

/**
 * Curated comic/manga onomatopoeia. Deliberately tight: only words that read purely as a *sound*,
 * never as a shout ("STOP", "NO", "HELP") or an emphasized verb ("SLAMS", "RUNS"), so styling one
 * as a burst can't be wrong. Verb forms with an -s/-ed suffix don't normalize into this set, which
 * is why plain "the door SLAMS shut" is left alone. A character can extend this per-card (a catgirl
 * adding "nya", "mrrp") via `Character.sfxWords`; the user can extend it globally in Settings.
 */
export const BUILTIN_SFX_WORDS: readonly string[] = [
  'BOOM', 'KABOOM', 'KABLAM', 'KAPOW', 'BANG', 'BAM', 'POW', 'WHAM', 'WHUMP', 'WHUD',
  'THUD', 'THUMP', 'THOOM', 'THOK', 'CRASH', 'SMASH', 'SLAM', 'CRACK', 'CRACKLE', 'SNAP',
  'CRUNCH', 'POP', 'KNOCK', 'RAP', 'TAP', 'THWACK', 'WHACK', 'SMACK', 'SLAP', 'CLANG',
  'CLANK', 'CLATTER', 'CLICK', 'CLACK', 'TICK', 'TOCK', 'DING', 'DONG', 'RING', 'BUZZ',
  'BZZT', 'ZAP', 'WHOOSH', 'WOOSH', 'SWOOSH', 'SWISH', 'FWOOSH', 'FWIP', 'WHIP', 'SPLASH',
  'SPLAT', 'PLOP', 'PLONK', 'PLINK', 'PLUNK', 'DRIP', 'SIZZLE', 'HISS', 'FIZZ', 'WHIRR',
  'RUMBLE', 'ROAR', 'GROWL', 'GRR', 'CREAK', 'SQUEAK', 'SCREECH', 'VROOM', 'ZOOM', 'HONK',
  'BEEP', 'TOOT', 'GULP', 'MUNCH', 'SLURP', 'CHOMP', 'NOM', 'TWANG', 'BOING', 'SPROING',
  'TCH', 'HMPH', 'THWIP', 'SHING', 'KATHUNK', 'KACHUNK', 'KATHUMP', 'RATATAT', 'RATTAT',
  'DOKI', 'DOKIDOKI', 'ZAWA', 'GOGOGO', 'BADUMP', 'PATTER',
]

const BUILTIN_SET = new Set(BUILTIN_SFX_WORDS)

/** Freeform "extra sound words" input (comma / newline / space separated) -> a clean word list. */
export function parseSfxWordList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((w) => w.replace(/[^A-Za-z-]/g, '').trim())
    .filter((w) => w.replace(/-/g, '').length >= 2)
}

function sfxWordSet(extra?: readonly string[]): Set<string> {
  if (!extra || extra.length === 0) return BUILTIN_SET
  const set = new Set(BUILTIN_SET)
  for (const w of extra) {
    const clean = w.replace(/[^A-Za-z]/g, '').toUpperCase()
    if (clean.length >= 2) set.add(clean)
  }
  return set
}

/** Uppercases and collapses stretched letters ("boooom" -> "boom") so elongated spellings still hit. */
function normalizeSfx(word: string): string[] {
  const upper = word.toUpperCase()
  return [upper, upper.replace(/([A-Z])\1{2,}/g, '$1$1'), upper.replace(/([A-Z])\1+/g, '$1')]
}

/** One whitespace-delimited token (may carry internal hyphens and trailing !?~. punctuation). */
function isSfxToken(token: string, wordSet: Set<string>): boolean {
  const core = token.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z]+$/, '')
  if (core.length < 2) return false
  const parts = core.split(/[-–]/).filter(Boolean)
  if (parts.length === 0) return false
  const inSet = (w: string) => normalizeSfx(w).some((n) => wordSet.has(n))
  if (parts.every(inSet)) return true
  // "ka-thunk" style: the pieces aren't sounds on their own, the joined word is.
  return inSet(parts.join(''))
}

/**
 * Is this whole trimmed clause an onomatopoeia burst — one to six sound words and nothing else?
 * "BOOM", "knock knock", "tap-tap-tap", "CRASH... BANG" all qualify; "the door slams" does not.
 */
function isSfxRun(clause: string, wordSet: Set<string>): boolean {
  const tokens = clause.split(/[ \t]+/).filter(Boolean)
  if (tokens.length === 0 || tokens.length > 6) return false
  return tokens.every((t) => isSfxToken(t, wordSet))
}

// Clause boundaries an SFX burst is allowed to stand between: line breaks, periods/ellipses, and
// dashes (so "she froze — THUMP — the lid slammed" catches the middle beat). `!`/`?` are left out
// on purpose — they're both sentence-enders *and* the punctuation a burst itself trails ("BOOM!"),
// so `isSfxToken` strips them from a token instead and the burst keeps its bang.
const CLAUSE_SPLIT_RE = /([\n.…—–]+)/

function splitSfx(seg: MessageSegment, wordSet: Set<string>): MessageSegment[] {
  if (seg.type !== 'text' && seg.type !== 'action') return [seg]
  const out: MessageSegment[] = []
  for (const piece of seg.content.split(CLAUSE_SPLIT_RE)) {
    if (piece === '') continue
    const trimmed = piece.trim()
    if (trimmed.length >= 2 && !CLAUSE_SPLIT_RE.test(piece) && isSfxRun(trimmed, wordSet)) {
      const lead = piece.slice(0, piece.indexOf(trimmed))
      const trail = piece.slice(piece.indexOf(trimmed) + trimmed.length)
      if (lead) out.push({ type: seg.type, content: lead })
      out.push({ type: 'sfx', content: trimmed })
      if (trail) out.push({ type: seg.type, content: trail })
    } else {
      out.push({ type: seg.type, content: piece })
    }
  }
  return out
}

/** Merges neighbouring same-type segments so a message with no SFX comes out exactly as before. */
function coalesce(segments: MessageSegment[]): MessageSegment[] {
  const out: MessageSegment[] = []
  for (const seg of segments) {
    const last = out[out.length - 1]
    if (last && last.type === seg.type && seg.type !== 'sfx') last.content += seg.content
    else out.push({ ...seg })
  }
  return out
}

/**
 * Splits RP message text into plain/action/quote/sfx segments, so both the live chat UI and the
 * standalone HTML transcript export can style `*asterisk-wrapped* narration`, `"quoted"` spoken
 * dialogue, and standalone `BOOM` sound effects consistently from one source of truth instead of
 * re-parsing independently. The asterisks themselves are stripped (they're writing-convention
 * punctuation, not meant to be read); quote marks are kept since they're real printed dialogue
 * punctuation.
 *
 * Walks actual regex matches via `matchAll` rather than `String.split` + re-inspecting each
 * piece's own first/last character — the latter misclassifies an unterminated `*action` (whose
 * leftover text coincidentally starts and ends with `*`) as a real match even though nothing
 * actually matched the delimiter pattern.
 *
 * SFX detection is opt-in per the `sfx` argument (the global toggle), a second pass over the
 * plain/action segments only (never inside `"quotes"`, where a "BOOM!" is something a character
 * *said*): a clause standing on its own between sentence punctuation that is nothing but words
 * from the onomatopoeia list — built-ins plus any `sfx.extraWords` — becomes an `sfx` segment.
 */
export function splitMessageSegments(text: string, sfx?: SfxConfig): MessageSegment[] {
  const normalized = normalizeRpMarkup(text)
  const base: MessageSegment[] = []
  let cursor = 0
  for (const match of normalized.matchAll(SEGMENT_RE)) {
    const index = match.index
    if (index > cursor) base.push({ type: 'text', content: normalized.slice(cursor, index) })
    const matched = match[0]
    base.push(
      matched.startsWith('*')
        ? { type: 'action', content: matched.replace(/^\*+/, '').replace(/\*+$/, '') }
        : { type: 'quote', content: matched },
    )
    cursor = index + matched.length
  }
  if (cursor < normalized.length) base.push({ type: 'text', content: normalized.slice(cursor) })

  if (sfx?.disabled) return coalesce(base)
  const wordSet = sfxWordSet(sfx?.extraWords)
  return coalesce(base.flatMap((seg) => splitSfx(seg, wordSet)))
}
