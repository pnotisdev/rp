import { describe, expect, it } from 'vitest'
import {
  advanceIntimacyScene,
  intimacySceneGuidance,
  isIntimacySceneActive,
  isIntimacySceneStale,
  startOrShiftIntimacyScene,
  type IntimacyScene,
} from './intimacyScene'

const scene = (overrides: Partial<IntimacyScene> = {}): IntimacyScene => ({
  phase: 'building',
  activityLabel: 'spooning: you at Sumire\'s back, both on your sides',
  category: 'position',
  updatedAtTurn: 10,
  ...overrides,
})

describe('startOrShiftIntimacyScene', () => {
  it('always starts (or re-centers) at building, never peak', () => {
    const s = startOrShiftIntimacyScene('using a vibrator on {char}', 'toy', 5)
    expect(s.phase).toBe('building')
    expect(s.activityLabel).toBe('using a vibrator on {char}')
    expect(s.category).toBe('toy')
    expect(s.updatedAtTurn).toBe(5)
  })

  it('re-centering mid-scene resets phase back to building rather than inheriting peak', () => {
    const shifted = startOrShiftIntimacyScene('a new activity', 'activity', 12)
    expect(shifted.phase).toBe('building')
  })
})

describe('isIntimacySceneStale / isIntimacySceneActive', () => {
  it('is not stale/active with nothing on record', () => {
    expect(isIntimacySceneStale(undefined, 20)).toBe(false)
    expect(isIntimacySceneActive(undefined, 20)).toBe(false)
    expect(isIntimacySceneActive(null, 20)).toBe(false)
  })

  it('is active for an ordinary in-progress scene', () => {
    expect(isIntimacySceneActive(scene({ updatedAtTurn: 10 }), 12)).toBe(true)
  })

  it('is stale once its own marker is ahead of the conversation (rewind/fork)', () => {
    const s = scene({ updatedAtTurn: 20 })
    expect(isIntimacySceneStale(s, 12)).toBe(true)
    expect(isIntimacySceneActive(s, 12)).toBe(false)
  })
})

describe('advanceIntimacyScene', () => {
  it('resolves to null once the judge reads the scene as concluded', () => {
    expect(advanceIntimacyScene(scene(), 'resolved', 15)).toBeNull()
  })

  it('holds the current phase on an unreadable turn rather than resetting it', () => {
    const next = advanceIntimacyScene(scene({ phase: 'peak' }), undefined, 15)
    expect(next?.phase).toBe('peak')
    expect(next?.updatedAtTurn).toBe(15)
  })

  it('advances from building to peak when the judge reads it that way', () => {
    const next = advanceIntimacyScene(scene({ phase: 'building' }), 'peak', 15)
    expect(next?.phase).toBe('peak')
  })

  it('carries the activity label and category forward unchanged across a phase move', () => {
    const s = scene({ activityLabel: 'against the wall', category: 'position' })
    const next = advanceIntimacyScene(s, 'peak', 15)
    expect(next?.activityLabel).toBe('against the wall')
    expect(next?.category).toBe('position')
  })
})

describe('intimacySceneGuidance', () => {
  it('names the character and the currently-live activity for continuity', () => {
    const line = intimacySceneGuidance('Sumire', scene())
    expect(line).toContain('Sumire')
    expect(line).toContain(scene().activityLabel)
    expect(line).toMatch(/stay continuous/i)
  })

  it('reads differently for building vs peak', () => {
    const building = intimacySceneGuidance('Sumire', scene({ phase: 'building' }))
    const peak = intimacySceneGuidance('Sumire', scene({ phase: 'peak' }))
    expect(building).not.toBe(peak)
    expect(building).toMatch(/still building/i)
    expect(peak).toMatch(/peak/i)
  })

  it('never emits a {{char}}/{{user}} macro — styleGuidance strings are not macro-substituted', () => {
    expect(intimacySceneGuidance('Sumire', scene())).not.toContain('{{')
  })
})
