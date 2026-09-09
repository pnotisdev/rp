import { describe, expect, it } from 'vitest'
import {
  BRANCHING_SCENARIO,
  BUILT_IN_SCENARIOS,
  getScenarioCatalog,
  parseScenarioGraph,
  scenarioById,
  selectScenario,
  successorScenario,
  validateScenarioSource,
  type ScenarioSelectionContext,
} from './scenarios'
import { DEFAULT_SCENARIO, RESOLVE_STAGE, validateScenarioGraph, type ScenarioGraph } from './intimacyStages'

const ctx = (overrides: Partial<ScenarioSelectionContext> = {}): ScenarioSelectionContext => ({
  arousal: 0,
  intimacyLevel: 'explicit',
  relationship: {
    affection: 60,
    warmth: 60,
    stats: {},
    flags: new Set<string>(),
    commitmentStatus: 'dating',
  },
  ...overrides,
})

const minimal = (overrides: Partial<ScenarioGraph> = {}): ScenarioGraph => ({
  id: 'x',
  version: 1,
  title: 'X',
  entryStage: 'a',
  stages: [{ id: 'a', kind: 'foreplay', minArousal: 0, minTurns: 0, edges: [{ to: RESOLVE_STAGE, mode: 'auto' }] }],
  ...overrides,
})

describe('built-in scenarios', () => {
  it('are all structurally valid', () => {
    for (const graph of BUILT_IN_SCENARIOS) expect(validateScenarioGraph(graph)).toEqual([])
  })

  it('gate sparingly — the branching scene asks twice, not every turn', () => {
    const gates = BRANCHING_SCENARIO.stages.filter((stage) => stage.edges.some((edge) => edge.mode === 'choice'))
    expect(gates).toHaveLength(2)
  })

  it('never lets the branching scene reach its end without passing through the middle of it', () => {
    // Nothing routes to `finish` except `together`, so a scene cannot skip the body of it.
    const into = BRANCHING_SCENARIO.stages.filter((stage) => stage.edges.some((edge) => edge.to === 'finish'))
    expect(into.map((stage) => stage.id)).toEqual(['together'])
  })
})

describe('selectScenario', () => {
  it('picks the most specific scenario actually on offer', () => {
    expect(selectScenario(BUILT_IN_SCENARIOS, ctx()).id).toBe(BRANCHING_SCENARIO.id)
  })

  it('falls back to the open scene below the content dial it needs', () => {
    expect(selectScenario(BUILT_IN_SCENARIOS, ctx({ intimacyLevel: 'suggestive' })).id).toBe(DEFAULT_SCENARIO.id)
    expect(selectScenario(BUILT_IN_SCENARIOS, ctx({ intimacyLevel: 'default' })).id).toBe(DEFAULT_SCENARIO.id)
  })

  it('falls back to the open scene when the relationship does not meet its eligibility', () => {
    const single = ctx()
    single.relationship!.commitmentStatus = 'none'
    expect(selectScenario(BUILT_IN_SCENARIOS, single).id).toBe(DEFAULT_SCENARIO.id)
  })

  it('never fails to find a shape, even with nothing eligible in the catalog', () => {
    expect(selectScenario([], ctx()).id).toBe(DEFAULT_SCENARIO.id)
  })

  it("prefers a world's own more-specific scenario over a built-in", () => {
    const custom = minimal({
      id: 'world-one',
      minDetailLevel: 'explicit',
      eligibility: [
        { kind: 'commitment_at_least', status: 'dating' },
        { kind: 'stat_at_least', stat: 'affection', value: 50 },
      ],
    })
    expect(selectScenario([...BUILT_IN_SCENARIOS, custom], ctx()).id).toBe('world-one')
  })
})

describe('getScenarioCatalog', () => {
  it('is additive — a world adds shapes rather than replacing the built-ins', () => {
    const custom = minimal({ id: 'world-one' })
    const catalog = getScenarioCatalog({ scenarios: [custom] })
    expect(catalog).toHaveLength(BUILT_IN_SCENARIOS.length + 1)
    expect(catalog.some((g) => g.id === DEFAULT_SCENARIO.id)).toBe(true)
  })

  it('is just the built-ins for a world with none of its own', () => {
    expect(getScenarioCatalog(undefined)).toEqual(BUILT_IN_SCENARIOS)
    expect(getScenarioCatalog({ scenarios: [] })).toEqual(BUILT_IN_SCENARIOS)
  })
})

describe('scenarioById', () => {
  it('finds a live scene the graph it recorded', () => {
    expect(scenarioById(BUILT_IN_SCENARIOS, BRANCHING_SCENARIO.id).id).toBe(BRANCHING_SCENARIO.id)
  })

  it('falls back to the open scene for a scenario that is gone, or a scene from before scenarios existed', () => {
    expect(scenarioById(BUILT_IN_SCENARIOS, 'deleted-world-scenario').id).toBe(DEFAULT_SCENARIO.id)
    expect(scenarioById(BUILT_IN_SCENARIOS, undefined).id).toBe(DEFAULT_SCENARIO.id)
  })
})

