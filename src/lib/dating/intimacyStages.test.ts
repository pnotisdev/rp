import { describe, expect, it } from 'vitest'
import {
  buildPendingChoice,
  choiceDefaultDue,
  CHOICE_DEFAULT_AFTER_TURNS,
  DEFAULT_SCENARIO,
  eligibleChoiceEdges,
  nextAutoEdge,
  phaseForStageKind,
  resolveEdge,
  RESOLVE_STAGE,
  stageById,
  stageConditionHolds,
  stageConditionsMet,
  stageFloorsMet,
  stageOverstayed,
  validateScenarioGraph,
  type IntimacyStage,
  type ScenarioGraph,
  type StageContext,
} from './intimacyStages'

const ctx = (overrides: Partial<StageContext> = {}): StageContext => ({ arousal: 0, ...overrides })

const stage = (overrides: Partial<IntimacyStage> = {}): IntimacyStage => ({
  id: 'here',
  kind: 'foreplay',
  minArousal: 0,
  minTurns: 0,
  edges: [],
  ...overrides,
})

const relationship = {
  affection: 50,
  warmth: 50,
  stats: { comfort: 40 },
  flags: new Set(['first_kiss']),
  commitmentStatus: 'dating' as const,
  day: 12,
}

describe('stageConditionHolds — stage-specific kinds', () => {
  it('reads the arousal meter in both directions', () => {
    expect(stageConditionHolds({ kind: 'arousal_at_least', value: 50 }, ctx({ arousal: 50 }))).toBe(true)
    expect(stageConditionHolds({ kind: 'arousal_at_least', value: 50 }, ctx({ arousal: 49 }))).toBe(false)
    expect(stageConditionHolds({ kind: 'arousal_below', value: 50 }, ctx({ arousal: 49 }))).toBe(true)
    expect(stageConditionHolds({ kind: 'arousal_below', value: 50 }, ctx({ arousal: 50 }))).toBe(false)
  })

  it('reads where the scene has already been', () => {
    expect(stageConditionHolds({ kind: 'stage_visited', stage: 'oral' }, ctx({ visitedStages: ['opening', 'oral'] }))).toBe(true)
    expect(stageConditionHolds({ kind: 'stage_visited', stage: 'oral' }, ctx({ visitedStages: ['opening'] }))).toBe(false)
    expect(stageConditionHolds({ kind: 'stage_visited', stage: 'oral' }, ctx())).toBe(false)
  })

  it('reads owned items, and never holds when nothing is known', () => {
    expect(stageConditionHolds({ kind: 'inventory_has', itemId: 'toy-vibrator' }, ctx({ ownedItemIds: new Set(['toy-vibrator']) }))).toBe(true)
    expect(stageConditionHolds({ kind: 'inventory_has', itemId: 'toy-vibrator' }, ctx())).toBe(false)
  })

  it('treats an unrecorded kink as unlimited but not enthusiastic', () => {
    expect(stageConditionHolds({ kind: 'kink_not_limited', kink: 'bondage' }, ctx())).toBe(true)
    expect(stageConditionHolds({ kind: 'kink_not_limited', kink: 'bondage' }, ctx({ kinks: { bondage: -2 } }))).toBe(false)
    expect(stageConditionHolds({ kind: 'kink_at_least', kink: 'bondage', valence: 1 }, ctx())).toBe(false)
    expect(stageConditionHolds({ kind: 'kink_at_least', kink: 'bondage', valence: 1 }, ctx({ kinks: { bondage: 2 } }))).toBe(true)
  })
})

describe('stageConditionHolds — kinds shared with world triggers', () => {
  it('delegates to the trigger evaluator, so the two can never disagree', () => {
    const withRel = ctx({ relationship })
    expect(stageConditionHolds({ kind: 'stat_at_least', stat: 'affection', value: 40 }, withRel)).toBe(true)
    expect(stageConditionHolds({ kind: 'stat_below', stat: 'comfort', value: 50 }, withRel)).toBe(true)
    expect(stageConditionHolds({ kind: 'flag_set', flag: 'first_kiss' }, withRel)).toBe(true)
    expect(stageConditionHolds({ kind: 'commitment_at_least', status: 'dating' }, withRel)).toBe(true)
    expect(stageConditionHolds({ kind: 'day_at_least', day: 20 }, withRel)).toBe(false)
  })

  it('never holds a shared condition when no relationship state was supplied', () => {
    expect(stageConditionHolds({ kind: 'flag_set', flag: 'first_kiss' }, ctx())).toBe(false)
  })
})

