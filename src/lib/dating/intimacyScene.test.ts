import { describe, expect, it } from 'vitest'
import {
  advanceIntimacyScene,
  appendSceneShapeLog,
  arousalOf,
  detectExplicitAntiPatternUsed,
  explicitAftercareGuidance,
  explicitSceneGuidance,
  intimacyAnticipationGuidance,
  intimacyConsentTensionGuidance,
  intimacyPaceFor,
  intimacySceneGuidance,
  isIntimacySceneActive,
  isIntimacySceneStale,
  parseIntimacyObservation,
  repeatedEscalationShapeGuidance,
  resolveIntimacyChoice,
  sceneArousalBand,
  sceneResolveSnapshot,
  SCENE_SHAPE_LOG_CAP,
  startOrShiftIntimacyScene,
  type IntimacyScene,
  type IntimacyTurnObservation,
} from './intimacyScene'
import { BAND_FLOORS, type ArousalState } from './arousal'
import { CHOICE_DEFAULT_AFTER_TURNS, RESOLVE_STAGE, type ScenarioGraph } from './intimacyStages'

const scene = (overrides: Partial<IntimacyScene> = {}): IntimacyScene => ({
  phase: 'building',
  activityLabel: 'spooning: you at Sumire\'s back, both on your sides',
  category: 'position',
  updatedAtTurn: 10,
  ...overrides,
})

/** A meter parked at a given value — tests that need a specific band without playing turns to get there. */
const arousal = (value: number, overrides: Partial<ArousalState> = {}): ArousalState => ({
  value,
  regionExposure: {},
  bandSinceTurn: 0,
  ...overrides,
})

