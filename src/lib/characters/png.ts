// Minimal PNG tEXt chunk reader/writer, just enough to read/write the
// SillyTavern/TavernAI "chara" metadata chunk (base64 JSON) embedded in
// character card avatar PNGs. No external deps, browser-only.

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

interface PngChunk {
  type: string
  data: Uint8Array
}

function readChunks(bytes: Uint8Array): PngChunk[] {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('Not a valid PNG file')
  }
  const chunks: PngChunk[] = []
  let offset = 8
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  while (offset < bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    )
    const data = bytes.slice(offset + 8, offset + 8 + length)
    chunks.push({ type, data })
    offset += 12 + length // length + type + data + crc
    if (type === 'IEND') break
  }
  return chunks
}

function decodeTextChunk(data: Uint8Array): { keyword: string; text: string } | null {
  const nullIdx = data.indexOf(0)
  if (nullIdx === -1) return null
  const keyword = new TextDecoder('latin1').decode(data.slice(0, nullIdx))
  const text = new TextDecoder('utf-8').decode(data.slice(nullIdx + 1))
  return { keyword, text }
}

/** Extracts and parses the embedded "chara" (or "ccv3") JSON from a card PNG. */
export async function readCharacterFromPng(file: File | Blob): Promise<unknown> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const chunks = readChunks(buf)
  const textChunks = chunks.filter((c) => c.type === 'tEXt').map((c) => decodeTextChunk(c.data))
  const chara = textChunks.find((t) => t?.keyword === 'chara')
  const ccv3 = textChunks.find((t) => t?.keyword === 'ccv3')
  const chosen = ccv3 ?? chara
  if (!chosen) throw new Error('No character data found embedded in this PNG')
  const jsonStr = base64ToUtf8(chosen.text)
  return JSON.parse(jsonStr)
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

// --- CRC32 for chunk writing ---
let crcTable: Uint32Array | null = null
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  crcTable = table
  return table
}

function crc32(bytes: Uint8Array): number {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (const b of bytes) {
    crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const body = new Uint8Array(typeBytes.length + data.length)
  body.set(typeBytes, 0)
  body.set(data, typeBytes.length)

  const out = new Uint8Array(4 + 4 + data.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(typeBytes, 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(body))
  return out
}

/** Embeds a character JSON object into a PNG (as the avatar), returning a new Blob. */
export async function writeCharacterToPng(avatar: File | Blob, characterJson: unknown): Promise<Blob> {
  const buf = new Uint8Array(await avatar.arrayBuffer())
  const chunks = readChunks(buf)

  const keyword = new TextEncoder().encode('chara\0')
  const b64 = utf8ToBase64(JSON.stringify(characterJson))
  const textBytes = new TextEncoder().encode(b64)
  const chunkData = new Uint8Array(keyword.length + textBytes.length)
  chunkData.set(keyword, 0)
  chunkData.set(textBytes, keyword.length)
  const charaChunk = makeChunk('tEXt', chunkData)

  const parts: Uint8Array[] = [new Uint8Array(PNG_SIGNATURE)]
  for (const chunk of chunks) {
    if (chunk.type === 'tEXt') {
      const decoded = decodeTextChunk(chunk.data)
      if (decoded?.keyword === 'chara' || decoded?.keyword === 'ccv3') continue // drop stale metadata
    }
    if (chunk.type === 'IEND') {
      parts.push(charaChunk)
    }
    parts.push(makeChunk(chunk.type, chunk.data))
  }

  const totalLen = parts.reduce((sum, p) => sum + p.length, 0)
  const result = new Uint8Array(totalLen)
  let off = 0
  for (const p of parts) {
    result.set(p, off)
    off += p.length
  }
  return new Blob([result], { type: 'image/png' })
}
