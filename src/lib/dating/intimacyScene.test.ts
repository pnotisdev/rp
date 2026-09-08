import { describe, expect, it } from 'vitest'
import {
  advanceIntimacyScene,
  appendSceneShapeLog,
  detectExplicitAntiPatternUsed,
  explicitAftercareGuidance,
  explicitSceneGuidance,
  intimacyAnticipationGuidance,
  intimacyConsentTensionGuidance,
  intimacyPaceFor,
  intimacySceneGuidance,
  isIntimacySceneActive,
  isIntimacySceneStale,
  repeatedEscalationShapeGuidance,
  SCENE_SHAPE_LOG_CAP,
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

  // Item 12's escalation-shape memory: `categoryHistory` is the running record `RelationshipTrack
  // .intimacySceneShapeLog` gets built from once the scene resolves.
  it('starts a fresh single-entry categoryHistory when nothing was live before', () => {
    const s = startOrShiftIntimacyScene('a kiss', 'kissing_spot', 5)
    expect(s.categoryHistory).toEqual(['kissing_spot'])
  })

  it('appends onto the prior live scene\'s categoryHistory when re-centering, rather than resetting it', () => {
    const first = startOrShiftIntimacyScene('a kiss', 'kissing_spot', 5)
    const second = startOrShiftIntimacyScene('a position', 'position', 6, first)
    expect(second.categoryHistory).toEqual(['kissing_spot', 'position'])
  })

  it("builds a starting history from the prior scene's own category when it predates categoryHistory existing", () => {
    const priorWithoutHistory = scene({ category: 'toy', categoryHistory: undefined })
    const shifted = startOrShiftIntimacyScene('an activity', 'activity', 8, priorWithoutHistory)
    expect(shifted.categoryHistory).toEqual(['toy', 'activity'])
  })

  it('never carries a stale/inactive prior scene\'s history forward when the caller passes none', () => {
    // The caller's own job (see the function's doc comment) — passing `undefined` for an inactive
    // prior scene, exactly as if none had ever existed.
    const s = startOrShiftIntimacyScene('a fresh start', 'position', 20, undefined)
    expect(s.categoryHistory).toEqual(['position'])
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

  it('nudges variety once peak has held for a few turns running, not on a fresh peak', () => {
    const freshPeak = intimacySceneGuidance('Sumire', scene({ phase: 'peak', updatedAtTurn: 10, phaseSinceTurn: 10 }))
    const heldPeak = intimacySceneGuidance('Sumire', scene({ phase: 'peak', updatedAtTurn: 13, phaseSinceTurn: 10 }))
    expect(freshPeak).not.toMatch(/held at its peak/)
    expect(heldPeak).toMatch(/held at its peak/)
  })

  it('never nudges variety while still building, regardless of how long it has held', () => {
    const heldBuilding = intimacySceneGuidance('Sumire', scene({ phase: 'building', updatedAtTurn: 20, phaseSinceTurn: 10 }))
    expect(heldBuilding).not.toMatch(/held at its peak/)
  })
})

describe('explicitSceneGuidance', () => {
  it('names both characters and never emits a macro (styleGuidance is never macro-substituted)', () => {
    const line = explicitSceneGuidance('Sumire', 'Kai', 'peak')
    expect(line).toContain('Sumire')
    expect(line).toContain('Kai')
    expect(line).not.toContain('{{')
  })

  it('reads differently for building vs peak', () => {
    const building = explicitSceneGuidance('Sumire', 'Kai', 'building')
    const peak = explicitSceneGuidance('Sumire', 'Kai', 'peak')
    expect(building).not.toBe(peak)
  })

  it('names every anti-pattern phrase, so the model has something concrete to avoid', () => {
    const line = explicitSceneGuidance('Sumire', 'Kai', 'peak')
    for (const phrase of [
      'waves of pleasure',
      'lost in the sensation',
      'their bodies became one',
      'ecstasy',
      'rapture',
      'bliss',
      'ministrations',
      'he entered her',
      'she took him in',
      'he filled her',
    ]) {
      expect(line).toContain(phrase)
    }
  })

  it('only sequences pre/during/after-climax physical detail at peak, not while still building', () => {
    const building = explicitSceneGuidance('Sumire', 'Kai', 'building').toLowerCase()
    const peak = explicitSceneGuidance('Sumire', 'Kai', 'peak').toLowerCase()
    expect(peak).toMatch(/clamping|pulsing/)
    expect(peak).toMatch(/oversensitive|twitching/)
    expect(building).not.toMatch(/clamping|pulsing/)
  })

  it('reinforces character-specific voice under strain, not a generic register swap', () => {
    const line = explicitSceneGuidance('Sumire', 'Kai', 'peak')
    expect(line).toMatch(/voice doesn't reset/i)
  })

  it('no longer carries its own POV guard — that is `agencyGuardNote`\'s single canonical job now', () => {
    const line = explicitSceneGuidance('Sumire', 'Kai', 'peak')
    expect(line.toLowerCase()).not.toMatch(/only kai's own actions belong to kai/)
  })

  it('includes the newer anti-patterns too', () => {
    const line = explicitSceneGuidance('Sumire', 'Kai', 'peak')
    expect(line).toContain('buried himself')
    expect(line).toContain('moaned in pleasure')
  })

  it('requires the edge signs to show before climax is named, and allows intensity to vary at peak', () => {
    const line = explicitSceneGuidance('Sumire', 'Kai', 'peak').toLowerCase()
    expect(line).toMatch(/rhythm that keeps breaking/)
    expect(line).toMatch(/before anything is named as climax/)
    expect(line).toMatch(/doesn't have to sit at maximum/)
  })

  it('covers focused touch (breasts/nipples) beyond penetration, only at peak', () => {
    const building = explicitSceneGuidance('Sumire', 'Kai', 'building').toLowerCase()
    const peak = explicitSceneGuidance('Sumire', 'Kai', 'peak').toLowerCase()
    expect(peak).toMatch(/breasts, nipples/)
    expect(building).not.toMatch(/breasts, nipples/)
  })

  it("keeps dirty talk/vocalization tied to the character's own register", () => {
    const line = explicitSceneGuidance('Sumire', 'Kai', 'peak')
    expect(line).toMatch(/dirty talk, begging, wordless sounds/)
  })

  it('defaults to no reserved clause for a neutral/eager pace', () => {
    const neutral = explicitSceneGuidance('Sumire', 'Kai', 'peak', 'neutral')
    const eager = explicitSceneGuidance('Sumire', 'Kai', 'peak', 'eager')
    expect(neutral).not.toMatch(/checking in, smaller/)
    expect(eager).not.toMatch(/checking in, smaller/)
  })

  it('adds a reserved-pace prose clause at peak, distinct from neutral', () => {
    const reserved = explicitSceneGuidance('Sumire', 'Kai', 'peak', 'reserved')
    expect(reserved).toMatch(/checking in, smaller/)
    expect(reserved).toMatch(/dirty talk or a confident running commentary would read false/)
  })

  // Item 13's per-character explicit-voice note.
  it("appends an author-written voice note when the character card has one, naming the character specifically", () => {
    const withNote = explicitSceneGuidance('Sumire', 'Kai', 'peak', 'neutral', 'Goes quieter and shorter, not louder.')
    expect(withNote).toMatch(/For Sumire specifically: Goes quieter and shorter, not louder\./)
  })

  it('omits the voice-note clause entirely when unset or blank, falling back to the generic instruction alone', () => {
    const unset = explicitSceneGuidance('Sumire', 'Kai', 'peak')
    const blank = explicitSceneGuidance('Sumire', 'Kai', 'peak', 'neutral', '   ')
    expect(unset).not.toMatch(/For Sumire specifically/)
    expect(blank).not.toMatch(/For Sumire specifically/)
  })
})

describe('detectExplicitAntiPatternUsed', () => {
  it('catches a named anti-pattern phrase at peak, case-insensitively', () => {
    expect(detectExplicitAntiPatternUsed('She was lost in the sensation of it all.', 'peak')).toBe('lost in the sensation')
    expect(detectExplicitAntiPatternUsed('ECSTASY washed over her.', 'peak')).toBe('ecstasy')
  })

  it('is undefined when the reply contains none of the named phrases', () => {
    expect(detectExplicitAntiPatternUsed('She gasped, hips rocking against his hand.', 'peak')).toBeUndefined()
  })

  it('never checks building-phase text, even if it happens to contain a listed phrase', () => {
    expect(detectExplicitAntiPatternUsed('She was lost in the sensation already.', 'building')).toBeUndefined()
  })

  it('returns undefined for empty input', () => {
    expect(detectExplicitAntiPatternUsed('', 'peak')).toBeUndefined()
  })
})

describe('explicitAftercareGuidance', () => {
  it('names the character, stays physical, and never emits a macro', () => {
    const line = explicitAftercareGuidance('Sumire')
    expect(line).toContain('Sumire')
    expect(line).toMatch(/oversensitive/i)
    expect(line).not.toContain('{{')
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

describe('appendSceneShapeLog', () => {
  it('appends a resolved scene\'s own shape onto an empty/unset log', () => {
    expect(appendSceneShapeLog(undefined, ['kissing_spot', 'position'])).toEqual([['kissing_spot', 'position']])
  })

  it('keeps the most recent entries, trimming back to SCENE_SHAPE_LOG_CAP once exceeded', () => {
    const log = [['a'], ['b'], ['c']]
    const next = appendSceneShapeLog(log, ['d'])
    expect(next.length).toBe(SCENE_SHAPE_LOG_CAP)
    expect(next).toEqual([['b'], ['c'], ['d']])
  })
})

describe('repeatedEscalationShapeGuidance', () => {
  it('is undefined with fewer than two logged scenes', () => {
    expect(repeatedEscalationShapeGuidance('Sumire', undefined)).toBeUndefined()
    expect(repeatedEscalationShapeGuidance('Sumire', [['kissing_spot', 'position']])).toBeUndefined()
  })

  it('is undefined when the last two logged shapes differ', () => {
    const log = [
      ['kissing_spot', 'position'],
      ['kissing_spot', 'toy'],
    ]
    expect(repeatedEscalationShapeGuidance('Sumire', log)).toBeUndefined()
  })

  it('is undefined for a single-step shape, even if repeated — too short to read as a real curve', () => {
    const log = [['position'], ['position']]
    expect(repeatedEscalationShapeGuidance('Sumire', log)).toBeUndefined()
  })

  it('names the character and the repeated sequence when the last two logged shapes are identical', () => {
    const log = [
      ['kissing_spot', 'position', 'toy'],
      ['kissing_spot', 'position', 'toy'],
    ]
    const line = repeatedEscalationShapeGuidance('Sumire', log)!
    expect(line).toContain('Sumire')
    expect(line).toMatch(/kissing_spot → position → toy/)
    expect(line).toMatch(/third time running/)
  })

  it('only ever compares the LAST two entries, ignoring an older non-matching one', () => {
    const log = [
      ['kissing_spot', 'toy'],
      ['position', 'act'],
      ['position', 'act'],
    ]
    expect(repeatedEscalationShapeGuidance('Sumire', log)).toBeTruthy()
  })
})
