// Deterministic, lexical hard rail checking a reply against a character's authored `boundaries`
// and a persona's stated limits in their description. False negatives preferred over false
// positives — never blocks or rewrites, only flags for the player to review (see
// `useChatSession.ts`'s call site).

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'with', 'without', 'being', 'is', 'are',
  'wont', "won't", 'never', 'not', 'no', 'anything', 'something', 'their', 'they', 'them', 'her',
  'his', 'she', 'he', 'about', 'that', 'this', 'from', 'any', 'own', 'will', 'wouldnt', "wouldn't",
  'doesnt', "doesn't", 'dont', "don't", 'cant', "can't", 'just', 'only', 'ever', 'always',
])

/** Lowercased, punctuation-stripped significant words (>=4 chars, stopwords dropped) from a short phrase. */
function significantWords(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
}

/** True when most (or all, for a short phrase) of a boundary's own significant words show up in the reply. */
export function boundaryPhraseCrossed(boundary: string, replyText: string): boolean {
  const words = significantWords(boundary)
  if (words.length === 0) return false
  const reply = replyText.toLowerCase()
  const hits = words.filter((w) => reply.includes(w))
  if (words.length <= 2) return hits.length === words.length
  return hits.length >= Math.ceil(words.length * 0.75)
}

/** First authored boundary phrase this reply appears to cross, or undefined. */
export function detectBoundaryCrossing(boundaries: string[] | undefined, replyText: string): string | undefined {
  if (!boundaries?.length || !replyText.trim()) return undefined
  return boundaries.find((b) => boundaryPhraseCrossed(b, replyText))
}

// Markers that make a persona-description sentence read as a stated limit rather than ordinary bio text.
const LIMIT_MARKERS = [
  "won't",
  'wont',
  "don't",
  'dont',
  'never',
  "can't",
  'cant',
  'refuse',
  'refuses',
  'hate',
  'hates',
  'uncomfortable',
  'not okay',
  'not into',
  'no ',
]

/** Splits on sentence-ending punctuation. Exported for `agencyGuard.ts`'s own sentence-scoped scan. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Sentences of a persona description that read as a stated limit. */
export function personaBoundaryPhrases(description: string | undefined): string[] {
  if (!description?.trim()) return []
  const lower = (s: string) => s.toLowerCase()
  return splitSentences(description).filter((sentence) => LIMIT_MARKERS.some((marker) => lower(sentence).includes(marker)))
}

/** Combined check across a character's own boundaries and the persona's stated limits. */
export function detectAnyBoundaryCrossing(
  characterBoundaries: string[] | undefined,
  personaDescription: string | undefined,
  replyText: string,
): string | undefined {
  return detectBoundaryCrossing(characterBoundaries, replyText) ?? detectBoundaryCrossing(personaBoundaryPhrases(personaDescription), replyText)
}