describe('stageConditionsMet', () => {
  it('needs every condition, and an empty list always passes', () => {
    expect(stageConditionsMet(undefined, ctx())).toBe(true)
    expect(stageConditionsMet([], ctx())).toBe(true)
    expect(
      stageConditionsMet([{ kind: 'arousal_at_least', value: 10 }, { kind: 'arousal_below', value: 50 }], ctx({ arousal: 20 })),
    ).toBe(true)
    expect(
      stageConditionsMet([{ kind: 'arousal_at_least', value: 10 }, { kind: 'arousal_below', value: 50 }], ctx({ arousal: 60 })),
    ).toBe(false)
  })
})

describe('stageFloorsMet', () => {
  it('needs both the turn floor and the arousal floor', () => {
    const s = stage({ minTurns: 2, minArousal: 40 })
    expect(stageFloorsMet(s, 2, 40)).toBe(true)
    expect(stageFloorsMet(s, 1, 90)).toBe(false)
    expect(stageFloorsMet(s, 5, 39)).toBe(false)
  })
})

describe('edge selection', () => {
  const branching = stage({
    edges: [
      { to: RESOLVE_STAGE, mode: 'auto' },
      { to: 'gated', mode: 'auto', conditions: [{ kind: 'arousal_at_least', value: 80 }] },
      { to: 'open', mode: 'auto' },
      { to: 'chosen', mode: 'choice', label: 'Move on' },
    ],
  })

  it('never takes a resolve edge automatically — ending a scene needs an observed finish', () => {
    expect(nextAutoEdge(branching, ctx({ arousal: 90 }))?.to).not.toBe(RESOLVE_STAGE)
  })

  it('takes the first auto edge whose conditions actually hold', () => {
    expect(nextAutoEdge(branching, ctx({ arousal: 90 }))?.to).toBe('gated')
    expect(nextAutoEdge(branching, ctx({ arousal: 10 }))?.to).toBe('open')
  })

  it('never takes a choice edge automatically', () => {
    const onlyChoices = stage({ edges: [{ to: 'chosen', mode: 'choice', label: 'Move on' }] })
    expect(nextAutoEdge(onlyChoices, ctx())).toBeUndefined()
    expect(eligibleChoiceEdges(onlyChoices, ctx())).toHaveLength(1)
  })

  it('offers only the choice edges whose conditions currently hold', () => {
    const gatedChoice = stage({
      edges: [
        { to: 'a', mode: 'choice', label: 'A' },
        { to: 'b', mode: 'choice', label: 'B', conditions: [{ kind: 'arousal_at_least', value: 80 }] },
      ],
    })
    expect(eligibleChoiceEdges(gatedChoice, ctx({ arousal: 10 })).map((e) => e.to)).toEqual(['a'])
    expect(eligibleChoiceEdges(gatedChoice, ctx({ arousal: 90 })).map((e) => e.to)).toEqual(['a', 'b'])
  })

  it('finds a resolve edge only when its own conditions hold', () => {
    expect(resolveEdge(branching, ctx())?.to).toBe(RESOLVE_STAGE)
    const gatedResolve = stage({ edges: [{ to: RESOLVE_STAGE, mode: 'auto', conditions: [{ kind: 'arousal_at_least', value: 80 }] }] })
    expect(resolveEdge(gatedResolve, ctx({ arousal: 10 }))).toBeUndefined()
    expect(resolveEdge(gatedResolve, ctx({ arousal: 90 }))).toBeDefined()
  })

  it('never treats a choice-mode resolve edge as one an observed finish can take on its own', () => {
    // How a scene ends is the player's decision when the author marked it one, so this has to stay
    // out of the automatic path and go through `buildPendingChoice` instead.
    const chosenEnding = stage({
      edges: [
        { to: RESOLVE_STAGE, mode: 'choice', label: 'End it here' },
        { to: RESOLVE_STAGE, mode: 'choice', label: 'End it differently' },
      ],
    })
    expect(resolveEdge(chosenEnding, ctx({ arousal: 90 }))).toBeUndefined()
    expect(eligibleChoiceEdges(chosenEnding, ctx({ arousal: 90 }))).toHaveLength(2)
  })
})

