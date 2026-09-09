import { describe, expect, it } from 'vitest'
import {
  advanceArousal,
  arousalBandFor,
  BAND_FLOORS,
  DEFAULT_REGION_SENSITIVITY,
  emptyArousalState,
  habituatedRegion,
  habituationFactor,
  isConsentTension,
  regionLabel,
  responsivenessFor,
  type ArousalState,
} from './arousal'
import type { IntimacyTurnObservation } from './intimacyScene'

const obs = (overrides: Partial<IntimacyTurnObservation> = {}): IntimacyTurnObservation => ({
  engagement: 'engaged',
  intensityDelta: 0,
  hesitationSignalled: false,
  stageCompleteSignalled: false,
  regionsTouched: [],
  clothingRemoved: [],
  ...overrides,
})

const state = (overrides: Partial<ArousalState> = {}): ArousalState => ({
  value: 0,
  regionExposure: {},
  bandSinceTurn: 10,
  ...overrides,
})

describe('arousalBandFor', () => {
  it('reads each band off its own floor', () => {
    expect(arousalBandFor(0)).toBe('baseline')
    expect(arousalBandFor(19)).toBe('baseline')
    expect(arousalBandFor(20)).toBe('warming')
    expect(arousalBandFor(45)).toBe('engaged')
    expect(arousalBandFor(77)).toBe('engaged')
    expect(arousalBandFor(78)).toBe('edge')
    expect(arousalBandFor(100)).toBe('over')
  })
})

describe('habituationFactor', () => {
  it('gives a first touch full value and halves off from there', () => {
    expect(habituationFactor(1)).toBe(1)
    expect(habituationFactor(2)).toBeCloseTo(0.714, 3)
    expect(habituationFactor(4)).toBeCloseTo(0.455, 3)
  })

  it('never returns more than full value for a nonsensical count', () => {
    expect(habituationFactor(0)).toBe(1)
  })
})

describe('responsivenessFor', () => {
  it('is 1 for a neutral character with no stats to go on', () => {
    expect(responsivenessFor({})).toBe(1)
  })

  it('scales with pace — the reserved damper that replaced the old min-turns clamp', () => {
    expect(responsivenessFor({ pace: 'reserved' })).toBeLessThan(1)
    expect(responsivenessFor({ pace: 'eager' })).toBeGreaterThan(1)
  })

  it('rises with chemistry, so two characters at the same point move at different speeds', () => {
    expect(responsivenessFor({ chemistry: 90 })).toBeGreaterThan(responsivenessFor({ chemistry: 10 }))
  })

  it('damps hard when comfort trails chemistry, rather than only nudging the prose', () => {
    const tense = responsivenessFor({ chemistry: 80, comfort: 20 })
    const easy = responsivenessFor({ chemistry: 80, comfort: 70 })
    expect(tense).toBeLessThan(easy)
  })
})

describe('isConsentTension', () => {
  it('needs both a low comfort and a real gap behind chemistry', () => {
    expect(isConsentTension(20, 80)).toBe(true)
    expect(isConsentTension(70, 95)).toBe(false)
    expect(isConsentTension(40, 50)).toBe(false)
  })

  it('is false when either stat is unknown, rather than guessing', () => {
    expect(isConsentTension(undefined, 80)).toBe(false)
    expect(isConsentTension(20, undefined)).toBe(false)
  })
})

