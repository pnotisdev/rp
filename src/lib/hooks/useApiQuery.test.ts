import { describe, expect, it, vi } from 'vitest'
import { coalesceKey, withCoalescing } from './useApiQuery'

describe('coalesceKey', () => {
  it('gives the same key for the same fetcher source and deps', () => {
    const a = () => Promise.resolve('a')
    const b = () => Promise.resolve('a') // identical source text, different closure instance
    expect(coalesceKey(a, [])).toBe(coalesceKey(b, []))
  })

  it('gives a different key for a differently-shaped fetcher even with the same deps', () => {
    // The exact real-world collision this guards against: `chatsApi.list()` and `chatsApi.trash()`
    // both live under the 'chats' invalidation channel with deps: [] — coalescing must not merge them.
    const list = () => Promise.resolve('list')
    const trash = () => Promise.resolve('trash')
    expect(coalesceKey(list, [])).not.toBe(coalesceKey(trash, []))
  })

  it('gives a different key for the same fetcher with different deps', () => {
    const fetcher = () => Promise.resolve('x')
    expect(coalesceKey(fetcher, ['id-1'])).not.toBe(coalesceKey(fetcher, ['id-2']))
  })

  it('returns null when deps are not JSON-safe, rather than throwing', () => {
    const fetcher = () => Promise.resolve('x')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(coalesceKey(fetcher, [circular])).toBeNull()
  })
})

describe('withCoalescing', () => {
  it('shares one call to run() across two callers using the same key while it is pending', async () => {
    const run = vi.fn().mockResolvedValue('result')
    const p1 = withCoalescing('key-a', run)
    const p2 = withCoalescing('key-a', run)
    expect(run).toHaveBeenCalledTimes(1)
    await expect(p1).resolves.toBe('result')
    await expect(p2).resolves.toBe('result')
  })

  it('runs separately for different keys', async () => {
    const run = vi.fn().mockResolvedValue('result')
    withCoalescing('key-a', run)
    withCoalescing('key-b', run)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('runs fresh again once the prior call has settled, rather than caching forever', async () => {
    const run = vi.fn().mockResolvedValue('result')
    await withCoalescing('key-a', run)
    await withCoalescing('key-a', run)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('clears its entry even when run() rejects, so a retry is not stuck reusing the failure', async () => {
    const run = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(withCoalescing('key-a', run)).rejects.toThrow('boom')
    const run2 = vi.fn().mockResolvedValue('ok')
    await expect(withCoalescing('key-a', run2)).resolves.toBe('ok')
  })

  it('never coalesces when key is null — every call runs its own request', async () => {
    const run = vi.fn().mockResolvedValue('result')
    withCoalescing(null, run)
    withCoalescing(null, run)
    expect(run).toHaveBeenCalledTimes(2)
  })
})
