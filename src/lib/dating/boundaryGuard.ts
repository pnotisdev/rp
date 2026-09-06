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

/**
 * Item 7's gap: this whole file only ever read `Character.boundaries`, a real but narrower scope
 * than "the player's own limits" — a persona's free-text `description` is where those actually
 * live today (there is no structured `Persona.boundaries` field, and adding one is a bigger,
 * separate schema/editor change than this narrow fix calls for). Unlike a character's boundaries
 * (already a curated list of short phrases, each one deliberately a limit), a persona description
 * is ordinary prose mostly about other things — running the whole block through
 * `boundaryPhraseCrossed` as one long phrase would false-positive constantly on unrelated words.
 * This extracts just the sentences that actually *read* as a stated limit (containing a plain
 * negation/refusal marker — "won't", "don't", "never", "hate(s)", "refuse(s)", "not okay with",
 * "uncomfortable with", "no ___"), each treated as its own boundary phrase from there on, same
 * lexical rules as the rest of this file. A description with no such sentence contributes nothing,
 * which is the common case and the safe default (no persona bio, or one that's just physical
 * description/backstory, was never meant to gate anything).
 */
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

/** Splits on sentence-ending punctuation — good enough for a short bio; a persona description isn't formal prose with abbreviations to trip over. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function personaBoundaryPhrases(description: string | undefined): string[] {
  if (!description?.trim()) return []
  const lower = (s: string) => s.toLowerCase()
  return splitSentences(description).filter((sentence) => LIMIT_MARKERS.some((marker) => lower(sentence).includes(marker)))
}

/**
 * The combined check, reading both sources of authored limits — a character's own `boundaries`
 * (unchanged, still checked first so its existing behavior/ordering is untouched) and whatever the
 * persona's own description states as a limit (`personaBoundaryPhrases` above). Same conservative
 * contract as `detectBoundaryCrossing`: `undefined` is the common case, and a miss is the safe
 * failure mode.
 */
export function detectAnyBoundaryCrossing(
  characterBoundaries: string[] | undefined,
  personaDescription: string | undefined,
  replyText: string,
): string | undefined {
  return detectBoundaryCrossing(characterBoundaries, replyText) ?? detectBoundaryCrossing(personaBoundaryPhrases(personaDescription), replyText)
}