describe('advanceArousal', () => {
  it('climbs from the activity weight, the passive drift, and the decay', () => {
    // (8 * 1 + 0 touch + 2 drift) * 1 - 1.5 decay
    expect(advanceArousal(state(), obs({ intensityDelta: 1 }), { activityWeight: 8 }, 11).value).toBe(9)
  })

  it('pays out more for a large escalation than an ordinary one, and nothing for a pullback', () => {
    const big = advanceArousal(state(), obs({ intensityDelta: 2 }), { activityWeight: 8 }, 11).value
    const ordinary = advanceArousal(state(), obs({ intensityDelta: 1 }), { activityWeight: 8 }, 11).value
    const pullback = advanceArousal(state({ value: 50 }), obs({ intensityDelta: -1 }), { activityWeight: 8 }, 11).value
    expect(big).toBeGreaterThan(ordinary)
    expect(pullback).toBeLessThan(50)
  })

  it('pays out nothing at all for a turn that stalled or drifted, and takes a real drop', () => {
    const stalled = advanceArousal(state({ value: 50 }), obs({ engagement: 'stalled', intensityDelta: 2 }), { activityWeight: 8 }, 11)
    const drifted = advanceArousal(state({ value: 50 }), obs({ engagement: 'drifted', intensityDelta: 2 }), { activityWeight: 8 }, 11)
    expect(stalled.value).toBe(43)
    expect(drifted.value).toBe(39)
  })

  it('scores a touch by the region, so the same turn on a different spot is worth different amounts', () => {
    const sensitive = advanceArousal(state(), obs({ regionsTouched: ['genitals'] }), {}, 11).value
    const not = advanceArousal(state(), obs({ regionsTouched: ['hands'] }), {}, 11).value
    expect(sensitive).toBeGreaterThan(not)
  })

  it('honours a per-character sensitivity override, including one that zeroes a region out', () => {
    const base = advanceArousal(state(), obs({ regionsTouched: ['neck'] }), {}, 11).value
    const loves = advanceArousal(state(), obs({ regionsTouched: ['neck'] }), { sensitivity: { neck: 3 } }, 11).value
    const nothing = advanceArousal(state(), obs({ regionsTouched: ['neck'] }), { sensitivity: { neck: 0 } }, 11).value
    expect(loves).toBeGreaterThan(base)
    expect(nothing).toBeLessThan(base)
  })

  it('habituates: the same region gives back less each time it is returned to', () => {
    let s = state({ value: 40 })
    const gains: number[] = []
    for (let turn = 11; turn < 15; turn++) {
      const next = advanceArousal(s, obs({ regionsTouched: ['neck'] }), {}, turn)
      gains.push(next.value - s.value)
      s = next
    }
    // Never rises, and is meaningfully smaller by the fourth return than it was the first time.
    expect(gains.every((g, i) => i === 0 || g <= gains[i - 1])).toBe(true)
    expect(gains[3]).toBeLessThan(gains[0])
  })

  it('counts every observed touch toward exposure, engaged turn or not', () => {
    const first = advanceArousal(state(), obs({ regionsTouched: ['neck', 'hips'] }), {}, 11)
    const second = advanceArousal(first, obs({ engagement: 'stalled', regionsTouched: ['neck'] }), {}, 12)
    expect(second.regionExposure).toEqual({ neck: 2, hips: 1 })
  })

  it('costs more for a hesitation when comfort is trailing chemistry than when it is not', () => {
    const tense = advanceArousal(state({ value: 60 }), obs({ hesitationSignalled: true }), { chemistry: 80, comfort: 20 }, 11)
    const easy = advanceArousal(state({ value: 60 }), obs({ hesitationSignalled: true }), { chemistry: 80, comfort: 70 }, 11)
    expect(tense.value).toBeLessThan(easy.value)
  })

  it('stays inside 0-100 at both ends', () => {
    expect(advanceArousal(state({ value: 2 }), obs({ engagement: 'drifted' }), {}, 11).value).toBe(0)
    expect(advanceArousal(state({ value: 99 }), obs({ intensityDelta: 2 }), { activityWeight: 8 }, 11).value).toBe(BAND_FLOORS.over)
  })

  it('stamps bandSinceTurn only when the band actually changes', () => {
    const held = advanceArousal(state({ value: 50, bandSinceTurn: 3 }), obs({ intensityDelta: 1 }), { activityWeight: 2 }, 11)
    expect(arousalBandFor(held.value)).toBe('engaged')
    expect(held.bandSinceTurn).toBe(3)
    const crossed = advanceArousal(state({ value: 74, bandSinceTurn: 3 }), obs({ intensityDelta: 2 }), { activityWeight: 8 }, 11)
    expect(arousalBandFor(crossed.value)).toBe('edge')
    expect(crossed.bandSinceTurn).toBe(11)
  })

  it('takes a reserved character up more slowly than an eager one on the identical turn', () => {
    const turn = obs({ intensityDelta: 1, regionsTouched: ['neck'] })
    const reserved = advanceArousal(state(), turn, { pace: 'reserved', activityWeight: 8 }, 11).value
    const eager = advanceArousal(state(), turn, { pace: 'eager', activityWeight: 8 }, 11).value
    expect(reserved).toBeLessThan(eager)
  })

  it('reaches the edge in a handful of committed turns, not one and not twenty', () => {
    let s = emptyArousalState(10)
    let turns = 0
    while (arousalBandFor(s.value) !== 'edge' && turns < 30) {
      turns++
      s = advanceArousal(s, obs({ intensityDelta: 1, regionsTouched: ['genitals'] }), { activityWeight: 8 }, 10 + turns)
    }
    expect(turns).toBeGreaterThan(3)
    expect(turns).toBeLessThan(12)
  })
})

describe('habituatedRegion', () => {
  it('names nothing until a region has genuinely been worn out', () => {
    expect(habituatedRegion(state({ regionExposure: { neck: 3 } }))).toBeUndefined()
    expect(habituatedRegion(undefined)).toBeUndefined()
  })

  it('names the most-touched region once one crosses the line', () => {
    expect(habituatedRegion(state({ regionExposure: { neck: 4, hips: 6 } }))).toBe('hips')
  })
})

describe('regionLabel', () => {
  it('reads as prose rather than an enum member', () => {
    expect(regionLabel('inner_thigh')).toBe('inner thigh')
    expect(regionLabel('neck')).toBe('neck')
  })
})

describe('DEFAULT_REGION_SENSITIVITY', () => {
  it('covers every region, so an unauthored character never has a dead spot by accident', () => {
    expect(Object.values(DEFAULT_REGION_SENSITIVITY).every((v) => v > 0)).toBe(true)
  })
})
