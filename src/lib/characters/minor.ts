// Age check shared by the character drafting stages and the MCP tools (no imports: the server loads it too).

const AGE_WORDS = /\b(?:minor|underage|under-age|teen|teenage|teenager|schoolgirl|schoolboy|loli|shota|high[- ]school(?:er)?)\b/i
const AGE_NUMBERS = /\b(\d{1,2})[- ]?(?:years?[- ]?old|y\/?o)\b|\bage[ds]?:?\s*(\d{1,2})\b/gi

/** True when any of the texts says the character is under 18. A false positive only leaves a section blank. */
export function describesMinor(...texts: (string | undefined)[]): boolean {
  const all = texts.filter(Boolean).join('\n')
  if (AGE_WORDS.test(all)) return true
  return [...all.matchAll(AGE_NUMBERS)].some((m) => Number(m[1] ?? m[2]) < 18)
}
