/**
 * Chunked to avoid `String.fromCharCode(...bytes)` blowing the call-stack argument limit on a
 * large image (a spread of a multi-hundred-KB array is a real, easy-to-hit failure, not a
 * theoretical one) — 0x8000 bytes per chunk stays well under every engine's limit.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/**
 * NovelAI's image-generation endpoint returns a ZIP archive (one PNG inside) rather than a plain
 * image or base64 payload — confirmed from multiple independent descriptions of the API, though
 * never seen a real response from it this session. Reads just the first local file header rather
 * than a full ZIP parser (correct for NovelAI's actual output: a single-file archive), and handles
 * both ZIP compression methods actually in use in the wild — `0` (stored, no compression) and `8`
 * (deflate) — via the standard `DecompressionStream` Web API rather than adding a zip/inflate
 * dependency for this one call site.
 */
export async function extractFirstFileFromZip(buffer: ArrayBuffer): Promise<Uint8Array> {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  // Local file header signature "PK\x03\x04", stored little-endian as a single u32.
  if (buffer.byteLength < 30 || view.getUint32(0, true) !== 0x04034b50) {
    throw new Error('Not a valid ZIP archive (no local file header signature found).')
  }
  const compressionMethod = view.getUint16(8, true)
  const compressedSize = view.getUint32(18, true)
  const filenameLen = view.getUint16(26, true)
  const extraLen = view.getUint16(28, true)
  const dataStart = 30 + filenameLen + extraLen
  const compressedData = bytes.slice(dataStart, dataStart + compressedSize)

  if (compressionMethod === 0) return compressedData
  if (compressionMethod === 8) {
    const stream = new Blob([compressedData]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  throw new Error(`Unsupported ZIP compression method (${compressionMethod}) — expected stored (0) or deflate (8).`)
}
