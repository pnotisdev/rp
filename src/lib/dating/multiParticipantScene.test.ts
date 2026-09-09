import { describe, expect, it } from 'vitest'
import {
  advanceIntimacyScene,
  arousalOf,
  clothingOf,
  sceneArousalBand,
  sceneArousalFloorValue,
  resolveIntimacyChoice,
  resolvedSceneFlags,
  sceneResolveSnapshot,
  startOrShiftIntimacyScene,
  type IntimacyScene,
  type IntimacySceneContext,
  type IntimacyTurnObservation,
} from './intimacyScene'
import { SCENE_PLAYER } from './sceneParticipants'
import { BAND_FLOORS } from './arousal'
import { buildPendingChoice, defaultChoiceOption, DEFAULT_SCENARIO, RESOLVE_STAGE, type ScenarioGraph } from './intimacyStages'
import { BRANCHING_SCENARIO } from './scenarios'

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

describe('a branch whose options lead to the same place', () => {
  // The closing branch of `BRANCHING_SCENARIO` offers "Finish together, inside" and "Pull out
  // first". Both end the scene, so both edges point at `resolve` — which means the option's target
  // cannot be what identifies it. These pin the two things that broke as a result.
  const closing = () => {
    const stage = BRANCHING_SCENARIO.stages.find((st) => st.id === 'finish')!
    return buildPendingChoice(stage, { arousal: 100 }, 5)!
  }

  it('gives every option a distinct identity, so two of them are never the same button', () => {
    const ids = closing().options.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('records which option was actually taken, rather than only where it led', () => {
    const choice = closing()
    const inside = choice.options.find((o) => o.label === 'Finish together, inside')!
    const pullOut = choice.options.find((o) => o.label === 'Pull out first')!
    // Both resolve the scene, so the flag is the only thing that survives to tell them apart.
    expect(inside.setsFlag).toBeTruthy()
    expect(pullOut.setsFlag).toBeTruthy()
    expect(inside.setsFlag).not.toBe(pullOut.setsFlag)
  })

  it("writes the taken option's flag onto the scene, not just into the prose", () => {
    const withChoice = { ...shared(), pendingChoice: closing() }
    const pullOut = closing().options.find((o) => o.label === 'Pull out first')!
    // Ending the scene returns null, so the flag has to be readable from the resolve itself.
    expect(resolvedSceneFlags(withChoice, pullOut.id)).toContain(pullOut.setsFlag)
  })

  it('carries a flag set by a non-ending option forward on the live scene', () => {
    const withChoice = { ...shared(), pendingChoice: closing() }
    const notYet = closing().options.find((o) => o.label === 'Not yet, draw it out')!
    const next = resolveIntimacyChoice(withChoice, notYet.id, 6, BRANCHING_SCENARIO)
    expect(next).not.toBeNull()
    expect(next!.stageId).toBe('together')
  })
})

describe('what a branch flag survives as', () => {
  const closing = () => {
    const stage = BRANCHING_SCENARIO.stages.find((st) => st.id === 'finish')!
    return buildPendingChoice(stage, { arousal: 100 }, 5)!
  }

  it('fires the default option when nobody answers, and records its flag on the way out', () => {
    const choice = closing()
    const withChoice: IntimacyScene = {
      ...shared(),
      stageId: 'finish',
      stageSinceTurn: 0,
      pendingChoice: choice,
      arousal: { value: 100, regionExposure: {}, bandSinceTurn: 0 },
      participantArousal: { [OTHER]: { value: 100, regionExposure: {}, bandSinceTurn: 0 } },
    }
    const dflt = defaultChoiceOption(choice)!
    expect(dflt.setsFlag).toBe('finished_inside')
    // The default ends this scene, so its flag has to be readable before the resolve discards it.
    expect(resolvedSceneFlags(withChoice, dflt.id)).toContain('finished_inside')
  })

  it('never records a flag for an option that was not the one taken', () => {
    const withChoice = { ...shared(), pendingChoice: closing() }
    const pullOut = closing().options.find((o) => o.label === 'Pull out first')!
    expect(resolvedSceneFlags(withChoice, pullOut.id)).not.toContain('finished_inside')
  })

  it('leaves the flag list alone for an option that sets none', () => {
    const withChoice = { ...shared(), pendingChoice: closing() }
    const notYet = closing().options.find((o) => o.label === 'Not yet, draw it out')!
    expect(resolvedSceneFlags(withChoice, notYet.id)).toEqual([])
  })

  it('never double-records a flag the scene already carries', () => {
    const already: IntimacyScene = { ...shared(), sceneFlags: ['pulled_out'], pendingChoice: closing() }
    const pullOut = closing().options.find((o) => o.label === 'Pull out first')!
    expect(resolvedSceneFlags(already, pullOut.id)).toEqual(['pulled_out'])
  })

  it('carries flags across a mid-scene re-centering, since it is still the same scene', () => {
    const flagged: IntimacyScene = { ...shared(), sceneFlags: ['pulled_out'] }
    const shifted = startOrShiftIntimacyScene('a different position', 'position', 4, flagged, 8, BRANCHING_SCENARIO)
    expect(shifted.sceneFlags).toEqual(['pulled_out'])
  })
})

describe('a branch whose options stop being eligible while it is open', () => {
  // A branch is raised from the state at that moment, then sits there for turns. If the state moves
  // under it — a gate closing as arousal falls — the stored options must not stay pickable.
  const gated: ScenarioGraph = {
    id: 'gated',
    version: 1,
    title: 'Gated',
    entryStage: 'fork',
    stages: [
      {
        id: 'fork',
        kind: 'foreplay',
        minArousal: 0,
        minTurns: 0,
        edges: [
          { to: 'calm', mode: 'choice', label: 'Ease off' },
          { to: 'hot', mode: 'choice', label: 'Push on', conditions: [{ kind: 'arousal_at_least', value: 60 }] },
          { to: 'calm', mode: 'auto', conditions: [{ kind: 'arousal_at_least', value: 99 }] },
        ],
      },
      { id: 'calm', kind: 'foreplay', minArousal: 0, minTurns: 0, edges: [{ to: RESOLVE_STAGE, mode: 'auto' }] },
      { id: 'hot', kind: 'penetrative', minArousal: 0, minTurns: 0, edges: [{ to: RESOLVE_STAGE, mode: 'auto' }] },
    ],
  }

  /** The branch as raised while hot enough for both options. */
  const raisedHot = (): IntimacyScene => ({
    ...startOrShiftIntimacyScene('something', 'position', 0, null, 6, gated),
    stageId: 'fork',
    stageSinceTurn: 0,
    updatedAtTurn: 0,
    arousal: { value: 70, regionExposure: {}, bandSinceTurn: 0 },
    pendingChoice: buildPendingChoice(gated.stages[0], { arousal: 70 }, 0)!,
  })

  it('offers both options while the gate is open', () => {
    expect(raisedHot().pendingChoice!.options.map((o) => o.label)).toEqual(['Ease off', 'Push on'])
  })

  it('stops offering the gated option once the meter falls back under it', () => {
    // Two cooling turns: enough for arousal to drop under the gate, still short of the turns the
    // branch's own default needs, so nothing here is the timeout doing the work.
    const cooling: IntimacyTurnObservation = { ...turn(), engagement: 'stalled', intensityDelta: -1 }
    let scene: IntimacyScene = raisedHot()
    for (let i = 1; i <= 2; i += 1) scene = advanceIntimacyScene(scene, cooling, i, { graph: gated })!
    expect(arousalOf(scene).value).toBeLessThan(60)
    // With the gate shut only one option is left, and one option is not a decision — so the branch
    // closes rather than sitting there offering a single button.
    expect(scene.pendingChoice).toBeUndefined()
  })

  it('refuses an answer naming an option that is no longer eligible', () => {
    const cooling: IntimacyTurnObservation = { ...turn(), engagement: 'stalled', intensityDelta: -1 }
    let scene: IntimacyScene = raisedHot()
    for (let i = 1; i <= 2; i += 1) scene = advanceIntimacyScene(scene, cooling, i, { graph: gated })!
    // The id the gated option had when the branch went up. Answering with it must not move the scene.
    const staleId = raisedHot().pendingChoice!.options.find((o) => o.label === 'Push on')!.id
    const after = resolveIntimacyChoice(scene, staleId, 3, gated)
    expect(after).not.toBeNull()
    expect((after as IntimacyScene).stageId).toBe('fork')
  })
})

describe('whose body a region read belongs to', () => {
  // The judge is prompted with the *speaker's* name, so `regionsTouched` describes the speaker. In a
  // shared scene the speaker is often not the owner, and the flat list cannot say whose body it
  // means at all — which is exactly why `contact` exists. So a shared scene must attribute from the
  // graph and never fold the flat list into one particular participant.
  const flatOnly: IntimacyTurnObservation = { ...turn(), regionsTouched: ['genitals'] }

  it('never credits the owner from a flat region list once the scene is shared', () => {
    const next = play(shared(), 3, flatOnly)!
    // Nobody is named as touched by the graph, so nobody should be gaining from touch at all.
    expect(arousalOf(next, OWNER).regionExposure.genitals).toBeUndefined()
    expect(arousalOf(next, OTHER).regionExposure.genitals).toBeUndefined()
  })

  it('still reads the flat list for a solo scene, where it is unambiguous', () => {
    const solo = startOrShiftIntimacyScene('kissing her neck', 'kissing_spot', 0, null, 6, DEFAULT_SCENARIO)
    const next = advanceIntimacyScene(solo, flatOnly, 1, { graph: DEFAULT_SCENARIO })!
    expect(arousalOf(next).regionExposure.genitals).toBe(1)
  })

  it('attributes a shared scene entirely from the contact graph', () => {
    const graphOnly = turn([{ actor: SCENE_PLAYER, target: OTHER, region: 'genitals' }])
    const next = play(shared(), 2, graphOnly)!
    expect(arousalOf(next, OTHER).regionExposure.genitals).toBe(2)
    expect(arousalOf(next, OWNER).regionExposure.genitals).toBeUndefined()
  })
})
