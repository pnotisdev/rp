import { beforeEach, describe, expect, it, vi } from 'vitest'
import { countTokensCached, invalidateTokenCache, tokenCacheSize } from './tokenCache'

describe('countTokensCached', () => {
  beforeEach(() => invalidateTokenCache())

  it('computes once and serves every repeat from cache', async () => {
    const compute = vi.fn(async (t: string) => t.length)
    expect(await countTokensCached('hello', compute)).toBe(5)
    expect(await countTokensCached('hello', compute)).toBe(5)
    expect(await countTokensCached('hello', compute)).toBe(5)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('keys on the exact text, so a different turn is counted separately', async () => {
    const compute = vi.fn(async (t: string) => t.length)
    await countTokensCached('one', compute)
    await countTokensCached('two!', compute)
    expect(compute).toHaveBeenCalledTimes(2)
    expect(await countTokensCached('two!', compute)).toBe(4)
  })

  it('short-circuits empty text without calling the tokenizer at all', async () => {
    const compute = vi.fn(async (t: string) => t.length)
    expect(await countTokensCached('', compute)).toBe(0)
    expect(compute).not.toHaveBeenCalled()
  })

  it('coalesces concurrent requests for the same text into one call', async () => {
    // The real shape this guards: two prompt builds in flight at once (a generation plus the
    // Prompt Inspector) asking for the same fixed block.
    let resolve: (n: number) => void = () => {}
    const compute = vi.fn(() => new Promise<number>((r) => (resolve = r)))
    const a = countTokensCached('shared', compute)
    const b = countTokensCached('shared', compute)
    resolve(42)
    expect(await a).toBe(42)
    expect(await b).toBe(42)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed count, so the next attempt retries', async () => {
    const compute = vi.fn(async () => {
      throw new Error('tokenizer offline')
    })
    await expect(countTokensCached('x', compute)).rejects.toThrow('tokenizer offline')
    await expect(countTokensCached('x', compute)).rejects.toThrow('tokenizer offline')
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('invalidateTokenCache forces a recount — the model-swap case', async () => {
    const compute = vi.fn(async (t: string) => t.length)
    await countTokensCached('hello', compute)
    invalidateTokenCache()
    expect(tokenCacheSize()).toBe(0)
    await countTokensCached('hello', compute)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('stays bounded, evicting least-recently-used entries', async () => {
    const compute = async (t: string) => t.length
    for (let i = 0; i < 2100; i++) await countTokensCached(`turn-${i}`, compute)
    expect(tokenCacheSize()).toBeLessThanOrEqual(2000)
  })

  it('a cache hit refreshes recency, so a hot entry outlives colder newer ones', async () => {
    const compute = vi.fn(async (t: string) => t.length)
    await countTokensCached('hot', compute)
    // Fill past the cap, touching 'hot' along the way so it never becomes the oldest entry.
    for (let i = 0; i < 2100; i++) {
      await countTokensCached(`filler-${i}`, compute)
      if (i % 100 === 0) await countTokensCached('hot', compute)
    }
    const callsBefore = compute.mock.calls.length
    await countTokensCached('hot', compute)
    expect(compute.mock.calls.length).toBe(callsBefore)
  })
})