describe('successorScenario', () => {
  const next = minimal({ id: 'after' })

  it('follows the first successor whose conditions hold and which is itself on offer', () => {
    const graph = minimal({ successors: [{ scenarioId: 'after' }] })
    expect(successorScenario(graph, [graph, next], ctx())?.id).toBe('after')
  })

  it('skips a successor whose own conditions do not hold', () => {
    const graph = minimal({ successors: [{ scenarioId: 'after', conditions: [{ kind: 'arousal_at_least', value: 90 }] }] })
    expect(successorScenario(graph, [graph, next], ctx({ arousal: 10 }))).toBeUndefined()
  })

  it('skips a successor the content dial does not allow', () => {
    const gated = minimal({ id: 'after', minDetailLevel: 'explicit' })
    const graph = minimal({ successors: [{ scenarioId: 'after' }] })
    expect(successorScenario(graph, [graph, gated], ctx({ intimacyLevel: 'suggestive' }))).toBeUndefined()
  })

  it('is undefined for a scenario that names none, or names one that is not in the catalog', () => {
    expect(successorScenario(minimal(), BUILT_IN_SCENARIOS, ctx())).toBeUndefined()
    expect(successorScenario(minimal({ successors: [{ scenarioId: 'nowhere' }] }), BUILT_IN_SCENARIOS, ctx())).toBeUndefined()
  })
})

describe('validateScenarioSource', () => {
  it('accepts a well-formed scenario', () => {
    expect(validateScenarioSource(minimal())).toEqual([])
    expect(validateScenarioSource(BRANCHING_SCENARIO)).toEqual([])
  })

  it('rejects something that is not an object at all', () => {
    expect(validateScenarioSource(null)).toEqual(['not an object'])
    expect(validateScenarioSource([minimal()])).toEqual(['not an object'])
    expect(validateScenarioSource('{}')).toEqual(['not an object'])
  })

  it('rejects a missing id, title, entry stage, or unsupported version', () => {
    const problems = validateScenarioSource({ stages: [] })
    expect(problems).toContain('missing id')
    expect(problems).toContain('missing title')
    expect(problems).toContain('missing entryStage')
    expect(problems).toContain('unsupported version — expected 1')
  })

  it('rejects a future version rather than loading it hopefully', () => {
    expect(validateScenarioSource({ ...minimal(), version: 2 })).toContain('unsupported version — expected 1')
  })

  it('rejects malformed stages and edges before reading the graph rules', () => {
    expect(validateScenarioSource({ ...minimal(), stages: 'nope' })).toContain('stages must be an array')
    expect(validateScenarioSource({ ...minimal(), stages: [{ id: 'a', kind: 'foreplay', edges: [] }] })).toContain(
      'stage 0 is missing its floors',
    )
    const badEdge = { ...minimal(), stages: [{ id: 'a', kind: 'foreplay', minArousal: 0, minTurns: 0, edges: [{ to: 'b' }] }] }
    expect(validateScenarioSource(badEdge)).toContain('stage 0 edge 0 has an unknown mode')
  })

  it('still applies the graph rules once the shape is sound', () => {
    const unreachable = {
      ...minimal(),
      stages: [
        { id: 'a', kind: 'foreplay', minArousal: 0, minTurns: 0, edges: [{ to: RESOLVE_STAGE, mode: 'auto' }] },
        { id: 'orphan', kind: 'foreplay', minArousal: 0, minTurns: 0, edges: [{ to: 'a', mode: 'auto' }] },
      ],
    }
    expect(validateScenarioSource(unreachable).some((p) => p.includes('unreachable'))).toBe(true)
  })

  it('rejects an eligibility or successor condition the engine cannot evaluate', () => {
    expect(validateScenarioSource({ ...minimal(), eligibility: [{ kind: 'vibes_at_least', value: 2 }] }).some((p) => p.includes('eligibility uses unknown condition'))).toBe(true)
    expect(
      validateScenarioSource({ ...minimal(), successors: [{ scenarioId: 'after', conditions: [{ kind: 'nope' }] }] }).some((p) =>
        p.includes('uses unknown condition'),
      ),
    ).toBe(true)
  })
})

describe('parseScenarioGraph', () => {
  it('returns the graph for a valid source', () => {
    const parsed = parseScenarioGraph(minimal())
    expect('graph' in parsed && parsed.graph.id).toBe('x')
  })

  it('returns the reasons for an invalid one, and never a half-usable graph', () => {
    const parsed = parseScenarioGraph({ id: 'broken' })
    expect('problems' in parsed).toBe(true)
    expect('graph' in parsed).toBe(false)
  })
})
