import { describe, expect, it } from 'vitest'
import { pickVariant } from './pickVariant'

describe('pickVariant', () => {
  it('returns the only candidate when there is just one', () => {
    expect(pickVariant(['a'], 'anything')).toBe('a')
  })

  it('always returns the same pick for the same seed and pool', () => {
    const pool = ['a', 'b', 'c']
    const first = pickVariant(pool, 'message-123')
    for (let i = 0; i < 5; i++) expect(pickVariant(pool, 'message-123')).toBe(first)
  })

  it('can return a different pick for a different seed', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const picks = new Set(Array.from({ length: 20 }, (_, i) => pickVariant(pool, `seed-${i}`)))
    // Not every seed collapses to the same bucket — a real spread across the pool.
    expect(picks.size).toBeGreaterThan(1)
  })

  it('only ever returns an actual member of the pool', () => {
    const pool = ['x', 'y', 'z']
    for (let i = 0; i < 20; i++) expect(pool).toContain(pickVariant(pool, `s${i}`))
  })
})
