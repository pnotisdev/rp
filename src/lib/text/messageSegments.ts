export type MessageSegment = { type: 'text' | 'action' | 'quote'; content: string }

// Non-newline so a stray asterisk/quote used mid-sentence (or not yet closed while streaming)
// doesn't swallow the rest of the message looking for a distant closing mark.
const SEGMENT_RE = /(\*[^*\n]+\*|"[^"\n]+")/g

/**
 * Splits RP message text into plain/action/quote segments, so both the live chat UI and the
 * standalone HTML transcript export can style `*asterisk-wrapped* narration` and `"quoted"
 * spoken dialogue` consistently from one source of truth instead of re-parsing independently.
 * The asterisks themselves are stripped (they're writing-convention punctuation, not meant to be
 * read); quote marks are kept since they're real printed dialogue punctuation.
 *
 * Walks actual regex matches via `matchAll` rather than `String.split` + re-inspecting each
 * piece's own first/last character — the latter misclassifies an unterminated `*action` (whose
 * leftover text coincidentally starts and ends with `*`) as a real match even though nothing
 * actually matched the delimiter pattern.
 */
export function splitMessageSegments(text: string): MessageSegment[] {
  const segments: MessageSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(SEGMENT_RE)) {
    const index = match.index
    if (index > cursor) segments.push({ type: 'text', content: text.slice(cursor, index) })
    const matched = match[0]
    segments.push(
      matched.startsWith('*') ? { type: 'action', content: matched.slice(1, -1) } : { type: 'quote', content: matched },
    )
    cursor = index + matched.length
  }
  if (cursor < text.length) segments.push({ type: 'text', content: text.slice(cursor) })
  return segments
}
