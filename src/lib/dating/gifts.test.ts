import { describe, expect, it } from 'vitest'
import {
  appendGiftLog,
  defaultGiftInventory,
  DEFAULT_GIFT_CATALOG,
  GIFT_LOG_CAP,
  giftById,
  giftImpactBase,
  giftMismatchPenalty,
  giftReactionGuidance,
  giftRepetitionMultiplier,
  trailingSameGiftRun,
  type GiftLogEntry,
} from './gifts'

describe('appendGiftLog', () => {
  it('appends an entry and keeps the newest ones once past the cap', () => {
    let log: GiftLogEntry[] | undefined
    for (let i = 0; i < GIFT_LOG_CAP + 3; i++) log = appendGiftLog(log, `gift-${i}`, i)
    expect(log!.length).toBe(GIFT_LOG_CAP)
    expect(log![0].giftId).toBe(`gift-3`)
    expect(log![log!.length - 1].giftId).toBe(`gift-${GIFT_LOG_CAP + 2}`)
  })

  it('starts a fresh log from undefined', () => {
    expect(appendGiftLog(undefined, 'flower-bouquet', 1)).toEqual([{ giftId: 'flower-bouquet', turn: 1 }])
  })
})

describe('trailingSameGiftRun', () => {
  it('is 0 with no log or a log ending in a different gift', () => {
    expect(trailingSameGiftRun(undefined, 'flower-bouquet')).toBe(0)
    expect(trailingSameGiftRun([{ giftId: 'a', turn: 1 }], 'flower-bouquet')).toBe(0)
  })

  it('counts a trailing run of the exact same gift', () => {
    const log = [
      { giftId: 'flower-bouquet', turn: 1 },
      { giftId: 'flower-bouquet', turn: 2 },
      { giftId: 'flower-bouquet', turn: 3 },
    ]
    expect(trailingSameGiftRun(log, 'flower-bouquet')).toBe(3)
  })

  it('stops counting once a different gift breaks the streak', () => {
    const log = [
      { giftId: 'flower-bouquet', turn: 1 },
      { giftId: 'favorite-novel', turn: 2 },
      { giftId: 'flower-bouquet', turn: 3 },
      { giftId: 'flower-bouquet', turn: 4 },
    ]
    expect(trailingSameGiftRun(log, 'flower-bouquet')).toBe(2)
  })
})

describe('giftRepetitionMultiplier', () => {
  it('is full weight the first time', () => {
    expect(giftRepetitionMultiplier(0)).toBe(1)
  })

  it('softens progressively as the run grows, never hitting exactly zero', () => {
    const m1 = giftRepetitionMultiplier(1)
    const m2 = giftRepetitionMultiplier(2)
    const m3 = giftRepetitionMultiplier(5)
    expect(m1).toBeLessThan(1)
    expect(m2).toBeLessThan(m1)
    expect(m3).toBeLessThan(m2)
    expect(m3).toBeGreaterThan(0)
  })
})

describe('giftMismatchPenalty', () => {
  it('is 0 for a neutral or liked gift regardless of repetition', () => {
    expect(giftMismatchPenalty(0, 3)).toBe(0)
    expect(giftMismatchPenalty(2, 3)).toBe(0)
  })

  it('is 0 the first time a disliked gift is given', () => {
    expect(giftMismatchPenalty(-1, 0)).toBe(0)
  })

  it('applies a real extra cost once a disliked gift repeats', () => {
    expect(giftMismatchPenalty(-1, 1)).toBe(-1)
    expect(giftMismatchPenalty(-2, 4)).toBe(-1)
  })
})

describe('giftReactionGuidance', () => {
  it('is undefined for an ordinary first-time, well-matched gift', () => {
    expect(giftReactionGuidance('Sumire', 'Kai', 'a flower bouquet', 0, false, 0)).toBeUndefined()
  })

  it('flags a mismatch that has happened before as a real, not performed, reaction', () => {
    const line = giftReactionGuidance('Sumire', 'Kai', 'a flower bouquet', 0, true, 2)!
    expect(line).toContain('Sumire')
    expect(line).toContain('Kai')
    expect(line).toMatch(/never really landed/i)
  })

  it('does not flag a mismatch the very first time it happens', () => {
    expect(giftReactionGuidance('Sumire', 'Kai', 'a flower bouquet', 0, true, 0)).toBeUndefined()
  })

  it('reads sweet-but-noticing on the second time in a row', () => {
    const line = giftReactionGuidance('Sumire', 'Kai', 'a flower bouquet', 1, false, 1)!
    expect(line).toMatch(/still sweet/i)
  })

  it('reads hollow/repetitive by the third-plus time in a row', () => {
    const line = giftReactionGuidance('Sumire', 'Kai', 'a flower bouquet', 3, false, 3)!
    expect(line).toMatch(/hollow|repetitive/i)
  })

  it('never emits a {{char}}/{{user}} macro — styleGuidance strings are not macro-substituted', () => {
    expect(giftReactionGuidance('Sumire', 'Kai', 'a flower bouquet', 2, false, 2)).not.toContain('{{')
  })
})

// Sanity check that nothing above broke the pre-existing exports this file already had.
describe('pre-existing gift catalog exports still work', () => {
  it('resolves a built-in gift and its impact base', () => {
    const gift = giftById('flower-bouquet')
    expect(gift?.name).toBe('Flower Bouquet')
    expect(giftImpactBase('flower-bouquet')).toBeGreaterThan(0)
  })

  it('builds a starter inventory from the default catalog', () => {
    const inv = defaultGiftInventory()
    expect(Object.keys(inv).length).toBe(2)
    expect(DEFAULT_GIFT_CATALOG.length).toBeGreaterThan(0)
  })
})