describe('buildPendingChoice', () => {
  const branch = stage({
    edges: [
      { to: 'a', mode: 'choice', label: 'Option A', entryId: 'pos-missionary' },
      { to: 'b', mode: 'choice', label: 'Option B', isDefault: true },
      { to: 'c', mode: 'choice', label: 'Option C', conditions: [{ kind: 'arousal_at_least', value: 80 }] },
    ],
  })

  it('offers only the options whose conditions currently hold', () => {
    expect(buildPendingChoice(branch, ctx({ arousal: 10 }), 5)?.options.map((o) => o.edgeTo)).toEqual(['a', 'b'])
    expect(buildPendingChoice(branch, ctx({ arousal: 90 }), 5)?.options.map((o) => o.edgeTo)).toEqual(['a', 'b', 'c'])
  })

  it('carries the catalog entry an option moves the scene into', () => {
    expect(buildPendingChoice(branch, ctx(), 5)?.options[0].entryId).toBe('pos-missionary')
  })

  it('raises nothing when there is no actual decision to make', () => {
    const single = stage({ edges: [{ to: 'a', mode: 'choice', label: 'A' }] })
    expect(buildPendingChoice(single, ctx(), 5)).toBeUndefined()
    expect(buildPendingChoice(stage(), ctx(), 5)).toBeUndefined()
    // Two authored options, but only one of them currently eligible.
    const gated = stage({
      edges: [
        { to: 'a', mode: 'choice', label: 'A' },
        { to: 'b', mode: 'choice', label: 'B', conditions: [{ kind: 'arousal_at_least', value: 80 }] },
      ],
    })
    expect(buildPendingChoice(gated, ctx({ arousal: 10 }), 5)).toBeUndefined()
  })

  it('marks the authored default, falling back to the first option when none is marked', () => {
    // Identified by option id, not by target: two options can share a target, so a target-only
    // default would be ambiguous about which of them it meant.
    expect(buildPendingChoice(branch, ctx(), 5)?.defaultOptionId).toBe('here:1')
    const unmarked = stage({
      edges: [
        { to: 'a', mode: 'choice', label: 'Option A' },
        { to: 'b', mode: 'choice', label: 'Option B' },
      ],
    })
    expect(buildPendingChoice(unmarked, ctx(), 5)?.defaultOptionId).toBe('here:0')
  })

  it('stamps the turn it was raised, for its own timer', () => {
    expect(buildPendingChoice(branch, ctx(), 5)?.sinceTurn).toBe(5)
  })
})

describe('choiceDefaultDue', () => {
  const choice = {
    fromStage: 'a',
    options: [{ id: 'a:0', edgeTo: 'b', label: 'B' }],
    defaultOptionId: 'a:0',
    sinceTurn: 5,
  }

  it('only comes due after the branch has sat for a few turns', () => {
    expect(choiceDefaultDue(choice, 5 + CHOICE_DEFAULT_AFTER_TURNS - 1)).toBe(false)
    expect(choiceDefaultDue(choice, 5 + CHOICE_DEFAULT_AFTER_TURNS)).toBe(true)
  })

  it('never comes due for a branch with no default to fall back on', () => {
    expect(choiceDefaultDue({ ...choice, defaultOptionId: undefined }, 99)).toBe(false)
  })

  it("honours a pre-`defaultOptionId` branch's target-only default, so one open across an upgrade still times out", () => {
    const legacy = { fromStage: 'a', options: [{ id: 'a:0', edgeTo: 'b', label: 'B' }], defaultEdgeTo: 'b', sinceTurn: 5 }
    expect(choiceDefaultDue(legacy, 5 + CHOICE_DEFAULT_AFTER_TURNS)).toBe(true)
  })
})

describe('stageOverstayed', () => {
  it('only fires past an authored soft cap', () => {
    expect(stageOverstayed(stage({ softMaxTurns: 3 }), 4)).toBe(true)
    expect(stageOverstayed(stage({ softMaxTurns: 3 }), 3)).toBe(false)
    expect(stageOverstayed(stage(), 99)).toBe(false)
  })
})

describe('phaseForStageKind', () => {
  it('maps the structural kinds onto the legacy two-phase read', () => {
    expect(phaseForStageKind('opening')).toBe('building')
    expect(phaseForStageKind('foreplay')).toBe('building')
    expect(phaseForStageKind('oral')).toBe('peak')
    expect(phaseForStageKind('penetrative')).toBe('peak')
    expect(phaseForStageKind('climax')).toBe('peak')
  })
})

