// ReDoS mitigation for World Info regex-key syntax (`activation.ts`) and Settings → Regex Scripts
// (`regexScripts.ts`), which both compile arbitrary imported regex and run it against real
// conversation text every turn. A shallow, fast heuristic for the common catastrophic-backtracking
// shape, not a real static analyzer — good enough to flag a suspicious pattern at authoring time,
// not a guarantee against an imported file that skips the editor entirely (`activation.ts` also
// caps haystack length independent of this).

/** The nested-quantifier shape, e.g. `(a+)+`, `(a*)+`, `([a-z]+)*` — by far the most common real-world ReDoS pattern. */
const NESTED_QUANTIFIER = /\([^()]*[+*][^()]*\)[+*]/

export function isRiskyRegexPattern(pattern: string): boolean {
  if (!pattern) return false
  return NESTED_QUANTIFIER.test(pattern)
}

/** Pulls the pattern out of a World Info `/pattern/flags` key for linting. Returns null for a plain keyword key. */
export function extractSlashRegexPattern(key: string): string | null {
  const match = key.match(/^\/(.+)\/[a-z]*$/i)
  return match ? match[1] : null
}

/** True if any key in the list is a `/regex/` key whose pattern trips the nested-quantifier heuristic. */
export function anyKeyIsRisky(keys: string[]): boolean {
  return keys.some((k) => {
    const pattern = extractSlashRegexPattern(k)
    return pattern !== null && isRiskyRegexPattern(pattern)
  })
}

/** Ceiling on how much text a World Info regex key is tested against in one call. Only bounds `RegExp.test()`, not plain `.includes()`. Far larger than any realistic scan window. */
export const MAX_REGEX_HAYSTACK_LENGTH = 50_000
