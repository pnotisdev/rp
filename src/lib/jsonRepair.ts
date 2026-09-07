// Local models frequently return "almost JSON": markdown-fenced or with surrounding commentary,
// trailing commas, literal newlines in strings, missing commas between properties, and unescaped
// quote marks inside dialogue text that desync naive string-boundary tracking. Each repair pass
// below assumes the earlier ones already ran; parseLenientJson tries progressively more aggressive
// combinations.
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
  // Must run before repairUnescapedQuotes — that pass would otherwise read a key genuinely followed by a bracket as "not really closed" and escape it into a never-ending string.
  const colonsInserted = insertMissingColons(quotesNormalized)
  const quotesRepaired = repairUnescapedQuotes(colonsInserted)
  const newlinesEscaped = escapeRawNewlinesInStrings(quotesRepaired)
  const commasInserted = insertMissingCommas(newlinesEscaped)
  const commasStripped = stripTrailingCommas(commasInserted)
  return closeUnbalanced(commasStripped)
}

/** A model occasionally drops the colon entirely, e.g. `"occupation" ["barista"]` instead of `"occupation": [...]`. Safe without nesting-tracking — a string is never legitimately followed directly by `[` or `{`. */
function insertMissingColons(json: string): string {
  return json.replace(/("(?:[^"\\]|\\.)*")\s*([[{])/g, '$1: $2')
}

function extractBraces(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1) throw new Error('No JSON object found in model output')
  // Tolerate a response cut off before its closing brace — closeUnbalanced() downstream appends what's missing.
  return end === -1 || end <= start ? text.slice(start) : text.slice(start, end + 1)
}

function normalizeQuotes(json: string): string {
  return json.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
}

/** Models often type literal "quote marks" inside dialogue without escaping them. Heuristic: when a `"` appears mid-string, peek past whitespace — if the next char looks like valid JSON continuation, treat this as the real closing quote; otherwise it's a literal quote, so escape it. */
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
    // A following `"` also counts as a terminator — the common "missing comma before the next key" case, far more likely than two literal quotes back to back.
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

/** By this point string boundaries are trustworthy, so "string end, whitespace, string start" with nothing between can only be a missing comma. */
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