describe('validateScenarioGraph', () => {
  const valid = (stages: IntimacyStage[], entry = 'a'): ScenarioGraph => ({ id: 'g', version: 1, title: 'G', entryStage: entry, stages })

  it('passes the built-in scenario', () => {
    expect(validateScenarioGraph(DEFAULT_SCENARIO)).toEqual([])
  })

  it('rejects an entry stage that is not in the graph', () => {
    const graph = valid([stage({ id: 'b', edges: [{ to: RESOLVE_STAGE, mode: 'auto' }] })])
    expect(validateScenarioGraph(graph).some((p) => p.includes('entry stage'))).toBe(true)
  })

  it('rejects an edge to a stage that does not exist', () => {
    const graph = valid([stage({ id: 'a', edges: [{ to: 'nowhere', mode: 'auto' }, { to: RESOLVE_STAGE, mode: 'auto' }] })])
    expect(validateScenarioGraph(graph).some((p) => p.includes('unknown stage "nowhere"'))).toBe(true)
  })

  it('rejects a dead-end stage with no way out', () => {
    const graph = valid([
      stage({ id: 'a', edges: [{ to: 'b', mode: 'auto' }, { to: RESOLVE_STAGE, mode: 'auto' }] }),
      stage({ id: 'b', edges: [] }),
    ])
    expect(validateScenarioGraph(graph).some((p) => p.includes('dead end'))).toBe(true)
  })

  it('rejects a stage whose only way out is a lone choice edge — never offered, so never taken', () => {
    const graph = valid([
      stage({ id: 'a', edges: [{ to: 'b', mode: 'auto' }, { to: RESOLVE_STAGE, mode: 'auto' }] }),
      stage({ id: 'b', edges: [{ to: 'a', mode: 'choice', label: 'Back' }] }),
    ])
    expect(validateScenarioGraph(graph).some((p) => p.includes('can never be left'))).toBe(true)
  })

  it('accepts a stage whose choice edges are a real decision, or which also has an auto way out', () => {
    const twoOptions = valid([
      stage({ id: 'a', edges: [{ to: 'b', mode: 'auto' }, { to: RESOLVE_STAGE, mode: 'auto' }] }),
      stage({ id: 'b', edges: [{ to: 'a', mode: 'choice', label: 'Back' }, { to: RESOLVE_STAGE, mode: 'choice', label: 'Stop' }] }),
    ])
    expect(validateScenarioGraph(twoOptions)).toEqual([])
    const alsoAuto = valid([
      stage({ id: 'a', edges: [{ to: 'b', mode: 'auto' }, { to: RESOLVE_STAGE, mode: 'auto' }] }),
      stage({ id: 'b', edges: [{ to: 'a', mode: 'choice', label: 'Back' }, { to: RESOLVE_STAGE, mode: 'auto' }] }),
    ])
    expect(validateScenarioGraph(alsoAuto)).toEqual([])
  })

  it('rejects a stage nothing can reach', () => {
    const graph = valid([
      stage({ id: 'a', edges: [{ to: RESOLVE_STAGE, mode: 'auto' }] }),
      stage({ id: 'orphan', edges: [{ to: 'a', mode: 'auto' }] }),
    ])
    expect(validateScenarioGraph(graph).some((p) => p.includes('unreachable'))).toBe(true)
  })

  it('rejects a graph with no way to ever end a scene', () => {
    const graph = valid([stage({ id: 'a', edges: [{ to: 'a', mode: 'auto' }] })])
    expect(validateScenarioGraph(graph).some((p) => p.includes('no edge to "resolve"'))).toBe(true)
  })

  it('rejects a duplicate stage id and an unlabelled choice edge', () => {
    const graph = valid([
      stage({ id: 'a', edges: [{ to: RESOLVE_STAGE, mode: 'auto' }, { to: 'a', mode: 'choice' }] }),
      stage({ id: 'a', edges: [{ to: RESOLVE_STAGE, mode: 'auto' }] }),
    ])
    const problems = validateScenarioGraph(graph)
    expect(problems.some((p) => p.includes('duplicate stage id'))).toBe(true)
    expect(problems.some((p) => p.includes('no player-facing label'))).toBe(true)
  })

  it('rejects a condition kind the engine has no way to evaluate', () => {
    const graph = valid([
      stage({
        id: 'a',
        // Exactly what an imported scenario file could contain, which is why this is caught at all.
        edges: [{ to: RESOLVE_STAGE, mode: 'auto', conditions: [{ kind: 'vibes_at_least', value: 3 } as never] }],
      }),
    ])
    expect(validateScenarioGraph(graph).some((p) => p.includes('unknown condition'))).toBe(true)
  })
})

describe('DEFAULT_SCENARIO', () => {
  it('crosses into its peak at the same arousal the phase used to be read from', () => {
    const building = stageById(DEFAULT_SCENARIO, 'building')!
    expect(nextAutoEdge(building, ctx({ arousal: 77 }))).toBeUndefined()
    expect(nextAutoEdge(building, ctx({ arousal: 78 }))?.to).toBe('peak')
  })

  it('cools back out of its peak when arousal falls away', () => {
    const peak = stageById(DEFAULT_SCENARIO, 'peak')!
    expect(nextAutoEdge(peak, ctx({ arousal: 90 }))).toBeUndefined()
    expect(nextAutoEdge(peak, ctx({ arousal: 40 }))?.to).toBe('building')
  })

  it('can only resolve from its peak', () => {
    expect(resolveEdge(stageById(DEFAULT_SCENARIO, 'building')!, ctx({ arousal: 90 }))).toBeUndefined()
    expect(resolveEdge(stageById(DEFAULT_SCENARIO, 'peak')!, ctx({ arousal: 90 }))).toBeDefined()
  })
})
