/**
 * Local models frequently return "almost JSON" rather than strict JSON. In practice the
 * failures cluster into a few recurring shapes:
 *  - wrapped in markdown fences or preceded/followed by commentary
 *  - a trailing comma before a closing } or ]
 *  - literal newlines inside string values where \n was meant
 *  - a missing comma between two properties or two array elements
 *  - (the nastiest one) literal, unescaped "quote marks" typed inside dialogue text,
 *    which desyncs naive string-boundary tracking for everything after it
 * Each repair pass is applied in order of how much it assumes about the others having
 * already run; parseLenientJson tries progressively more aggressive combinations.
 */
export function parseLenientJson(raw: string): unknown {
  const attempts: (() => unknown)[] = [
    () => JSON.parse(raw),
    () => JSON.parse(extractBraces(raw)),
    () => JSON.parse(repairPipeline(extractBraces(raw))),
  ]

  let lastError: unknown
  for (const attempt of attempts) {
    try {
      return attempt()
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not parse JSON from model output')
}

function repairPipeline(json: string): string {
  const quotesNormalized = normalizeQuotes(json)
  // Runs before repairUnescapedQuotes on purpose: that pass only recognizes `,:}]"` as valid
  // characters after a string's closing quote, so a key genuinely followed by a bracket (the
  // malformed shape this fixes) reads to it as "not really closed" and gets escaped into a
  // never-ending string instead. Inserting the colon first turns it into an ordinary `"key": [`
  // that repairUnescapedQuotes already handles correctly.
  const colonsInserted = insertMissingColons(quotesNormalized)
  const quotesRepaired = repairUnescapedQuotes(colonsInserted)
  const newlinesEscaped = escapeRawNewlinesInStrings(quotesRepaired)
  const commasInserted = insertMissingCommas(newlinesEscaped)
  const commasStripped = stripTrailingCommas(commasInserted)
  return closeUnbalanced(commasStripped)
}

/**
 * A model occasionally drops the colon between a key and its value entirely, e.g.
 * `"occupation" ["barista", ...]` instead of `"occupation": [...]` — seen from
 * `generateTraitOptions`'s object-of-arrays shape (none of the other draft prompts ask for
 * a plain object whose every value is itself an array, so this particular slip hadn't shown
 * up before). Safe without tracking object/array nesting: a string is never legitimately
 * followed directly by `[` or `{` — the "missing comma between two array string elements"
 * case `insertMissingCommas` handles never produces that shape either, since two adjacent
 * string elements are separated by a quote, not a bracket — so any occurrence here is
 * unambiguously a missing colon before an array/object value.
 */
function insertMissingColons(json: string): string {
  return json.replace(/("(?:[^"\\]|\\.)*")\s*([[{])/g, '$1: $2')
}

function extractBraces(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1) throw new Error('No JSON object found in model output')
  // Tolerate a response that got cut off before its closing brace — closeUnbalanced()
  // downstream will attempt to append what's missing.
  return end === -1 || end <= start ? text.slice(start) : text.slice(start, end + 1)
}

function normalizeQuotes(json: string): string {
  return json.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
}

/**
 * Models very often type literal "quote marks" inside dialogue/string content without
 * escaping them, e.g. `"personality": "gruff. "Don't push me," he said."`. A naive
 * quote-toggle parser treats that second `"` as the string's end, corrupting everything
 * after it. Heuristic: when we hit a `"` while already inside a string, peek past
 * whitespace at the next significant character — if it looks like valid JSON
 * continuation (`,` `:` `}` `]` or end-of-input), treat this as the real closing quote;
 * otherwise it's almost certainly a literal quote inside the text, so escape it.
 */
function repairUnescapedQuotes(json: string): string {
  let out = ''
  let inString = false
  let escapeNext = false
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]
    if (escapeNext) {
      out += ch
      escapeNext = false
      continue
    }
    if (ch === '\\') {
      out += ch
      escapeNext = true
      continue
    }
    if (ch !== '"') {
      out += ch
      continue
    }
    if (!inString) {
      inString = true
      out += ch
      continue
    }
    let j = i + 1
    while (j < json.length && /\s/.test(json[j])) j++
    const next = json[j]
    // A following `"` also counts as a terminator signal: it's the extremely common
    // "missing comma before the next key" case (insertMissingCommas fixes the comma
    // afterward) — far more likely in practice than two literal quotes back to back.
    const looksLikeTerminator = next === undefined || ',:}]"'.includes(next)
    if (looksLikeTerminator) {
      inString = false
      out += ch
    } else {
      out += '\\"'
    }
  }
  return out
}

/** Once string boundaries are trustworthy, turn any literal control character still inside a string into its escape. */
function escapeRawNewlinesInStrings(json: string): string {
  let out = ''
  let inString = false
  let escapeNext = false
  for (const ch of json) {
    if (escapeNext) {
      out += ch
      escapeNext = false
      continue
    }
    if (ch === '\\') {
      out += ch
      escapeNext = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      out += ch
      continue
    }
    if (inString && ch === '\n') {
      out += '\\n'
      continue
    }
    if (inString && ch === '\r') {
      continue
    }
    if (inString && ch === '\t') {
      out += '\\t'
      continue
    }
    out += ch
  }
  return out
}

/**
 * Local models very commonly forget the comma between two properties or two array
 * elements. By this point string boundaries are trustworthy (repairUnescapedQuotes
 * already ran), so every remaining `"` really is a string delimiter — which means
 * "string end, whitespace, string start" with nothing in between can only be a missing
 * comma; valid JSON never has that shape. Safe to fix unconditionally, whether the gap
 * is a newline (pretty-printed) or just a space (single-line output).
 */
function insertMissingCommas(json: string): string {
  return json.replace(/(["\d\]}])([ \t]*\n\s*|[ \t]+)(")/g, '$1,$2$3')
}

function stripTrailingCommas(json: string): string {
  return json.replace(/,(\s*[}\]])/g, '$1')
}

/** Last resort for a response truncated mid-object: close whatever's still open. */
function closeUnbalanced(json: string): string {
  let depthBraces = 0
  let depthBrackets = 0
  let inString = false
  let escapeNext = false
  for (const ch of json) {
    if (escapeNext) {
      escapeNext = false
      continue
    }
    if (ch === '\\') {
      escapeNext = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depthBraces++
    else if (ch === '}') depthBraces--
    else if (ch === '[') depthBrackets++
    else if (ch === ']') depthBrackets--
  }
  let out = json
  if (inString) out += '"'
  out += ']'.repeat(Math.max(0, depthBrackets))
  out += '}'.repeat(Math.max(0, depthBraces))
  return out
}
