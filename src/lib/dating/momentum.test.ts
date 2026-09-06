import { describe, expect, it } from 'vitest'
import {
  asymmetricPacingNote,
  describeInitiativeBalance,
  describeMomentum,
  initiativeContribution,
  nextInitiativeBalance,
  nextMomentum,
  relationshipPacingNote,
  warmthDeltaOf,
} from './momentum'

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

describe('initiativeContribution', () => {
  it('a tagged overture that moved nothing counts as the player carrying it', () => {
    expect(initiativeContribution(true, 0)).toBe(1)
    expect(initiativeContribution(true, -0.4)).toBe(1)
  })

  it('a tagged overture that landed reads as reciprocated, not lopsided', () => {
    expect(initiativeContribution(true, 1)).toBe(0)
  })

  it('unprompted warmth movement counts as the character carrying it', () => {
    expect(initiativeContribution(false, 0.6)).toBe(-1)
  })

  it('a flat, untagged turn contributes nothing either way', () => {
    expect(initiativeContribution(false, 0)).toBe(0)
    expect(initiativeContribution(false, -1)).toBe(0)
  })
})

describe('nextInitiativeBalance', () => {
  it('decays the previous value and adds this turn, same shape as nextMomentum', () => {
    expect(nextInitiativeBalance(3, 1)).toBeCloseTo(3 * 0.65 + 1)
  })

  it('treats undefined previous as 0', () => {
    expect(nextInitiativeBalance(undefined, 1)).toBe(1)
  })

  it('clamps to a sane band in both directions', () => {
    let up = 0
    let down = 0
    for (let i = 0; i < 50; i++) {
      up = nextInitiativeBalance(up, 1)
      down = nextInitiativeBalance(down, -1)
    }
    expect(up).toBeLessThanOrEqual(6)
    expect(down).toBeGreaterThanOrEqual(-6)
  })
})

describe('asymmetricPacingNote', () => {
  it('names the player carrying it once the imbalance is real and sustained', () => {
    const note = asymmetricPacingNote('Sumire', 3)!
    expect(note).toContain('Sumire')
    expect(note).toMatch(/more reserved/i)
    expect(note).toContain('{{user}}')
  })

  it('names the character carrying it the other direction', () => {
    const note = asymmetricPacingNote('Sumire', -3)!
    expect(note).toMatch(/closing the distance/i)
    expect(note).toContain('Sumire')
  })

  it('says nothing for an ordinary, small imbalance', () => {
    expect(asymmetricPacingNote('Sumire', 0.5)).toBeUndefined()
    expect(asymmetricPacingNote('Sumire', -1)).toBeUndefined()
  })
})

describe('describeInitiativeBalance', () => {
  it('labels the notable bands and stays quiet in the middle', () => {
    expect(describeInitiativeBalance(3)).toMatch(/you/i)
    expect(describeInitiativeBalance(-3)).toMatch(/they/i)
    expect(describeInitiativeBalance(0.5)).toBeUndefined()
    expect(describeInitiativeBalance(undefined)).toBeUndefined()
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
