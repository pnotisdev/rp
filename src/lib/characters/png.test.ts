import { describe, expect, it } from 'vitest'
import { readCharacterFromPng, writeCharacterToPng } from './png'

// The null terminator PNG tEXt keywords use, built at runtime (not embedded as a literal escape
// in this file's own source) to keep this file plain ASCII throughout.
const NUL = String.fromCharCode(0)

/**
 * The smallest byte-valid PNG this module's own chunk walker will accept: signature, an IHDR
 * (required first chunk, arbitrary 1x1 dimensions), and an IEND. `readChunks` never reads or
 * validates the trailing CRC on a chunk it's walking (only `makeChunk`, used for chunks this
 * module writes itself, computes one) — so the dummy zero CRCs below are fine for round-tripping
 * through this module, even though a real image viewer would reject them.
 */
function buildMinimalPng(): Blob {
  const bytes = new Uint8Array([
    // PNG signature
    137, 80, 78, 71, 13, 10, 26, 10,
    // IHDR: length=13
    0, 0, 0, 13,
    // type "IHDR"
    73, 72, 68, 82,
    // width=1, height=1
    0, 0, 0, 1, 0, 0, 0, 1,
    // bit depth, color type, compression, filter, interlace
    8, 6, 0, 0, 0,
    // dummy CRC (unchecked by this module's reader)
    0, 0, 0, 0,
    // IEND: length=0
    0, 0, 0, 0,
    // type "IEND"
    73, 69, 78, 68,
    // dummy CRC
    0, 0, 0, 0,
  ])
  return new Blob([bytes], { type: 'image/png' })
}

const CARD_A = { name: 'Mira', description: 'A tall scientist.' }
const CARD_B = { name: 'Sumire', description: 'A tsundere architecture student.' }

describe('writeCharacterToPng / readCharacterFromPng', () => {
  it('round-trips a character JSON object through an embedded tEXt chunk', async () => {
    const png = await writeCharacterToPng(buildMinimalPng(), CARD_A)
    const read = await readCharacterFromPng(png)
    expect(read).toEqual(CARD_A)
  })

  it('preserves the original image chunks (IHDR still present) alongside the new metadata', async () => {
    const png = await writeCharacterToPng(buildMinimalPng(), CARD_A)
    const bytes = new Uint8Array(await png.arrayBuffer())
    // IHDR's type bytes, right after the 8-byte signature + 4-byte length.
    const ihdrType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
    expect(ihdrType).toBe('IHDR')
  })

  it('replaces stale metadata on a second write rather than accumulating duplicate chunks', async () => {
    const first = await writeCharacterToPng(buildMinimalPng(), CARD_A)
    const second = await writeCharacterToPng(first, CARD_B)
    expect(await readCharacterFromPng(second)).toEqual(CARD_B)
    // Only ever one "chara" tEXt chunk, not one from each write left stacked up. Matches on the
    // keyword plus its null terminator, the same bytes `writeCharacterToPng` writes.
    const bytes = new Uint8Array(await second.arrayBuffer())
    const charaOccurrences = countAsciiOccurrences(bytes, `chara${NUL}`)
    expect(charaOccurrences).toBe(1)
  })

  it('throws when no character metadata is embedded', async () => {
    await expect(readCharacterFromPng(buildMinimalPng())).rejects.toThrow('No character data found')
  })

  it('throws on a file that is not a PNG at all', async () => {
    const notPng = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])])
    await expect(readCharacterFromPng(notPng)).rejects.toThrow('Not a valid PNG file')
  })

  it('prefers a "ccv3" chunk over a "chara" chunk when both are present', async () => {
    // Simulate an imported card that already carries both a v2 "chara" and a v3 "ccv3" chunk by
    // writing "chara" first (this module's own writer only ever produces "chara"), then manually
    // appending a "ccv3" tEXt chunk with different content before the trailing IEND.
    const withChara = await writeCharacterToPng(buildMinimalPng(), CARD_A)
    const bytes = new Uint8Array(await withChara.arrayBuffer())

    const b64 = btoa(JSON.stringify(CARD_B))
    const keyword = new TextEncoder().encode(`ccv3${NUL}`)
    const text = new TextEncoder().encode(b64)
    const data = new Uint8Array(keyword.length + text.length)
    data.set(keyword, 0)
    data.set(text, keyword.length)
    const ccv3Chunk = makeRawTextChunk(data)

    // Splice the new chunk in right before the trailing IEND (last 12 bytes: 4 length + 4 type "IEND" + 4 crc).
    const iendChunk = bytes.slice(bytes.length - 12)
    const withoutIend = bytes.slice(0, bytes.length - 12)
    const spliced = new Uint8Array(withoutIend.length + ccv3Chunk.length + iendChunk.length)
    spliced.set(withoutIend, 0)
    spliced.set(ccv3Chunk, withoutIend.length)
    spliced.set(iendChunk, withoutIend.length + ccv3Chunk.length)

    const read = await readCharacterFromPng(new Blob([spliced]))
    expect(read).toEqual(CARD_B)
  })
})

function makeRawTextChunk(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + 4 + data.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode('tEXt'), 4)
  out.set(data, 8)
  // CRC is unchecked by this module's reader — zero is fine here too.
  return out
}

/** Counts how many times an ASCII marker (e.g. a chunk's null-terminated keyword) appears in a byte buffer. */
function countAsciiOccurrences(bytes: Uint8Array, marker: string): number {
  const needle = Array.from(marker, (c) => c.charCodeAt(0))
  let count = 0
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer
    }
    count++
  }
  return count
}
