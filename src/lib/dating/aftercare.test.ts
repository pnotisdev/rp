import { describe, expect, it } from 'vitest'
import {
  AFTERCARE_VERDICTS,
  AFTERGLOW_TURNS,
  aftercareDeltas,
  aftercareNeed,
  aftercareReason,
  aftercareToast,
  afterglowTurnsSince,
  countCharReplies,
  isAftercareVerdict,
  isAfterglowActive,
  isAfterglowComplete,
  type Afterglow,
} from './aftercare'
import { NEED_VOCAB } from '@/lib/prompt/mindGuidance'

const glow = (startedAtTurn: number, sourceLabel?: string): Afterglow => ({ startedAtTurn, sourceLabel })

describe('countCharReplies', () => {
  it('counts only the character\'s own turns', () => {
    expect(countCharReplies([])).toBe(0)
    expect(
      countCharReplies([{ role: 'user' }, { role: 'char' }, { role: 'user' }, { role: 'char' }, { role: 'user' }]),
    ).toBe(2)
  })
})

describe('afterglowTurnsSince', () => {
  it('is null with no window open', () => {
    expect(afterglowTurnsSince(undefined, 10)).toBeNull()
  })

  it('counts forward from the scene', () => {
    expect(afterglowTurnsSince(glow(4), 4)).toBe(0)
    expect(afterglowTurnsSince(glow(4), 7)).toBe(3)
  })

  it('is null for a window that starts ahead of the conversation', () => {
    // What a rewind or a fork-from-earlier produces. Reading it as "0 turns in" would reopen an
    // aftermath for a scene that no longer exists in this timeline.
    expect(afterglowTurnsSince(glow(9), 4)).toBeNull()
  })
})

describe('isAfterglowActive / isAfterglowComplete', () => {
  it('is active for the length of the window and not after', () => {
    for (let i = 0; i < AFTERGLOW_TURNS; i++) {
      expect(isAfterglowActive(glow(0), i)).toBe(true)
      expect(isAfterglowComplete(glow(0), i)).toBe(false)
    }
    expect(isAfterglowActive(glow(0), AFTERGLOW_TURNS)).toBe(false)
    expect(isAfterglowComplete(glow(0), AFTERGLOW_TURNS)).toBe(true)
  })

  it('stays complete past the boundary, so a window can never be missed', () => {
    // The turn the window closes on can be skipped (relationship tracking is toggleable per chat),
    // so "complete" has to be `>=`, never `===`.
    expect(isAfterglowComplete(glow(0), AFTERGLOW_TURNS + 12)).toBe(true)
  })

  it('is neither active nor complete with no window, or with a stale one', () => {
    expect(isAfterglowActive(undefined, 5)).toBe(false)
    expect(isAfterglowComplete(undefined, 5)).toBe(false)
    expect(isAfterglowActive(glow(20), 5)).toBe(false)
    expect(isAfterglowComplete(glow(20), 5)).toBe(false)
  })
})

describe('aftercareDeltas', () => {
  it('rewards a tender aftermath on the dimensions aftercare is actually about', () => {
    const d = aftercareDeltas('tender')
    expect(d.trust).toBeGreaterThan(0)
    expect(d.comfort).toBeGreaterThan(0)
    expect(d.tension).toBe(0)
  })

  it('makes a cold aftermath hurt, and is the only verdict that adds tension', () => {
    const d = aftercareDeltas('cold')
    expect(d.trust).toBeLessThan(0)
    expect(d.comfort).toBeLessThan(0)
    expect(d.tension).toBeGreaterThan(0)
    expect(aftercareDeltas('tender').tension).toBe(0)
    expect(aftercareDeltas('awkward').tension).toBe(0)
  })

  it('keeps an awkward aftermath close to neutral — fumbling is not a betrayal', () => {
    const d = aftercareDeltas('awkward')
    expect(Object.values(d).every((v) => Math.abs(v) <= 1)).toBe(true)
    expect(d.trust).toBe(0)
  })

  it('sits between a single turn and a whole date in magnitude', () => {
    for (const v of AFTERCARE_VERDICTS) {
      const biggest = Math.max(...Object.values(aftercareDeltas(v)).map(Math.abs))
      expect(biggest).toBeLessThanOrEqual(5) // never louder than a full date outcome
    }
    // ...but a real verdict has to outweigh one ordinary turn (capped at 2), or it says nothing.
    expect(Math.max(...Object.values(aftercareDeltas('cold')).map(Math.abs))).toBeGreaterThan(2)
    expect(Math.max(...Object.values(aftercareDeltas('tender')).map(Math.abs))).toBeGreaterThan(2)
  })

  it('returns a complete delta set, so it can be summed with a turn\'s own deltas', () => {
    for (const v of AFTERCARE_VERDICTS) {
      expect(Object.keys(aftercareDeltas(v)).sort()).toEqual(
        ['affection', 'chemistry', 'comfort', 'curiosity', 'respect', 'tension', 'trust'],
      )
    }
  })

  it('never mutates the shared zero baseline between calls', () => {
    aftercareDeltas('cold').trust = 999
    expect(aftercareDeltas('awkward').trust).toBe(0)
  })
})

describe('isAftercareVerdict', () => {
  it('accepts the vocabulary and rejects everything else', () => {
    for (const v of AFTERCARE_VERDICTS) expect(isAftercareVerdict(v)).toBe(true)
    for (const bad of ['Tender', 'warm', '', null, undefined, 3, {}]) {
      expect(isAftercareVerdict(bad)).toBe(false)
    }
  })
})

describe('aftercareReason / aftercareToast', () => {
  it('gives every verdict a history line', () => {
    for (const v of AFTERCARE_VERDICTS) expect(aftercareReason(v).length).toBeGreaterThan(0)
  })

  it('only interrupts the player for an outcome that actually went somewhere', () => {
    expect(aftercareToast('Sumire', 'awkward')).toBeNull()
    expect(aftercareToast('Sumire', 'tender')).toContain('Sumire')
    expect(aftercareToast('Sumire', 'cold')).toContain('Sumire')
  })
})

describe('aftercareNeed', () => {
  it('leaves a cold aftermath needing reassurance, so it keeps mattering past the window', () => {
    expect(aftercareNeed('cold')).toBe('reassurance')
  })

  it('leaves nothing behind for tender or awkward', () => {
    // "They were looked after" is not an unmet need, and inventing a positive one would put words
    // in the judge's mouth about a character who has nothing to want.
    expect(aftercareNeed('tender')).toBeUndefined()
    expect(aftercareNeed('awkward')).toBeUndefined()
  })

  it('only ever names a need from the shared vocabulary', () => {
    for (const v of AFTERCARE_VERDICTS) {
      const need = aftercareNeed(v)
      if (need) expect(NEED_VOCAB).toContain(need)
    }
  })
})
