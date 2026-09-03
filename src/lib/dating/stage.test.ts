import { describe, expect, it } from 'vitest'
import {
  applyBreakupScar,
  canAskForCommitment,
  combinedSceneFlags,
  commitmentTierThreshold,
  crossedMilestone,
  evaluateRelationshipRisk,
  formatCommitmentStatus,
  nextCommitmentTier,
  relationshipAtRisk,
  unlockedEndingIds,
  warningExpired,
} from '@/lib/dating/stage'
import type { GalleryEntry } from '@/lib/characters/cardSpec'
import type { RelationshipDimension } from '@/lib/types'

const zeroStats = (overrides: Partial<Record<RelationshipDimension, number>> = {}): Record<RelationshipDimension, number> => ({
  trust: 50,
  chemistry: 50,
  comfort: 50,
  respect: 50,
  curiosity: 50,
  tension: 0,
  ...overrides,
})

describe('combinedSceneFlags', () => {
  it('returns just the 4 built-in defaults when no custom flags are given', () => {
    const result = combinedSceneFlags()
    expect(result.map((f) => f.id)).toEqual(['first_date', 'confession', 'jealousy', 'promise'])
    expect(result.find((f) => f.id === 'first_date')?.label).toBe('first date')
  })

  it('appends a world\'s custom flags after the built-in defaults, using their own label', () => {
    const result = combinedSceneFlags([{ id: 'moved-in', label: 'Moved in together', description: 'they now share a home' }])
    expect(result.map((f) => f.id)).toEqual(['first_date', 'confession', 'jealousy', 'promise', 'moved-in'])
    expect(result.find((f) => f.id === 'moved-in')?.label).toBe('Moved in together')
  })

  it('does not mutate the built-in default label formatting for custom flags (no underscore-to-space transform applied)', () => {
    const result = combinedSceneFlags([{ id: 'has_underscore', label: 'has_underscore', description: '' }])
    expect(result.find((f) => f.id === 'has_underscore')?.label).toBe('has_underscore')
  })
})

describe('crossedMilestone', () => {
  it('is true when moving to a higher stage', () => {
    expect(crossedMilestone('near_strangers', 'acquaintances')).toBe(true)
  })

  it('is true when jumping multiple stages at once', () => {
    expect(crossedMilestone('near_strangers', 'sweethearts')).toBe(true)
  })

  it('is false when staying at the same stage', () => {
    expect(crossedMilestone('warming_up', 'warming_up')).toBe(false)
  })

  it('is false when moving to a lower stage', () => {
    expect(crossedMilestone('close', 'getting_close')).toBe(false)
  })

  it('is false dropping all the way back to near_strangers', () => {
    expect(crossedMilestone('sweethearts', 'near_strangers')).toBe(false)
  })
})

const entry = (overrides: Partial<GalleryEntry>): GalleryEntry => ({
  id: 'g1',
  title: 'CG',
  imageUrl: '',
  unlockAffection: 0,
  ...overrides,
})

describe('unlockedEndingIds', () => {
  it('returns nothing below the top stage', () => {
    const gallery = [entry({ id: 'ending1', isEnding: true })]
    expect(unlockedEndingIds(gallery, 'close', new Set())).toEqual([])
  })

  it('returns isEnding entries not already unlocked once at sweethearts', () => {
    const gallery = [
      entry({ id: 'ending1', isEnding: true }),
      entry({ id: 'ending2', isEnding: true }),
      entry({ id: 'cg1' }),
    ]
    expect(unlockedEndingIds(gallery, 'sweethearts', new Set())).toEqual(['ending1', 'ending2'])
  })

  it('skips ids already in the unlocked set', () => {
    const gallery = [entry({ id: 'ending1', isEnding: true }), entry({ id: 'ending2', isEnding: true })]
    expect(unlockedEndingIds(gallery, 'sweethearts', new Set(['ending1']))).toEqual(['ending2'])
  })

  it('ignores non-ending entries entirely', () => {
    const gallery = [entry({ id: 'cg1' }), entry({ id: 'cg2' })]
    expect(unlockedEndingIds(gallery, 'sweethearts', new Set())).toEqual([])
  })

  it('handles an undefined gallery', () => {
    expect(unlockedEndingIds(undefined, 'sweethearts', new Set())).toEqual([])
  })
})

describe('nextCommitmentTier', () => {
  it('steps through the ladder in order', () => {
    expect(nextCommitmentTier('none')).toBe('dating')
    expect(nextCommitmentTier('dating')).toBe('exclusive')
    expect(nextCommitmentTier('exclusive')).toBe('living_together')
  })

  it('is undefined at the top of the ladder', () => {
    expect(nextCommitmentTier('living_together')).toBeUndefined()
  })
})

describe('commitmentTierThreshold', () => {
  it('matches the corresponding RelationshipStage warmth threshold', () => {
    expect(commitmentTierThreshold('dating')).toBe(55) // getting_close
    expect(commitmentTierThreshold('exclusive')).toBe(75) // close
    expect(commitmentTierThreshold('living_together')).toBe(90) // sweethearts
  })

  it('honors custom milestone overrides', () => {
    const custom = [
      { stage: 'near_strangers' as const, at: 0 },
      { stage: 'getting_close' as const, at: 40 },
    ]
    expect(commitmentTierThreshold('dating', custom)).toBe(40)
  })
})

