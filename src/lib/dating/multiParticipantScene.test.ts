import { describe, expect, it } from 'vitest'
import {
  advanceIntimacyScene,
  arousalOf,
  clothingOf,
  sceneArousalBand,
  sceneArousalFloorValue,
  sceneResolveSnapshot,
  startOrShiftIntimacyScene,
  type IntimacyScene,
  type IntimacySceneContext,
  type IntimacyTurnObservation,
} from './intimacyScene'
import { SCENE_PLAYER } from './sceneParticipants'
import { BAND_FLOORS } from './arousal'
import { DEFAULT_SCENARIO } from './intimacyStages'

// One scene shared by two characters, rather than two scenes that will eventually disagree. What
// these cover is the part no single-character test can: that the engine runs every participant's own
// meter over the same turn, gates the stage on the *least* ready of them, and keeps each of their
// bodies' state apart.

const OWNER = 'sumire'
const OTHER = 'aoi'

/** A fresh scene with both characters in it, started the way a click on the second one starts it. */
const shared = (overrides: Partial<IntimacyScene> = {}): IntimacyScene => ({
  ...startOrShiftIntimacyScene('kissing her neck', 'kissing_spot', 0, null, 6, DEFAULT_SCENARIO, 0, ['gentle'], [OWNER, OTHER]),
  ...overrides,
})

/** A committed turn. `contact` is what a shared scene's judge reports instead of bare `regionsTouched`. */
const turn = (contact: IntimacyTurnObservation['contact'] = []): IntimacyTurnObservation => ({
  engagement: 'engaged',
  intensityDelta: 1,
  hesitationSignalled: false,
  stageCompleteSignalled: false,
  regionsTouched: [],
  clothingRemoved: [],
  contact,
})

const ctx: IntimacySceneContext = {
  graph: DEFAULT_SCENARIO,
  pace: 'neutral',
  comfort: 70,
  chemistry: 70,
  participants: { [OTHER]: { pace: 'neutral', comfort: 70, chemistry: 70 } },
}

/** Plays `count` identical turns onto a scene. */
function play(scene: IntimacyScene, count: number, obs: IntimacyTurnObservation, context = ctx): IntimacyScene | null {
  let current: IntimacyScene | null = scene
  for (let i = 1; i <= count && current; i += 1) current = advanceIntimacyScene(current, obs, i, context)
  return current
}

describe('a scene shared by two characters', () => {
  it('records its roster with the owner first', () => {
    expect(shared().participants).toEqual([OWNER, OTHER])
  })

  it('runs both meters over the same turn, each off their own share of the contact graph', () => {
    const next = play(shared(), 3, turn([
      { actor: SCENE_PLAYER, target: OWNER, region: 'neck' },
      { actor: SCENE_PLAYER, target: OTHER, region: 'hands' },
    ]))!
    expect(arousalOf(next, OWNER).value).toBeGreaterThan(0)
    expect(arousalOf(next, OTHER).value).toBeGreaterThan(0)
  })

  it('leaves a participant nobody is touching well behind one who is', () => {
    const next = play(shared(), 4, turn([{ actor: SCENE_PLAYER, target: OWNER, region: 'neck' }]))!
    // Asymmetry is the point: one of them is being touched and the other is not, so they are not at
    // the same place in the scene.
    expect(arousalOf(next, OWNER).value).toBeGreaterThan(arousalOf(next, OTHER).value)
  })

  it('states a different band per participant, so the prompt can say so', () => {
    const next = play(shared(), 5, turn([{ actor: SCENE_PLAYER, target: OWNER, region: 'genitals' }]))!
    expect(sceneArousalBand(next, OWNER)).not.toBe(sceneArousalBand(next, OTHER))
  })

  it('scores the same region differently for each of them, from their own sensitivity', () => {
    const asymmetric: IntimacySceneContext = {
      ...ctx,
      sensitivity: { neck: 3 },
      participants: { [OTHER]: { pace: 'neutral', comfort: 70, chemistry: 70, sensitivity: { neck: 0 } } },
    }
    const next = play(
      shared(),
      3,
      turn([
        { actor: SCENE_PLAYER, target: OWNER, region: 'neck' },
        { actor: SCENE_PLAYER, target: OTHER, region: 'neck' },
      ]),
      asymmetric,
    )!
    expect(arousalOf(next, OWNER).value).toBeGreaterThan(arousalOf(next, OTHER).value)
  })

  it("never applies the owner's feelings about the content to anyone else", () => {
    // The owner is eager for this; the other participant has no stance on record. The unsupplied one
    // must read as neutral, not as sharing the owner's enthusiasm.
    const eagerOwner = { ...shared(), activityValence: 2 as const }
    const both = turn([
      { actor: SCENE_PLAYER, target: OWNER, region: 'neck' },
      { actor: SCENE_PLAYER, target: OTHER, region: 'neck' },
    ])
    const next = play(eagerOwner, 3, both)!
    expect(arousalOf(next, OWNER).value).toBeGreaterThan(arousalOf(next, OTHER).value)
  })
})

