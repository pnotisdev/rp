/**
 * Section 9's ReDoS audit finding: both World Info's regex-key syntax (`activation.ts`) and
 * Settings → Regex Scripts (`regexScripts.ts`) compile arbitrary regex from an imported card/
 * lorebook/preset and run it against real conversation text on every turn, with no complexity
 * check — a pathological pattern (the classic catastrophic-backtracking shape, `(a+)+$` and its
 * relatives) could hang the tab. General regex-complexity analysis is undecidable, so this is
 * deliberately a shallow, fast heuristic for the *common* shape, not a real static analyzer — good
 * enough to flag a suspicious pattern at authoring time, not a guarantee nothing dangerous gets
 * through (an imported file skips the editor entirely, which is why `activation.ts` also caps how
 * much text a regex key ever gets tested against, independent of this).
 */

/**
 * Flags the textbook "nested quantifier" shape — a group containing its own `+`/`*` immediately
 * wrapped in another `+`/`*` from outside, e.g. `(a+)+`, `(a*)+`, `([a-z]+)*`, `(\d*)+`. This is by
 * far the most common real-world ReDoS pattern (and the one the audit's own example, `(a+)+$`,
 * uses) — genuinely exotic alternation-based blowups exist too, but a general detector for those
 * needs real regex-AST analysis, well past what a "flag it, don't silently block it" linter should
 * attempt.
 */
const NESTED_QUANTIFIER = /\([^()]*[+*][^()]*\)[+*]/

export function isRiskyRegexPattern(pattern: string): boolean {
  if (!pattern) return false
  return NESTED_QUANTIFIER.test(pattern)
}

/**
 * Pulls the pattern out of a World Info `/pattern/flags` key for the editor's own linting — a
 * lighter-weight sibling of `activation.ts`'s `parseRegexKey`, which also resolves the
 * case-sensitivity flag and actually compiles it; the editor only needs the raw pattern text to
 * run `isRiskyRegexPattern` over, not a working `RegExp`. Returns null for a plain keyword key.
 */
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

/**
 * A generous ceiling on how much text a World Info regex key is ever tested against in one call —
 * independent of the linter above, since an imported card/lorebook never passes through it. Plain
 * substring matching (`.includes()`) is untouched, since it can't catastrophically backtrack
 * regardless of input length; only `RegExp.test()` calls are bounded by this. Far larger than any
 * realistic `scan_depth` window produces (tens of messages at typical chat-reply length), so this
 * only ever engages for a pathologically long haystack, never ordinary scanning.
 */
export const MAX_REGEX_HAYSTACK_LENGTH = 50_000