describe('canAskForCommitment', () => {
  it('is false below the threshold and true at/above it', () => {
    expect(canAskForCommitment('dating', 54)).toBe(false)
    expect(canAskForCommitment('dating', 55)).toBe(true)
    expect(canAskForCommitment('dating', 100)).toBe(true)
  })
})

describe('formatCommitmentStatus', () => {
  it('formats every status as readable lowercase text', () => {
    expect(formatCommitmentStatus('none')).toBe('not official')
    expect(formatCommitmentStatus('dating')).toBe('dating')
    expect(formatCommitmentStatus('exclusive')).toBe('exclusive')
    expect(formatCommitmentStatus('living_together')).toBe('living together')
  })
})

describe('relationshipAtRisk', () => {
  it('is never at risk when not committed, however bad the stats', () => {
    expect(relationshipAtRisk('none', zeroStats({ tension: 100, comfort: 0 }))).toBe(false)
  })

  it('is at risk once tension is high enough while committed', () => {
    expect(relationshipAtRisk('dating', zeroStats({ tension: 80 }))).toBe(true)
    expect(relationshipAtRisk('dating', zeroStats({ tension: 79 }))).toBe(false)
  })

  it('is at risk once comfort is low enough while committed', () => {
    expect(relationshipAtRisk('exclusive', zeroStats({ comfort: 15 }))).toBe(true)
    expect(relationshipAtRisk('exclusive', zeroStats({ comfort: 16 }))).toBe(false)
  })

  it('is not at risk while committed with healthy stats', () => {
    expect(relationshipAtRisk('living_together', zeroStats())).toBe(false)
  })
})

describe('warningExpired', () => {
  const DAY_MS = 24 * 60 * 60 * 1000

  it('is false before the grace period elapses', () => {
    const warning = { startedAt: 1000, reason: 'test' }
    expect(warningExpired(warning, 1000 + 2 * DAY_MS)).toBe(false)
  })

  it('is true once the grace period fully elapses', () => {
    const warning = { startedAt: 1000, reason: 'test' }
    expect(warningExpired(warning, 1000 + 3 * DAY_MS)).toBe(true)
  })
})

describe('applyBreakupScar', () => {
  it('reduces trust, comfort, and chemistry, leaving other dimensions untouched', () => {
    const result = applyBreakupScar(zeroStats())
    expect(result.trust).toBe(35)
    expect(result.comfort).toBe(35)
    expect(result.chemistry).toBe(35)
    expect(result.respect).toBe(50)
    expect(result.curiosity).toBe(50)
    expect(result.tension).toBe(0)
  })

  it('floors at 0 rather than going negative', () => {
    const result = applyBreakupScar(zeroStats({ trust: 5 }))
    expect(result.trust).toBe(0)
  })
})

describe('evaluateRelationshipRisk', () => {
  const DAY_MS = 24 * 60 * 60 * 1000

  it('reports no warning and no change when not at risk and never warned', () => {
    const result = evaluateRelationshipRisk({ commitmentStatus: 'dating', stats: zeroStats(), breakupCount: 0 })
    expect(result).toEqual({
      warning: undefined,
      commitmentStatus: 'dating',
      breakupCount: 0,
      brokeUpJustNow: false,
      warnedJustNow: false,
      clearedJustNow: false,
    })
  })

  it('raises a new warning the first time risk is detected', () => {
    const result = evaluateRelationshipRisk({
      commitmentStatus: 'exclusive',
      stats: zeroStats({ tension: 90 }),
      breakupCount: 0,
      now: 5000,
    })
    expect(result.warnedJustNow).toBe(true)
    expect(result.warning).toEqual({ startedAt: 5000, reason: 'tension has been boiling over' })
    expect(result.commitmentStatus).toBe('exclusive')
  })

  it('clears an existing warning once the strain resolves', () => {
    const result = evaluateRelationshipRisk({
      commitmentStatus: 'dating',
      stats: zeroStats(),
      existingWarning: { startedAt: 1000, reason: 'test' },
      breakupCount: 0,
    })
    expect(result.clearedJustNow).toBe(true)
    expect(result.warning).toBeUndefined()
  })

  it('keeps a standing warning in place while still at risk and within the grace period', () => {
    const warning = { startedAt: 1000, reason: 'test' }
    const result = evaluateRelationshipRisk({
      commitmentStatus: 'dating',
      stats: zeroStats({ tension: 90 }),
      existingWarning: warning,
      breakupCount: 0,
      now: 1000 + DAY_MS,
    })
    expect(result.warning).toEqual(warning)
    expect(result.brokeUpJustNow).toBe(false)
    expect(result.commitmentStatus).toBe('dating')
  })

  it('breaks the relationship once a warning runs out still at risk', () => {
    const warning = { startedAt: 1000, reason: 'test' }
    const result = evaluateRelationshipRisk({
      commitmentStatus: 'living_together',
      stats: zeroStats({ tension: 90 }),
      existingWarning: warning,
      breakupCount: 1,
      now: 1000 + 3 * DAY_MS,
    })
    expect(result.brokeUpJustNow).toBe(true)
    expect(result.commitmentStatus).toBe('none')
    expect(result.breakupCount).toBe(2)
    expect(result.warning).toBeUndefined()
  })
})
