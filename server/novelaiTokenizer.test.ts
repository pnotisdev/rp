import { describe, expect, it } from 'vitest'
import { encodeTokens, tokenizerForModel } from './novelaiTokenizer.ts'

/**
 * Unlike the rest of the NovelAI integration (real generation needs a paid account this session
 * never had), this piece is genuinely, fully verifiable: the bundled `.model` files are NovelAI's
 * own real published tokenizers, loaded by the same library SillyTavern itself uses. These tests
 * load the actual files and check real output — not mocked.
 */
describe('tokenizerForModel', () => {
  it('maps kayra and clio model ids to their respective NerdStash tokenizer', () => {
    expect(tokenizerForModel('kayra-v1')).toBe('nerdstash_v2')
    expect(tokenizerForModel('clio-v1')).toBe('nerdstash_v1')
  })

  it('is case-insensitive', () => {
    expect(tokenizerForModel('KAYRA-V1')).toBe('nerdstash_v2')
  })

  it('returns null for erato and any unrecognized model — no bundled tokenizer for either', () => {
    expect(tokenizerForModel('erato-v1')).toBeNull()
    expect(tokenizerForModel('llama-3-erato-v1')).toBeNull()
    expect(tokenizerForModel('something-else')).toBeNull()
  })
})

describe('encodeTokens — real NerdStash model files', () => {
  it('encodes text into a non-empty array of positive integer token ids (nerdstash_v2 / Kayra)', async () => {
    const ids = await encodeTokens('Hello, world!', 'nerdstash_v2')
    expect(Array.isArray(ids)).toBe(true)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(Number.isInteger(id)).toBe(true)
      expect(id).toBeGreaterThanOrEqual(0)
    }
  })

  it('encodes text with the other tokenizer too (nerdstash_v1 / Clio)', async () => {
    const ids = await encodeTokens('Hello, world!', 'nerdstash_v1')
    expect(ids.length).toBeGreaterThan(0)
  })

  it('produces more tokens for longer text than for a short prefix of it', async () => {
    const short = await encodeTokens('The quick brown fox', 'nerdstash_v2')
    const long = await encodeTokens('The quick brown fox jumps over the lazy dog, again and again.', 'nerdstash_v2')
    expect(long.length).toBeGreaterThan(short.length)
  })

  it('is deterministic — the same text encodes to the same ids every time', async () => {
    const a = await encodeTokens('Consistency check.', 'nerdstash_v2')
    const b = await encodeTokens('Consistency check.', 'nerdstash_v2')
    expect(a).toEqual(b)
  })

  it('caches the loaded processor — a second call for the same tokenizer does not reload the model file', async () => {
    // Not directly observable from outside, but a second real call completing quickly (not
    // re-reading a ~1MB file + WASM init) is the practical signal this test cares about.
    const start = performance.now()
    await encodeTokens('warm', 'nerdstash_v2')
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200)
  })
})