/** A neutral, level turn — each test overrides only the field it's about. */
const obs = (overrides: Partial<IntimacyTurnObservation> = {}): IntimacyTurnObservation => ({
  engagement: 'engaged',
  intensityDelta: 0,
  hesitationSignalled: false,
  stageCompleteSignalled: false,
  regionsTouched: [],
  clothingRemoved: [],
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
  /** Turns of solid escalation from cold, so a test can put a scene where it needs it via the real meter. */
  const climb = (from: IntimacyScene, turns: number, ctx = {}): IntimacyScene => {
    let s = from
    for (let i = 1; i <= turns; i++) {
      const next = advanceIntimacyScene(s, obs({ intensityDelta: 2, regionsTouched: ['genitals'] }), from.updatedAtTurn + i, ctx)
      if (!next) throw new Error('scene resolved while climbing')
      s = next
    }
    return s
  }

  it('holds the scene where it is on an unreadable turn rather than resetting it', () => {
    const next = advanceIntimacyScene(scene({ phase: 'peak' }), undefined, 15)
    expect(next?.phase).toBe('peak')
    expect(next?.updatedAtTurn).toBe(15)
  })

  it('reads the phase off the arousal band rather than from anything the model said', () => {
    const cold = advanceIntimacyScene(scene({ arousal: arousal(10) }), obs({ intensityDelta: 1 }), 15)
    expect(cold?.phase).toBe('building')
    const hot = advanceIntimacyScene(scene({ arousal: arousal(76) }), obs({ intensityDelta: 2 }), 15, { activityWeight: 8 })
    expect(hot?.phase).toBe('peak')
    expect(sceneArousalBand(hot!)).toBe('edge')
  })

  it('takes several committed turns to reach peak — no single turn gets there from cold', () => {
    const s = scene({ arousal: arousal(0) })
    expect(advanceIntimacyScene(s, obs({ intensityDelta: 2, regionsTouched: ['genitals'] }), 11, { activityWeight: 8 })?.phase).toBe('building')
    expect(climb(s, 6, { activityWeight: 8 }).phase).toBe('peak')
  })

  it('cools back out of peak when the scene stops going anywhere', () => {
    const hot = scene({ phase: 'peak', arousal: arousal(79) })
    let s: IntimacyScene | null = hot
    for (let turn = 11; turn < 16 && s; turn++) s = advanceIntimacyScene(s, obs({ engagement: 'drifted' }), turn)
    expect(s?.phase).toBe('building')
  })

  it('resolves once a scene at the edge, and dwelling there, narrates itself finishing', () => {
    const hot = scene({ phase: 'peak', arousal: arousal(90, { bandSinceTurn: 10 }) })
    expect(advanceIntimacyScene(hot, obs({ stageCompleteSignalled: true, intensityDelta: 1 }), 15)).toBeNull()
  })

  it("ignores a completion vote from a scene that never got there — the model can't skip to the end", () => {
    const cold = scene({ arousal: arousal(0) })
    const next = advanceIntimacyScene(cold, obs({ intensityDelta: 2, stageCompleteSignalled: true }), 15, { activityWeight: 8 })
    expect(next).not.toBeNull()
    expect(next?.phase).toBe('building')
  })

  it('ignores a completion vote on the very turn the scene first reaches the edge', () => {
    const nearly = scene({ arousal: arousal(70, { bandSinceTurn: 10 }), updatedAtTurn: 10 })
    const next = advanceIntimacyScene(nearly, obs({ intensityDelta: 2, stageCompleteSignalled: true }), 11, { activityWeight: 8 })
    expect(next).not.toBeNull()
    expect(next?.phase).toBe('peak')
    // ...and honours it on the next turn, once it has actually dwelt there.
    expect(advanceIntimacyScene(next!, obs({ stageCompleteSignalled: true, intensityDelta: 1 }), 12, { activityWeight: 8 })).toBeNull()
  })

  it('carries the activity label and category forward unchanged across a phase move', () => {
    const s = climb(scene({ activityLabel: 'against the wall', category: 'position', arousal: arousal(0) }), 6, { activityWeight: 8 })
    expect(s.phase).toBe('peak')
    expect(s.activityLabel).toBe('against the wall')
    expect(s.category).toBe('position')
  })

  it("uses the scene's own activity weight when the caller passes no override", () => {
    const weighty = scene({ arousal: arousal(40), activityWeight: 8 })
    const slight = scene({ arousal: arousal(40), activityWeight: 1 })
    const a = advanceIntimacyScene(weighty, obs({ intensityDelta: 1 }), 15)!
    const b = advanceIntimacyScene(slight, obs({ intensityDelta: 1 }), 15)!
    expect(arousalOf(a).value).toBeGreaterThan(arousalOf(b).value)
  })

  it('lets a caller override that weight when it knows better', () => {
    const s = scene({ arousal: arousal(40), activityWeight: 1 })
    const overridden = advanceIntimacyScene(s, obs({ intensityDelta: 1 }), 15, { activityWeight: 8 })!
    const stored = advanceIntimacyScene(s, obs({ intensityDelta: 1 }), 15)!
    expect(arousalOf(overridden).value).toBeGreaterThan(arousalOf(stored).value)
  })

  it('accumulates clothing removals across turns without duplicating a layer', () => {
    const first = advanceIntimacyScene(scene(), obs({ clothingRemoved: [{ who: 'char', layer: 'top' }] }), 15)
    const second = advanceIntimacyScene(first!, obs({ clothingRemoved: [{ who: 'char', layer: 'top' }, { who: 'user', layer: 'top' }] }), 16)
    expect(second?.clothing).toEqual({ char: ['top'], user: ['top'] })
  })

  it('holds the last known contact anchor through a turn that described no touch', () => {
    const touched = advanceIntimacyScene(scene(), obs({ regionsTouched: ['hips'] }), 15)
    const quiet = advanceIntimacyScene(touched!, obs({ regionsTouched: [] }), 16)
    expect(quiet?.contactRegions).toEqual(['hips'])
  })

  it('accumulates per-region contact counts across turns', () => {
    const first = advanceIntimacyScene(scene(), obs({ regionsTouched: ['neck', 'hips'] }), 15)
    const second = advanceIntimacyScene(first!, obs({ regionsTouched: ['neck'] }), 16)
    expect(arousalOf(second!).regionExposure).toEqual({ neck: 2, hips: 1 })
  })

  it('takes a reserved character longer to reach peak than an eager one, with no special-case clamp', () => {
    const s = scene({ arousal: arousal(0) })
    expect(climb(s, 5, { activityWeight: 8, pace: 'eager' }).phase).toBe('peak')
    expect(climb(s, 5, { activityWeight: 8, pace: 'reserved' }).phase).toBe('building')
  })

  it('slows a scene mechanically when comfort is trailing chemistry', () => {
    const s = scene({ arousal: arousal(40), activityWeight: 8 })
    const tense = advanceIntimacyScene(s, obs({ intensityDelta: 1 }), 15, { chemistry: 80, comfort: 20 })!
    const easy = advanceIntimacyScene(s, obs({ intensityDelta: 1 }), 15, { chemistry: 80, comfort: 70 })!
    expect(arousalOf(tense).value).toBeLessThan(arousalOf(easy).value)
  })

  it('seeds the meter from the phase on a scene persisted before arousal existed', () => {
    const stored: IntimacyScene = { phase: 'peak', activityLabel: 'x', category: 'activity', updatedAtTurn: 10 }
    expect(arousalOf(stored).value).toBe(BAND_FLOORS.edge)
    expect(advanceIntimacyScene(stored, obs({ stageCompleteSignalled: true, intensityDelta: 1 }), 15)).toBeNull()
    const building: IntimacyScene = { phase: 'building', activityLabel: 'x', category: 'activity', updatedAtTurn: 10 }
    expect(arousalOf(building).value).toBe(0)
    expect(advanceIntimacyScene(building, obs({ intensityDelta: 1 }), 11)?.phase).toBe('building')
  })

  it('stamps phaseSinceTurn fresh whenever the phase actually changes, and leaves it otherwise', () => {
    const s = scene({ arousal: arousal(70), updatedAtTurn: 10, phaseSinceTurn: 10 })
    const moved = advanceIntimacyScene(s, obs({ intensityDelta: 2 }), 15, { activityWeight: 8 })
    expect(moved?.phase).toBe('peak')
    expect(moved?.phaseSinceTurn).toBe(15)
    const held = advanceIntimacyScene(s, obs({ intensityDelta: 0 }), 15)
    expect(held?.phase).toBe('building')
    expect(held?.phaseSinceTurn).toBe(10)
  })
})

