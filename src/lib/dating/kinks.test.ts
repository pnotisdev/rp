import { describe, expect, it } from 'vitest'
import { combinedValence, isAnyHardLimit, isHardLimit, kinkResponsiveness, kinkValence, kinkValenceMap } from './kinks'

describe('kinkValence', () => {
  it('reads nothing on record as neutral — neither permission nor refusal', () => {
    expect(kinkValence(undefined, 'bondage')).toBe(0)
    expect(kinkValence({}, 'bondage')).toBe(0)
  })

  it('reads an authored stance', () => {
    expect(kinkValence({ valence: { bondage: 2 } }, 'bondage')).toBe(2)
    expect(kinkValence({ valence: { bondage: -1 } }, 'bondage')).toBe(-1)
  })

  it('treats a listed hard limit as -2 even with no score beside it', () => {
    expect(kinkValence({ hardLimits: ['bondage'] }, 'bondage')).toBe(-2)
    expect(isHardLimit({ hardLimits: ['bondage'] }, 'bondage')).toBe(true)
  })

  it('lets a hard limit override a positive score, rather than the other way round', () => {
    expect(kinkValence({ valence: { bondage: 2 }, hardLimits: ['bondage'] }, 'bondage')).toBe(-2)
  })
})

describe('isAnyHardLimit', () => {
  it('rules out content where any one part is off the table', () => {
    const profile = { hardLimits: ['bondage'] }
    expect(isAnyHardLimit(profile, ['toys', 'bondage'])).toBe(true)
    expect(isAnyHardLimit(profile, ['toys'])).toBe(false)
  })

  it('is false for content with no kinks attached, and for a character with no profile', () => {
    expect(isAnyHardLimit({ hardLimits: ['bondage'] }, [])).toBe(false)
    expect(isAnyHardLimit(undefined, ['bondage'])).toBe(false)
  })
})

describe('combinedValence', () => {
  it('lets a dislike dominate enthusiasm', () => {
    expect(combinedValence({ valence: { toys: 2, rough: -1 } }, ['toys', 'rough'])).toBe(-1)
  })

  it('takes the strongest positive when nothing is disliked', () => {
    expect(combinedValence({ valence: { toys: 1, gentle: 2 } }, ['toys', 'gentle'])).toBe(2)
  })

  it('is neutral for untagged content or an unauthored character', () => {
    expect(combinedValence({ valence: { toys: 2 } }, [])).toBe(0)
    expect(combinedValence(undefined, ['toys'])).toBe(0)
  })
})

describe('kinkResponsiveness', () => {
  it('speeds an eager character up and slows a reluctant one down', () => {
    expect(kinkResponsiveness(2)).toBeGreaterThan(kinkResponsiveness(1))
    expect(kinkResponsiveness(1)).toBeGreaterThan(1)
    expect(kinkResponsiveness(0)).toBe(1)
    expect(kinkResponsiveness(-1)).toBeLessThan(1)
  })
})

describe('kinkValenceMap', () => {
  it('flattens the profile for the stage conditions to read', () => {
    expect(kinkValenceMap({ valence: { toys: 1 }, hardLimits: ['bondage'] })).toEqual({ toys: 1, bondage: -2 })
  })

  it('is undefined for a character with no profile, so conditions read "nothing known"', () => {
    expect(kinkValenceMap(undefined)).toBeUndefined()
  })
})