describe('the stage gates on the least ready participant', () => {
  const onlyOwnerTouched = turn([{ actor: SCENE_PLAYER, target: OWNER, region: 'genitals' }])

  it('reports the floor, not the owner, as the scene reading', () => {
    const next = play(shared(), 5, onlyOwnerTouched)!
    expect(sceneArousalFloorValue(next)).toBe(arousalOf(next, OTHER).value)
    expect(sceneArousalFloorValue(next)).toBeLessThan(arousalOf(next, OWNER).value)
  })

  it('holds the scene out of its peak while one of them is nowhere near it', () => {
    // The owner alone would have crossed the peak floor several turns ago.
    const next = play(shared(), 8, onlyOwnerTouched)!
    expect(arousalOf(next, OWNER).value).toBeGreaterThanOrEqual(BAND_FLOORS.edge)
    expect(next.phase).toBe('building')
    expect(next.stageId).toBe('building')
  })

  it('crosses into the peak once both of them are actually there', () => {
    const bothTouched = turn([
      { actor: SCENE_PLAYER, target: OWNER, region: 'genitals' },
      { actor: OWNER, target: OTHER, region: 'genitals' },
    ])
    const next = play(shared(), 8, bothTouched)!
    expect(next.phase).toBe('peak')
  })

  it('refuses to resolve on a completion vote while one of them is still short of the floor', () => {
    const finishing = { ...onlyOwnerTouched, stageCompleteSignalled: true }
    expect(play(shared(), 10, finishing)).not.toBeNull()
  })

  it('reads identically to the single meter when only one participant is in the scene', () => {
    const solo = startOrShiftIntimacyScene('kissing her neck', 'kissing_spot', 0, null, 6, DEFAULT_SCENARIO)
    const next = advanceIntimacyScene(solo, turn(), 1, { graph: DEFAULT_SCENARIO })!
    expect(sceneArousalFloorValue(next)).toBe(arousalOf(next).value)
  })
})

describe('per-participant bodies', () => {
  it('keeps each participant clothing ledger apart, and the owner in the scene\'s own field', () => {
    const undressing: IntimacyTurnObservation = {
      ...turn(),
      clothingRemoved: [{ who: 'char', layer: 'top' }],
      participantClothingRemoved: [{ who: OTHER, layer: 'bottoms' }],
    }
    const next = play(shared(), 1, undressing)!
    expect(clothingOf(next, OWNER)).toEqual({ char: ['top'] })
    expect(clothingOf(next, OTHER)).toEqual({ char: ['bottoms'] })
  })

  it('ignores a clothing read naming someone who is not in the scene', () => {
    const stray: IntimacyTurnObservation = { ...turn(), participantClothingRemoved: [{ who: 'a-stranger', layer: 'top' }] }
    expect(play(shared(), 1, stray)!.participantClothing?.['a-stranger']).toBeUndefined()
  })

  it("routes a removal aimed at the owner's id into the scene's own field rather than a second ledger", () => {
    const owned: IntimacyTurnObservation = { ...turn(), participantClothingRemoved: [{ who: OWNER, layer: 'top' }] }
    const next = play(shared(), 1, owned)!
    // The owner has exactly one place their layers live; a duplicate ledger is the two-sources-of-truth
    // failure this whole arrangement exists to avoid. Recorded, not dropped — losing it would let the
    // continuity check wave through a reply undressing them a second time.
    expect(clothingOf(next, OWNER)).toEqual({ char: ['top'] })
    expect(next.participantClothing?.[OWNER]).toBeUndefined()
  })

  it('carries the contact graph and everyone else\'s state across a mid-scene re-centering', () => {
    const live = play(shared(), 3, turn([{ actor: SCENE_PLAYER, target: OTHER, region: 'hips' }]))!
    const shifted = startOrShiftIntimacyScene('a different position', 'position', 4, live, 8, DEFAULT_SCENARIO, 0, [], undefined)
    expect(shifted.participants).toEqual([OWNER, OTHER])
    expect(shifted.contact?.length).toBe(1)
    expect(shifted.participantArousal?.[OTHER]).toBeDefined()
  })

  it('caps every participant back under the peak floor on a re-centering, not only the owner', () => {
    const hot = {
      ...shared(),
      arousal: { value: 95, regionExposure: {}, bandSinceTurn: 0 },
      participantArousal: { [OTHER]: { value: 95, regionExposure: {}, bandSinceTurn: 0 } },
    }
    const shifted = startOrShiftIntimacyScene('a different position', 'position', 5, hot, 8, DEFAULT_SCENARIO)
    expect(arousalOf(shifted, OWNER).value).toBeLessThan(BAND_FLOORS.edge)
    expect(arousalOf(shifted, OTHER).value).toBeLessThan(BAND_FLOORS.edge)
  })

  it('does not add someone to the scene as a side effect of picking a different activity', () => {
    const live = shared()
    const shifted = startOrShiftIntimacyScene('a different position', 'position', 4, live, 8, DEFAULT_SCENARIO)
    expect(shifted.participants).toEqual([OWNER, OTHER])
  })
})

describe('what a resolved shared scene hands aftercare', () => {
  it("measures the scene by its floor, so it can't read as earned when one of them never got there", () => {
    const next = play(shared(), 6, turn([{ actor: SCENE_PLAYER, target: OWNER, region: 'genitals' }]))!
    const snapshot = sceneResolveSnapshot(next, 6)
    expect(snapshot.arousal).toBe(arousalOf(next, OTHER).value)
    expect(snapshot.arousal).toBeLessThan(arousalOf(next, OWNER).value)
  })
})