describe('parseIntimacyObservation', () => {
  it('accepts a well-formed observation unchanged', () => {
    expect(
      parseIntimacyObservation({
        engagement: 'engaged',
        intensityDelta: 1,
        hesitationSignalled: true,
        stageCompleteSignalled: false,
        regionsTouched: ['lips'],
      }),
    ).toEqual({
      engagement: 'engaged',
      intensityDelta: 1,
      hesitationSignalled: true,
      stageCompleteSignalled: false,
      regionsTouched: ['lips'],
      clothingRemoved: [],
      contact: [],
      participantClothingRemoved: [],
    })
  })

  it('rejects a non-object, and an object with no readable engagement', () => {
    expect(parseIntimacyObservation(undefined)).toBeUndefined()
    expect(parseIntimacyObservation('peak')).toBeUndefined()
    expect(parseIntimacyObservation({ intensityDelta: 2 })).toBeUndefined()
    expect(parseIntimacyObservation({ engagement: 'climaxing' })).toBeUndefined()
  })

  it('falls back to a level, non-committal read for every field but engagement', () => {
    expect(parseIntimacyObservation({ engagement: 'drifted' })).toEqual({
      engagement: 'drifted',
      intensityDelta: 0,
      hesitationSignalled: false,
      stageCompleteSignalled: false,
      regionsTouched: [],
      clothingRemoved: [],
      contact: [],
      participantClothingRemoved: [],
    })
  })

  it('clamps an out-of-range delta to 0 rather than trusting it', () => {
    expect(parseIntimacyObservation({ engagement: 'engaged', intensityDelta: 5 })?.intensityDelta).toBe(0)
    expect(parseIntimacyObservation({ engagement: 'engaged', intensityDelta: -3 })?.intensityDelta).toBe(0)
  })

  it('drops unknown regions and de-duplicates the rest', () => {
    expect(
      parseIntimacyObservation({ engagement: 'engaged', regionsTouched: ['neck', 'elbow', 'neck', 42] })?.regionsTouched,
    ).toEqual(['neck'])
  })

  it('reads clothing removals, dropping any entry that is not a known side and layer', () => {
    const parsed = parseIntimacyObservation({
      engagement: 'engaged',
      clothingRemoved: [{ who: 'char', layer: 'top' }, { who: 'nobody', layer: 'top' }, { who: 'user', layer: 'cape' }],
    })
    expect(parsed?.clothingRemoved).toEqual([{ who: 'char', layer: 'top' }])
  })

  it('treats a non-boolean flag as false rather than truthy', () => {
    const parsed = parseIntimacyObservation({ engagement: 'engaged', stageCompleteSignalled: 'yes', hesitationSignalled: 1 })
    expect(parsed?.stageCompleteSignalled).toBe(false)
    expect(parsed?.hesitationSignalled).toBe(false)
  })
})

