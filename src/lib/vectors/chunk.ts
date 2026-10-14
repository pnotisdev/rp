// Splits a document into passages short enough to embed, keeping paragraphs and sentences whole where it can.

export interface ChunkOptions {
  /** Longest a chunk may be, in characters. */
  maxChars?: number
  /** How much of the end of one chunk is repeated at the start of the next, so a thought split between two still reads. */
  overlap?: number
}

/** Breaks one over-long paragraph on sentence ends, then on spaces, then wherever it must. */
function splitLong(text: string, max: number): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?]+["')\]]*\s*|[^.!?\n]+$/g) ?? [text]
  const out: string[] = []
  let current = ''
  const push = () => {
    if (current.trim()) out.push(current.trim())
    current = ''
  }
  for (const sentence of sentences) {
    if (sentence.length > max) {
      push()
      for (let i = 0; i < sentence.length; i += max) out.push(sentence.slice(i, i + max).trim())
      continue
    }
    if (current.length + sentence.length > max) push()
    current += sentence
  }
  push()
  return out.filter(Boolean)
}

/** The last `overlap` characters of a chunk, starting at a word boundary. */
function tail(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return overlap > 0 ? text : ''
  const cut = text.slice(text.length - overlap)
  const space = cut.search(/\s/)
  return space >= 0 ? cut.slice(space + 1) : cut
}

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const max = Math.max(50, opts.maxChars ?? 800)
  const overlap = Math.min(Math.max(0, opts.overlap ?? 100), Math.floor(max / 3))
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => (p.length > max ? splitLong(p, max) : [p]))
  const chunks: string[] = []
  let current = ''
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > max) {
      chunks.push(current)
      const carry = tail(current, overlap)
      current = carry && carry.length + p.length + 2 <= max ? `${carry}\n\n${p}` : p
    } else {
      current = current ? `${current}\n\n${p}` : p
    }
  }
  if (current) chunks.push(current)
  return chunks
}
