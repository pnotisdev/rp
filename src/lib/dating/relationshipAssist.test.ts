import { describe, expect, it } from 'vitest'
import { scaleDeltasForDifficulty, type RelationshipDeltas } from '@/lib/dating/relationshipAssist'

const deltas = (overrides: Partial<RelationshipDeltas>): RelationshipDeltas => ({
  affection: 0,
  trust: 0,
  chemistry: 0,
  comfort: 0,
  respect: 0,
  curiosity: 0,
  tension: 0,
  ...overrides,
})

describe('scaleDeltasForDifficulty', () => {
  it('leaves deltas untouched on normal difficulty', () => {
    const d = deltas({ affection: 2, tension: -1 })
    expect(scaleDeltasForDifficulty(d, 'normal')).toEqual(d)
  })

  it('softens swings on gentle', () => {
    const d = deltas({ affection: 5, tension: -5 })
    const scaled = scaleDeltasForDifficulty(d, 'gentle')
    expect(scaled.affection).toBe(3)
    expect(scaled.tension).toBe(-3)
  })

  it('sharpens swings on harsh', () => {
    const d = deltas({ affection: 2, tension: -2 })
    const scaled = scaleDeltasForDifficulty(d, 'harsh')
    expect(scaled.affection).toBe(3)
    expect(scaled.tension).toBe(-3)
  })

  it('rounds to the nearest integer rather than drifting to fractions', () => {
    const d = deltas({ affection: 1 })
    const scaled = scaleDeltasForDifficulty(d, 'gentle')
    expect(Number.isInteger(scaled.affection)).toBe(true)
  })

  it('leaves an all-zero delta set as all zero on every difficulty', () => {
    const zero = deltas({})
    expect(scaleDeltasForDifficulty(zero, 'gentle')).toEqual(zero)
    expect(scaleDeltasForDifficulty(zero, 'harsh')).toEqual(zero)
  })
})