describe('startOrShiftIntimacyScene — scene-scoped state', () => {
  it('carries clothing, contact, and the scene start turn across a mid-scene re-centering', () => {
    const prior: IntimacyScene = {
      ...scene({ phase: 'peak', arousal: arousal(90) }),
      startedAtTurn: 4,
      clothing: { char: ['top'] },
      contactRegions: ['hips'],
    }
    const shifted = startOrShiftIntimacyScene('a new activity', 'activity', 12, prior, 6)
    expect(shifted.clothing).toEqual({ char: ['top'] })
    expect(shifted.contactRegions).toEqual(['hips'])
    expect(shifted.startedAtTurn).toBe(4)
    expect(shifted.activityWeight).toBe(6)
  })

  it('starts a fresh scene at the current turn with nothing carried in', () => {
    const fresh = startOrShiftIntimacyScene('a slow kiss', 'kissing_spot', 12)
    expect(fresh.startedAtTurn).toBe(12)
    expect(fresh.clothing).toBeUndefined()
    expect(fresh.contactRegions).toBeUndefined()
  })
})

describe('advanceIntimacyScene — the stage graph', () => {
  /** A three-stage scenario with one gate of each kind, for testing traversal rather than the default's shape. */
  const graph: ScenarioGraph = {
    id: 'test',
    version: 1,
    title: 'Test',
    entryStage: 'opening',
    stages: [
      {
        id: 'opening',
        kind: 'opening',
        minArousal: 0,
        minTurns: 2,
        edges: [{ to: 'middle', mode: 'auto' }],
      },
      {
        id: 'middle',
        kind: 'foreplay',
        minArousal: 40,
        minTurns: 0,
        passiveGain: 20,
        edges: [{ to: 'end', mode: 'auto' }],
      },
      {
        id: 'end',
        kind: 'climax',
        minArousal: 0,
        minTurns: 0,
        edges: [
          { to: RESOLVE_STAGE, mode: 'auto' },
          { to: 'branch', mode: 'choice', label: 'Somewhere else' },
        ],
      },
      { id: 'branch', kind: 'penetrative', minArousal: 0, minTurns: 0, edges: [{ to: RESOLVE_STAGE, mode: 'auto' }] },
    ],
  }

  const onStage = (id: string, overrides: Partial<IntimacyScene> = {}): IntimacyScene =>
    scene({ stageId: id, stageSinceTurn: 10, updatedAtTurn: 10, arousal: arousal(0), ...overrides })

  it("holds a stage until its own turn floor is clear, however hot the scene gets", () => {
    const held = advanceIntimacyScene(onStage('opening', { arousal: arousal(90) }), obs({ intensityDelta: 2 }), 11, { graph })
    expect(held?.stageId).toBe('opening')
    const moved = advanceIntimacyScene(onStage('opening', { arousal: arousal(90) }), obs({ intensityDelta: 2 }), 12, { graph })
    expect(moved?.stageId).toBe('middle')
  })

  it("holds a stage until its own arousal floor is clear, however long it has run", () => {
    const cold = advanceIntimacyScene(onStage('middle', { arousal: arousal(10) }), obs(), 20, { graph })
    expect(cold?.stageId).toBe('middle')
    const hot = advanceIntimacyScene(onStage('middle', { arousal: arousal(60) }), obs(), 20, { graph })
    expect(hot?.stageId).toBe('end')
  })

  it('derives the phase from the stage it lands on, not from anything the model said', () => {
    const moved = advanceIntimacyScene(onStage('middle', { arousal: arousal(60) }), obs(), 20, { graph })
    expect(moved?.stageId).toBe('end')
    expect(moved?.phase).toBe('peak')
  })

  it('stamps the stage turn fresh on a move and records where it has been', () => {
    const moved = advanceIntimacyScene(onStage('middle', { arousal: arousal(60) }), obs(), 20, { graph })
    expect(moved?.stageSinceTurn).toBe(20)
    expect(moved?.visitedStages).toEqual(['middle', 'end'])
    const held = advanceIntimacyScene(onStage('middle', { arousal: arousal(10) }), obs(), 20, { graph })
    expect(held?.stageSinceTurn).toBe(10)
  })

  it('never traverses a choice edge on its own — it waits to be offered', () => {
    const s = onStage('end', { arousal: arousal(90) })
    const next = advanceIntimacyScene(s, obs(), 20, { graph })
    expect(next?.stageId).toBe('end')
  })

  it('resolves only from a stage the scenario actually gave a resolve edge', () => {
    expect(advanceIntimacyScene(onStage('end', { arousal: arousal(90) }), obs({ stageCompleteSignalled: true }), 20, { graph })).toBeNull()
    const early = advanceIntimacyScene(onStage('opening', { arousal: arousal(90) }), obs({ stageCompleteSignalled: true }), 20, { graph })
    expect(early).not.toBeNull()
  })

  it("checks the stage's floors before honouring a completion vote, never the other way around", () => {
    // Turn floor not yet met on `opening`, and it has no resolve edge either way.
    const s = onStage('opening')
    expect(advanceIntimacyScene(s, obs({ stageCompleteSignalled: true }), 11, { graph })).not.toBeNull()
  })

  it("uses the stage's own passive drift when it authors one", () => {
    const authored = advanceIntimacyScene(onStage('middle', { arousal: arousal(10) }), obs(), 20, { graph })
    const generic = advanceIntimacyScene(onStage('opening', { arousal: arousal(10) }), obs(), 11, { graph })
    expect(arousalOf(authored!).value).toBeGreaterThan(arousalOf(generic!).value)
  })

  it('seeds a scene persisted before stages existed from the phase it was already in', () => {
    const legacy: IntimacyScene = { phase: 'peak', activityLabel: 'x', category: 'activity', updatedAtTurn: 10 }
    // The default graph's peak stage is the one whose kind reads as `peak`.
    const next = advanceIntimacyScene(legacy, obs({ intensityDelta: 1 }), 12)
    expect(next?.stageId).toBe('peak')
  })

  it('enters the graph at its entry stage on a fresh scene, and re-enters there on a mid-scene click', () => {
    const fresh = startOrShiftIntimacyScene('a kiss', 'kissing_spot', 5)
    expect(fresh.stageId).toBe('building')
    expect(fresh.visitedStages).toEqual(['building'])
    const prior = scene({ phase: 'peak', stageId: 'peak', visitedStages: ['building', 'peak'], arousal: arousal(90) })
    const shifted = startOrShiftIntimacyScene('a position', 'position', 12, prior)
    expect(shifted.stageId).toBe('building')
    expect(shifted.visitedStages).toEqual(['building', 'peak', 'building'])
  })
})

