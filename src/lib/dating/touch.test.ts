import { describe, expect, it } from 'vitest'
import { isRegionAvailable, newlyDiscoveredRegions, sensitivityFor, unavailableRegions, withDiscoveredRegions } from './touch'
import { DEFAULT_REGION_SENSITIVITY } from './arousal'

describe('sensitivityFor', () => {
  it('falls back to the shared default map for an unauthored character', () => {
    expect(sensitivityFor(undefined, 'neck')).toBe(DEFAULT_REGION_SENSITIVITY.neck)
    expect(sensitivityFor({}, 'neck')).toBe(DEFAULT_REGION_SENSITIVITY.neck)
  })

  it('honours an authored override, including one that zeroes a region out', () => {
    expect(sensitivityFor({ sensitivity: { neck: 3 } }, 'neck')).toBe(3)
    expect(sensitivityFor({ sensitivity: { neck: 0 } }, 'neck')).toBe(0)
  })

  it('leaves the regions an author did not mention at their defaults', () => {
    expect(sensitivityFor({ sensitivity: { neck: 3 } }, 'hips')).toBe(DEFAULT_REGION_SENSITIVITY.hips)
  })
})

describe('isRegionAvailable', () => {
  it('is true for everything when nothing has been authored', () => {
    expect(isRegionAvailable(undefined, 'genitals', 0)).toBe(true)
  })

  it('refuses an off-limits region at any warmth', () => {
    const profile = { offLimits: ['feet' as const] }
    expect(isRegionAvailable(profile, 'feet', 0)).toBe(false)
    expect(isRegionAvailable(profile, 'feet', 100)).toBe(false)
  })

  it('opens a gated region only past its threshold', () => {
    const profile = { gated: { genitals: 60 } }
    expect(isRegionAvailable(profile, 'genitals', 59)).toBe(false)
    expect(isRegionAvailable(profile, 'genitals', 60)).toBe(true)
  })

  it('lets an off-limits entry win over a gate on the same region', () => {
    expect(isRegionAvailable({ offLimits: ['neck'], gated: { neck: 10 } }, 'neck', 100)).toBe(false)
  })
})

describe('unavailableRegions', () => {
  it('lists what is closed off right now, and nothing once the gates are cleared', () => {
    const profile = { offLimits: ['feet' as const], gated: { genitals: 60 } }
    expect(unavailableRegions(profile, 10).sort()).toEqual(['feet', 'genitals'])
    expect(unavailableRegions(profile, 80)).toEqual(['feet'])
    expect(unavailableRegions(undefined, 0)).toEqual([])
  })
})

describe('newlyDiscoveredRegions', () => {
  it('only counts regions this character genuinely responds to', () => {
    // `hands` is a 1 by default, `neck` a 2 — only the second is worth learning.
    expect(newlyDiscoveredRegions(undefined, ['neck', 'hands'], [])).toEqual(['neck'])
  })

  it('reads responsiveness from the authored profile, not the default map', () => {
    expect(newlyDiscoveredRegions({ sensitivity: { hands: 3 } }, ['hands'], [])).toEqual(['hands'])
    expect(newlyDiscoveredRegions({ sensitivity: { neck: 0 } }, ['neck'], [])).toEqual([])
  })

  it('never re-discovers something already known, or repeats within one turn', () => {
    expect(newlyDiscoveredRegions(undefined, ['neck'], ['neck'])).toEqual([])
    expect(newlyDiscoveredRegions(undefined, ['neck', 'neck'], undefined)).toEqual(['neck'])
  })
})

describe('withDiscoveredRegions', () => {
  it('appends what was found', () => {
    expect(withDiscoveredRegions(['neck'], ['ears'])).toEqual(['neck', 'ears'])
    expect(withDiscoveredRegions(undefined, ['ears'])).toEqual(['ears'])
  })

  it('returns the list untouched when nothing was found, so a flat turn writes nothing', () => {
    const known = ['neck' as const]
    expect(withDiscoveredRegions(known, [])).toBe(known)
    expect(withDiscoveredRegions(undefined, [])).toBeUndefined()
  })
})
