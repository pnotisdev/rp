import { describe, expect, it } from 'vitest'
import { describeMomentum, nextMomentum, relationshipPacingNote, warmthDeltaOf } from './momentum'

describe('warmthDeltaOf', () => {
  it('averages the warmth-relevant deltas and ignores tension / curiosity', () => {
    // affection + trust + chemistry + comfort + respect = 5, over 5 keys = 1
    expect(warmthDeltaOf({ affection: 2, trust: 1, chemistry: 1, comfort: 1, respect: 0, tension: 2, curiosity: 2 })).toBe(1)
  })

  it('is 0 for a flat turn', () => {
    expect(warmthDeltaOf({})).toBe(0)
  })

  it('goes negative when warmth dropped', () => {
    expect(warmthDeltaOf({ affection: -2, comfort: -1, trust: -2 })).toBeCloseTo(-1)
  })
})

describe('nextMomentum', () => {
  it('decays the previous value and adds this turn', () => {
    expect(nextMomentum(4, 0.5)).toBeCloseTo(4 * 0.65 + 0.5) // 3.1
  })

  it('a burst fades toward zero over a handful of quiet turns', () => {
    let m = nextMomentum(0, 1) // a big +1 warmth turn
    m = nextMomentum(m, 1)
    m = nextMomentum(m, 1)
    const peak = m
    for (let i = 0; i < 6; i++) m = nextMomentum(m, 0)
    expect(peak).toBeGreaterThan(2)
    expect(Math.abs(m)).toBeLessThan(0.3)
  })

  it('clamps to a sane band', () => {
    let m = 0
    for (let i = 0; i < 50; i++) m = nextMomentum(m, 5)
    expect(m).toBeLessThanOrEqual(8)
  })

  it('treats undefined previous as 0', () => {
    expect(nextMomentum(undefined, 0.4)).toBe(0.4)
  })
})

describe('relationshipPacingNote', () => {
  it('flags fast movement as something to let settle, not an invitation', () => {
    const note = relationshipPacingNote('Sumire', 70, 2.5, 10)!
    expect(note).toMatch(/moved fast/i)
    expect(note).toMatch(/not a standing invitation/i)
  })

  it('flags a recent cooldown as the more current read', () => {
    expect(relationshipPacingNote('Sumire', 80, -2, 10)!).toMatch(/cooled|guarded/i)
  })

  it('names friction-alongside-warmth and blocks points-buy receptiveness', () => {
    const note = relationshipPacingNote('Sumire', 70, 0, 60)!
    expect(note).toMatch(/friction/i)
    expect(note).toMatch(/more romantically receptive/i)
  })

  it('reassures that a settled stretch does not need a manufactured development', () => {
    expect(relationshipPacingNote('Sumire', 65, 0.2, 10)!).toMatch(/steady and comfortable|manufacture/i)
  })

  it('says nothing for a quiet early-stage relationship', () => {
    expect(relationshipPacingNote('Sumire', 20, 0, 5)).toBeUndefined()
  })
})

describe('describeMomentum', () => {
  it('labels the notable bands and stays quiet in the middle', () => {
    expect(describeMomentum(2.5)).toBe('deepening fast')
    expect(describeMomentum(1)).toBe('warming')
    expect(describeMomentum(-2)).toBe('cooling off')
    expect(describeMomentum(0.1)).toBeUndefined()
    expect(describeMomentum(undefined)).toBeUndefined()
  })
})