describe('advanceIntimacyScene — blocking choices', () => {
  const graph: ScenarioGraph = {
    id: 'branching',
    version: 1,
    title: 'Branching',
    entryStage: 'fork',
    stages: [
      {
        id: 'fork',
        kind: 'foreplay',
        minArousal: 0,
        minTurns: 0,
        edges: [
          { to: 'left', mode: 'choice', label: 'Left', entryId: 'pos-missionary' },
          { to: 'right', mode: 'choice', label: 'Right', isDefault: true },
          // An auto edge out of the same stage, which must never pre-empt the branch.
          { to: 'left', mode: 'auto' },
        ],
      },
      { id: 'left', kind: 'penetrative', minArousal: 0, minTurns: 0, edges: [{ to: RESOLVE_STAGE, mode: 'auto' }] },
      { id: 'right', kind: 'oral', minArousal: 0, minTurns: 0, edges: [{ to: RESOLVE_STAGE, mode: 'auto' }] },
    ],
  }

  const atFork = (overrides: Partial<IntimacyScene> = {}): IntimacyScene =>
    scene({ stageId: 'fork', stageSinceTurn: 10, updatedAtTurn: 10, arousal: arousal(50), ...overrides })

  it('raises the branch instead of taking an auto edge out of the same stage', () => {
    const next = advanceIntimacyScene(atFork(), obs(), 11, { graph })
    expect(next?.stageId).toBe('fork')
    expect(next?.pendingChoice?.options.map((o) => o.edgeTo)).toEqual(['left', 'right'])
  })

  it('holds the stage while the branch is open, however the scene goes', () => {
    let s: IntimacyScene | null = advanceIntimacyScene(atFork(), obs(), 11, { graph })!
    s = advanceIntimacyScene(s, obs({ intensityDelta: 2, stageCompleteSignalled: true }), 12, { graph })
    expect(s?.stageId).toBe('fork')
    expect(s?.pendingChoice).toBeDefined()
  })

  it('keeps the meter running while it waits — the scene is still being played', () => {
    const raised = advanceIntimacyScene(atFork(), obs(), 11, { graph })!
    const later = advanceIntimacyScene(raised, obs({ intensityDelta: 2 }), 12, { graph, activityWeight: 8 })!
    expect(arousalOf(later).value).toBeGreaterThan(arousalOf(raised).value)
  })

  it('falls through to its default rather than deadlocking on a player who never answered', () => {
    let s: IntimacyScene | null = advanceIntimacyScene(atFork(), obs(), 11, { graph })!
    for (let turn = 12; turn <= 11 + CHOICE_DEFAULT_AFTER_TURNS; turn++) s = advanceIntimacyScene(s!, obs(), turn, { graph })
    expect(s?.stageId).toBe('right')
    expect(s?.pendingChoice).toBeUndefined()
  })

  it('drops a branch whose options stopped being eligible rather than holding the scene on it', () => {
    const gated: ScenarioGraph = {
      ...graph,
      stages: graph.stages.map((stage) =>
        stage.id === 'fork'
          ? {
              ...stage,
              edges: [
                { to: 'left', mode: 'choice' as const, label: 'Left', conditions: [{ kind: 'arousal_at_least' as const, value: 40 }] },
                { to: 'right', mode: 'choice' as const, label: 'Right', conditions: [{ kind: 'arousal_at_least' as const, value: 40 }] },
              ],
            }
          : stage,
      ),
    }
    const raised = advanceIntimacyScene(atFork(), obs(), 11, { graph: gated })!
    expect(raised.pendingChoice).toBeDefined()
    // The scene cools back under the gate the options needed.
    const cooled = advanceIntimacyScene({ ...raised, arousal: arousal(10) }, obs({ engagement: 'drifted' }), 12, { graph: gated })
    expect(cooled?.pendingChoice).toBeUndefined()
  })
})

