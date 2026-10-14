// Texting reply format: one stored message holds several chat bubbles, one per line, with ``` fences keeping long-form content (an…

export interface Bubble {
  text: string
  /** Long-form content that was fenced: rendered as one bubble with its own line breaks. */
  block: boolean
}

const FENCE_RE = /^\s*```/

/** Splits stored text into bubbles. With `streaming`, a trailing unfinished line or open fence is held back. */
export function splitBubbles(text: string, streaming = false): { bubbles: Bubble[]; pending: boolean } {
  const lines = text.split('\n')
  const bubbles: Bubble[] = []
  let block: string[] | null = null
  let pending = false
  lines.forEach((raw, i) => {
    const isLast = i === lines.length - 1
    if (block) {
      if (FENCE_RE.test(raw)) {
        bubbles.push({ text: block.join('\n').trim(), block: true })
        block = null
      } else block.push(raw)
      return
    }
    if (FENCE_RE.test(raw)) {
      block = []
      return
    }
    const line = raw.trim()
    if (!line) return
    if (streaming && isLast) {
      pending = true
      return
    }
    bubbles.push({ text: line, block: false })
  })
  if (block) {
    const body = (block as string[]).join('\n').trim()
    if (streaming) pending = true
    else if (body) bubbles.push({ text: body, block: true })
  }
  return { bubbles: bubbles.filter((b) => b.text), pending }
}

export interface TextingCleanOptions {
  charName: string
  personaName?: string
  /** Most bubbles kept per reply; extras are merged into the last one. */
  maxBubbles?: number
  /** Mid-stream: leave an open fence open so its bubble isn't shown half-written. */
  streaming?: boolean
}

/** Normalizes a model reply into texting form: no action beats, no speaker prefixes or wrapping quotes, one bubble per line. */
export function toTextingReply(text: string, opts: TextingCleanOptions): string {
  const max = opts.maxBubbles ?? 6
  const names = [opts.charName, opts.personaName].filter((n): n is string => !!n)
  const prefix = new RegExp(`^(?:${names.map(escapeRe).join('|')})\\s*:\\s*`, 'i')
  const out: string[] = []
  let block: string[] | null = null
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (block) {
      block.push(raw)
      if (FENCE_RE.test(raw)) {
        out.push(block.join('\n'))
        block = null
      }
      continue
    }
    if (FENCE_RE.test(raw)) {
      block = ['```']
      continue
    }
    let line = raw
      .replace(/\*[^*\n]+\*/g, ' ')
      .replace(prefix, '')
      .replace(/\s+/g, ' ')
      .trim()
    // A whole line wrapped in quotes is roleplay habit, not texting.
    const quoted = line.match(/^["“](.*)["”]$/)
    if (quoted && !/["“”]/.test(quoted[1])) line = quoted[1].trim()
    if (line && !/^[*\s]+$/.test(line)) out.push(line)
  }
  if (block && (block.length > 1 || opts.streaming)) out.push(opts.streaming ? block.join('\n') : [...block, '```'].join('\n'))
  if (out.length > max) out.splice(max - 1, out.length, out.slice(max - 1).join(' '))
  return out.join('\n')
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A reply cut off by the token cap loses its half-written last text (or closes an open fence). */
export function dropUnfinishedLastBubble(text: string): string {
  const lines = text.split('\n')
  const fences = lines.filter((l) => FENCE_RE.test(l)).length
  if (fences % 2 === 1) return `${text.trimEnd()}\n\`\`\``
  if (lines.length < 2 || /[.!?)"'~]$/.test(lines[lines.length - 1].trim())) return text
  return lines.slice(0, -1).join('\n')
}

/** Pause before a bubble appears, as if typed: longer texts take longer, within limits. */
export function typingDelayMs(bubble: Bubble, rng: () => number = Math.random): number {
  if (bubble.block) return 900
  const base = 450 + bubble.text.length * 28
  return Math.round(Math.min(2400, Math.max(650, base)) * (0.85 + rng() * 0.3))
}

const SHORTHAND: [RegExp, string][] = [
  [/\bngl\b/gi, 'not gonna lie'],
  [/\btbh\b/gi, 'to be honest'],
  [/\bidk\b/gi, "I don't know"],
  [/\bimo\b/gi, 'in my opinion'],
  [/\brn\b/gi, 'right now'],
  [/\bomg\b/gi, 'oh my god'],
  [/\bbrb\b/gi, 'be right back'],
  [/\bbtw\b/gi, 'by the way'],
  [/\bfr\b/gi, 'for real'],
  [/\bu\b/gi, 'you'],
  [/\bur\b/gi, 'your'],
  [/\bpls\b/gi, 'please'],
]

const LAUGH_RE = /\b(lmf?ao+|lol+|rofl|ha(ha)+h?|hehe+)\b[.!]*/gi

/** Turns a texting bubble into something a voice can say: shorthand spelled out, laughs voiced. */
export function speakableBubble(text: string, opts: { audioTags?: boolean } = {}): string {
  let out = text
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/\p{Extended_Pictographic}/gu, '')
  out = out.replace(LAUGH_RE, opts.audioTags ? '[laughs]' : 'haha')
  for (const [re, spoken] of SHORTHAND) out = out.replace(re, spoken)
  return out.replace(/[_~#]/g, '').replace(/\s+/g, ' ').trim()
}
