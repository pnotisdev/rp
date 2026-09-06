/**
 * Item 4's deterministic "hard rail" — a real, non-AI post-generation check against a character's
 * own authored `boundaries` (`Character.boundaries` — "Hard limits — things this character won't
 * do or won't tolerate, in character"). Today that field is purely informational: it reaches the
 * prompt as flavor text (`characters/profile.ts`) and nothing ever checks whether a generated reply
 * actually honored it. This is the one piece of *deterministic* enforcement on top of that: a cheap,
 * synchronous lexical scan run against every finished reply, distinct from the field's existing
 * prompt-only treatment everywhere else.
 *
 * Deliberately conservative and lexical, not semantic — there is no cheap, reliable way to ask "did
 * this reply cross that boundary" without another AI call (which would defeat the point: a
 * deterministic control that costs nothing and never itself hallucinates a verdict). A boundary
 * phrase's own significant words (stripped of stopwords/negation) have to show up together in the
 * reply for a hit — false negatives (a paraphrased crossing slips through) are the safe failure
 * mode here. A heuristic that fired on loose thematic overlap would flag ordinary scenes constantly
 * and train the player to ignore the warning entirely, which is worse than missing some.
 *
 * This never blocks or rewrites anything on its own — see `useChatSession.ts`'s call site, which
 * only ever surfaces a toast so the player can judge for themselves and regenerate if it's a real
 * miss. A silent auto-reroll risked discarding a perfectly good reply on a false positive with no
 * way to verify that live tonight; a flag the player can act on is the safer default.
 */

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

/**
 * True only when a clear majority (or all, for a short phrase) of one boundary's own significant
 * words show up in the reply text — an unambiguous, on-the-nose crossing ("no knife play" -> the
 * reply literally uses a knife), not a scene that merely brushes the general topic. A boundary with
 * no significant words at all (too short/generic to key off) never matches anything.
 */
export function boundaryPhraseCrossed(boundary: string, replyText: string): boolean {
  const words = significantWords(boundary)
  if (words.length === 0) return false
  const reply = replyText.toLowerCase()
  const hits = words.filter((w) => reply.includes(w))
  if (words.length <= 2) return hits.length === words.length
  return hits.length >= Math.ceil(words.length * 0.75)
}

/** The first authored boundary phrase this reply appears to cross, or `undefined` when none do (the common case, by design — see this file's own doc comment on why false negatives are the safe failure mode). */
export function detectBoundaryCrossing(boundaries: string[] | undefined, replyText: string): string | undefined {
  if (!boundaries?.length || !replyText.trim()) return undefined
  return boundaries.find((b) => boundaryPhraseCrossed(b, replyText))
}