describe('resolveIntimacyChoice', () => {
  const graph: ScenarioGraph = {
    id: 'branching',
    version: 1,
    title: 'Branching',
    entryStage: 'fork',
    stages: [
      {
        id: 'fork',
        kind: 'foreplay',
        minArousal: 0,
        minTurns: 0,
        edges: [
          { to: 'left', mode: 'choice', label: 'Left' },
          { to: RESOLVE_STAGE, mode: 'choice', label: 'Bring it to a close' },
        ],
      },
      { id: 'left', kind: 'penetrative', minArousal: 0, minTurns: 0, edges: [{ to: RESOLVE_STAGE, mode: 'auto' }] },
    ],
  }

  const blocked = (): IntimacyScene =>
    scene({
      stageId: 'fork',
      stageSinceTurn: 10,
      updatedAtTurn: 10,
      arousal: arousal(50),
      pendingChoice: {
        fromStage: 'fork',
        options: [
          { edgeTo: 'left', label: 'Left' },
          { edgeTo: RESOLVE_STAGE, label: 'Bring it to a close' },
        ],
        defaultEdgeTo: 'left',
        sinceTurn: 10,
      },
    })

  it('moves the scene onto the chosen stage and clears the branch', () => {
    const next = resolveIntimacyChoice(blocked(), 'left', 12, graph)
    expect(next).not.toBeNull()
    expect((next as IntimacyScene).stageId).toBe('left')
    expect((next as IntimacyScene).pendingChoice).toBeUndefined()
    expect((next as IntimacyScene).phase).toBe('peak')
  })

  it('ends the scene when that is what was chosen', () => {
    expect(resolveIntimacyChoice(blocked(), RESOLVE_STAGE, 12, graph)).toBeNull()
  })

  it('ignores a target the branch never offered, rather than jumping the scene somewhere', () => {
    const next = resolveIntimacyChoice(blocked(), 'somewhere-else', 12, graph)
    expect((next as IntimacyScene).stageId).toBe('fork')
    expect((next as IntimacyScene).pendingChoice).toBeDefined()
  })

  it('is a no-op on a scene with no branch open', () => {
    const plain = scene({ stageId: 'fork' })
    expect(resolveIntimacyChoice(plain, 'left', 12, graph)).toBe(plain)
  })
})

