import { describe, expect, it } from 'vitest'
import {
  advanceIntimacyScene,
  intimacyAnticipationGuidance,
  intimacyConsentTensionGuidance,
  intimacyPaceFor,
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

  it("item 1: a 'reserved' pace holds a same-turn jump to peak at building for one extra beat", () => {
    const s = scene({ phase: 'building', updatedAtTurn: 10, phaseSinceTurn: 10 })
    const held = advanceIntimacyScene(s, 'peak', 11, 'reserved')
    expect(held?.phase).toBe('building')
    expect(held?.updatedAtTurn).toBe(11)
  })

  it("a 'reserved' pace honors the judge's peak read once enough turns have actually passed", () => {
    const s = scene({ phase: 'building', updatedAtTurn: 10, phaseSinceTurn: 10 })
    const next = advanceIntimacyScene(s, 'peak', 12, 'reserved')
    expect(next?.phase).toBe('peak')
  })

  it("'neutral'/'eager' pace honor a same-turn jump to peak immediately, unaffected by the reserved gate", () => {
    const s = scene({ phase: 'building', updatedAtTurn: 10, phaseSinceTurn: 10 })
    expect(advanceIntimacyScene(s, 'peak', 11, 'neutral')?.phase).toBe('peak')
    expect(advanceIntimacyScene(s, 'peak', 11, 'eager')?.phase).toBe('peak')
  })

  it('falls back to updatedAtTurn for phaseSinceTurn on a scene persisted before that field existed', () => {
    const s: IntimacyScene = { phase: 'building', activityLabel: 'x', category: 'activity', updatedAtTurn: 10 }
    const held = advanceIntimacyScene(s, 'peak', 11, 'reserved')
    expect(held?.phase).toBe('building')
  })

  it('stamps phaseSinceTurn fresh whenever the phase actually changes', () => {
    const s = scene({ phase: 'building', updatedAtTurn: 10, phaseSinceTurn: 10 })
    const next = advanceIntimacyScene(s, 'peak', 15)
    expect(next?.phaseSinceTurn).toBe(15)
  })
})

describe('intimacyPaceFor', () => {
  it("reads 'reserved' from a resistant mood alone", () => {
    expect(intimacyPaceFor('anxious', false, 0)).toBe('reserved')
    expect(intimacyPaceFor('guarded', false, 0)).toBe('reserved')
  })

  it("reads 'reserved' from actively holding back by plan, regardless of mood", () => {
    expect(intimacyPaceFor('excited', true, 0)).toBe('reserved')
  })

  it("reads 'reserved' once authored boundaries clear the floor, regardless of mood", () => {
    expect(intimacyPaceFor('confident', false, 2)).toBe('reserved')
    expect(intimacyPaceFor('confident', false, 1)).not.toBe('reserved')
  })

  it("reads 'eager' only once nothing reserved applies and the mood itself is open", () => {
    expect(intimacyPaceFor('playful', false, 0)).toBe('eager')
    expect(intimacyPaceFor('excited', false, 1)).toBe('eager')
  })

  it("reads 'neutral' for an ordinary mood with nothing pulling either way", () => {
    expect(intimacyPaceFor('content', false, 0)).toBe('neutral')
    expect(intimacyPaceFor(undefined, false, 0)).toBe('neutral')
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

  it("defaults to the plain neutral text with no pace argument", () => {
    expect(intimacySceneGuidance('Sumire', scene())).not.toMatch(/taking longer to build|lean into this more readily/)
  })

  it("adds a 'reserved' clause at building and at peak, distinct from the neutral text", () => {
    const building = intimacySceneGuidance('Sumire', scene({ phase: 'building' }), 'reserved')
    const peak = intimacySceneGuidance('Sumire', scene({ phase: 'peak' }), 'reserved')
    expect(building).toMatch(/taking longer to build/)
    expect(peak).toMatch(/took more for them/)
  })

  it("adds an 'eager' clause only at building, not at peak", () => {
    const building = intimacySceneGuidance('Sumire', scene({ phase: 'building' }), 'eager')
    const peak = intimacySceneGuidance('Sumire', scene({ phase: 'peak' }), 'eager')
    expect(building).toMatch(/lean into this more readily/)
    expect(peak).toBe(intimacySceneGuidance('Sumire', scene({ phase: 'peak' }), 'neutral'))
  })
})

describe('intimacyConsentTensionGuidance', () => {
  it('fires when comfort trails well behind chemistry and comfort itself is still short of comfortable', () => {
    const line = intimacyConsentTensionGuidance('Sumire', 30, 60)!
    expect(line).toContain('Sumire')
    expect(line).toMatch(/comfort.*trailing well behind/i)
    expect(line).toMatch(/hesitation/i)
  })

  it('is undefined once comfort itself is already fairly comfortable, regardless of the gap', () => {
    expect(intimacyConsentTensionGuidance('Sumire', 50, 90)).toBeUndefined()
  })

  it('is undefined when the gap between chemistry and comfort is not actually wide', () => {
    expect(intimacyConsentTensionGuidance('Sumire', 30, 40)).toBeUndefined()
  })
})

describe('intimacyAnticipationGuidance', () => {
  it('fires once both chemistry and comfort are genuinely high with nothing physical started yet', () => {
    const line = intimacyAnticipationGuidance('Sumire', 'Kai', 70, 70)!
    expect(line).toContain('Sumire')
    expect(line).toContain('Kai')
    expect(line).toMatch(/heading toward an intimate turn/i)
  })

  it('is undefined when either chemistry or comfort falls short of the floor', () => {
    expect(intimacyAnticipationGuidance('Sumire', 'Kai', 40, 70)).toBeUndefined()
    expect(intimacyAnticipationGuidance('Sumire', 'Kai', 70, 40)).toBeUndefined()
  })
})
