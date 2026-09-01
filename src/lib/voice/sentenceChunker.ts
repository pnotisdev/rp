/**
 * Incrementally pulls complete sentences out of a growing streamed string, so the
 * Companion can start speaking the first sentence while the rest is still being
 * generated instead of waiting for the whole reply. Call again as more text arrives;
 * pass back the returned `consumedLength` each time so already-spoken text isn't
 * re-extracted.
 */
const SENTENCE_BOUNDARY = /[.!?…]+["')\]]*\s+|\n+/g

export function extractCompleteSentences(
  fullText: string,
  consumedLength: number,
): { chunks: string[]; consumedLength: number } {
  const unconsumed = fullText.slice(consumedLength)
  const chunks: string[] = []
  let lastEnd = 0
  SENTENCE_BOUNDARY.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SENTENCE_BOUNDARY.exec(unconsumed))) {
    const end = match.index + match[0].length
    const sentence = unconsumed.slice(lastEnd, end).trim()
    if (sentence) chunks.push(sentence)
    lastEnd = end
  }
  return { chunks, consumedLength: consumedLength + lastEnd }
}
