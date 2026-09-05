/**
 * Puts an indefinite article in front of a noun phrase, for the one-line action the app writes on
 * the player's behalf when they hand over a gift (`useChatSession`'s `*I give {name} {gift}.*`).
 * Without it that line read "I give Sumire Pressed Flower Bookmark."
 *
 * A display-only heuristic, deliberately biased toward *not* inserting an article: a missing "a"
 * reads as slightly clipped, but a wrong one ("a Chocolates", "a a Cup of Tea") reads as broken.
 * Gift names come from a world's own authored catalog (`WorldCard.gifts`), so the input is
 * arbitrary text rather than a fixed set this could be hand-tuned against.
 */

/** Words that already determine the noun — prefixing anything would double up. Numbers count too ("Two Tickets", "3 Coins"). */
const DETERMINERS = new Set([
  'a',
  'an',
  'the',
  'some',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'my',
  'your',
  'his',
  'her',
  'their',
  'our',
  'this',
  'that',
  'these',
  'those',
])

/**
 * Written vowels are only a proxy for vowel *sounds*, which is what "a"/"an" actually tracks.
 * These are the two directions the proxy gets wrong often enough to be worth naming: a silent `h`
 * ("an hour") and a `u`/`o` that opens on a consonant sound ("a university", "a one-way ticket").
 * Matched on the first word only, since that's the word the article sits against.
 */
const SILENT_H = /^(hour|honest|honou?r|heir)/i
const CONSONANT_INITIAL_VOWEL = /^(uni(?![a-z]*[aeiou]?n\b)|use|user|usual|euro|eu|ubiquit|one|once)/i

/**
 * Ends in an `s` that reads as a plural rather than part of the word — "Chocolates" takes no
 * article, "Glass" and "Iris" do. Not a real pluralizer; it only has to be right often enough on
 * short noun phrases to beat always-inserting.
 */
function looksPlural(word: string): boolean {
  if (!/s$/i.test(word)) return false
  return !/(ss|us|is|as|os)$/i.test(word)
}

/** `'a'` or `'an'` for a noun phrase, or `null` when it shouldn't take one at all. Exported for the rare caller that wants the article without the phrase. */
export function indefiniteArticleFor(phrase: string): 'a' | 'an' | null {
  const first = phrase.trim().split(/\s+/)[0] ?? ''
  if (!first) return null
  const bare = first.replace(/[^\p{L}\p{N}'-]/gu, '')
  if (!bare) return null
  if (DETERMINERS.has(bare.toLowerCase())) return null
  if (/^\d/.test(bare)) return null
  // The last word decides number ("Box of Chocolates" is singular, "Flower Bouquets" is not).
  const words = phrase.trim().split(/\s+/)
  const last = (words[words.length - 1] ?? '').replace(/[^\p{L}\p{N}'-]/gu, '')
  if (looksPlural(last)) return null
  if (SILENT_H.test(bare)) return 'an'
  if (CONSONANT_INITIAL_VOWEL.test(bare)) return 'a'
  return /^[aeiou]/i.test(bare) ? 'an' : 'a'
}

/** The noun phrase with its article attached, or unchanged when it doesn't take one. */
export function withIndefiniteArticle(phrase: string): string {
  const trimmed = phrase.trim()
  const article = indefiniteArticleFor(trimmed)
  return article ? `${article} ${trimmed}` : trimmed
}
