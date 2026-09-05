import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { extractFirstFileFromZip, uint8ArrayToBase64 } from './binaryUtils'

/** Builds a minimal single-entry ZIP local-file-header + data — enough for `extractFirstFileFromZip`, which only ever reads the first entry (correct for NovelAI's real one-file-per-request output). */
function buildZip(data: Uint8Array, compressionMethod: 0 | 8): ArrayBuffer {
  const payload = compressionMethod === 8 ? new Uint8Array(deflateRawSync(Buffer.from(data))) : data
  const filename = new TextEncoder().encode('image_0.png')
  const header = new Uint8Array(30 + filename.length + payload.length)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x04034b50, true) // local file header signature
  view.setUint16(8, compressionMethod, true)
  view.setUint32(18, payload.length, true) // compressed size
  view.setUint32(22, data.length, true) // uncompressed size
  view.setUint16(26, filename.length, true)
  view.setUint16(28, 0, true) // extra field length
  header.set(filename, 30)
  header.set(payload, 30 + filename.length)
  return header.buffer
}

describe('uint8ArrayToBase64', () => {
  it('round-trips through atob correctly', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
    const b64 = uint8ArrayToBase64(bytes)
    expect(b64).toBe(btoa('Hello'))
  })

  it('handles an array larger than the internal chunk size without error', () => {
    const bytes = new Uint8Array(0x8000 * 3 + 17).fill(65)
    expect(() => uint8ArrayToBase64(bytes)).not.toThrow()
    expect(uint8ArrayToBase64(bytes).length).toBeGreaterThan(0)
  })
})

describe('extractFirstFileFromZip', () => {
  const original = new TextEncoder().encode('this is a fake png payload for testing')

  it('extracts a stored (uncompressed) entry unchanged', async () => {
    const zip = buildZip(original, 0)
    const extracted = await extractFirstFileFromZip(zip)
    expect(new TextDecoder().decode(extracted)).toBe('this is a fake png payload for testing')
  })

  it('inflates a deflate-compressed entry back to the original bytes', async () => {
    const zip = buildZip(original, 8)
    const extracted = await extractFirstFileFromZip(zip)
    expect(new TextDecoder().decode(extracted)).toBe('this is a fake png payload for testing')
  })

  it('rejects a buffer that is not a valid ZIP', async () => {
    const notAZip = new TextEncoder().encode('not a zip file at all')
    await expect(extractFirstFileFromZip(notAZip.buffer)).rejects.toThrow(/not a valid zip/i)
  })
})