describe('sceneResolveSnapshot', () => {
  it('measures the whole scene, not the current stage', () => {
    const s = scene({ startedAtTurn: 4, updatedAtTurn: 15, arousal: arousal(88), visitedStages: ['building', 'peak'] })
    expect(sceneResolveSnapshot(s, 15)).toEqual({ turns: 11, arousal: 88, stages: 2 })
  })

  it('counts distinct stages, so bouncing between two is not mistaken for a longer scene', () => {
    const s = scene({ startedAtTurn: 4, arousal: arousal(80), visitedStages: ['building', 'peak', 'building', 'peak'] })
    expect(sceneResolveSnapshot(s, 15).stages).toBe(2)
  })

  it('reads a scene persisted before any of these fields existed without going negative', () => {
    const legacy: IntimacyScene = { phase: 'peak', activityLabel: 'x', category: 'activity', updatedAtTurn: 12 }
    const snapshot = sceneResolveSnapshot(legacy, 12)
    expect(snapshot.turns).toBe(0)
    expect(snapshot.stages).toBe(1)
    // Seeded from the phase, the same way `arousalOf` does it.
    expect(snapshot.arousal).toBe(BAND_FLOORS.edge)
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
  it('instructs continuity without restating the activity the state block already asserts', () => {
    const line = intimacySceneGuidance('Sumire', scene())
    expect(line).toContain('Sumire')
    expect(line).toMatch(/stay continuous/i)
    expect(line).not.toContain(scene().activityLabel)
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

  it('nudges variety once the meter has sat in one band for a few turns, not on a fresh arrival', () => {
    const fresh = intimacySceneGuidance('Sumire', scene({ phase: 'peak', updatedAtTurn: 10, arousal: arousal(85, { bandSinceTurn: 10 }) }))
    const held = intimacySceneGuidance('Sumire', scene({ phase: 'peak', updatedAtTurn: 13, arousal: arousal(85, { bandSinceTurn: 10 }) }))
    expect(fresh).not.toMatch(/held at the same level/)
    expect(held).toMatch(/held at the same level/)
  })

  it('nudges a stalled build too, not only a stalled peak — going nowhere reads the same either way', () => {
    const heldBuilding = intimacySceneGuidance('Sumire', scene({ phase: 'building', updatedAtTurn: 20, arousal: arousal(30, { bandSinceTurn: 10 }) }))
    expect(heldBuilding).toMatch(/held at the same level/)
  })

  it('names a worn-out region specifically, in place of the generic nudge', () => {
    const worn = intimacySceneGuidance(
      'Sumire',
      scene({ phase: 'peak', updatedAtTurn: 20, arousal: arousal(85, { bandSinceTurn: 10, regionExposure: { inner_thigh: 5 } }) }),
    )
    expect(worn).toMatch(/inner thigh has been the focus/)
    expect(worn).not.toMatch(/held at the same level/)
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
