import { BAND_FLOORS } from '@/lib/dating/arousal'
import {
  DEFAULT_SCENARIO,
  RESOLVE_STAGE,
  stageConditionsMet,
  validateScenarioGraph,
  type ScenarioGraph,
  type StageContext,
} from '@/lib/dating/intimacyStages'
import type { IntimacyDetailLevel } from '@/lib/store/useSettingsStore'

/**
 * Scenarios as content: which shapes a scene can take, chosen per scene from what the relationship
 * and the content dial actually allow. Same "author extends a fixed default set" pattern as
 * `intimacyCatalog.ts` and `DEFAULT_BACKGROUNDS` — a world adds its own without redefining the
 * built-ins, and a malformed one is rejected at import rather than mid-scene.
 *
 * The graphs here carry structure only. Every word the model ever sees still comes from the catalog
 * entry a stage routes into and from the character's own authored voice; a stage id is engine
 * bookkeeping, and an edge label is a button in the Relationship panel.
 */

const DETAIL_ORDER: IntimacyDetailLevel[] = ['fade_to_black', 'suggestive', 'default', 'explicit']

function detailLevelMet(required: IntimacyDetailLevel | undefined, actual: IntimacyDetailLevel): boolean {
  if (!required) return true
  return DETAIL_ORDER.indexOf(actual) >= DETAIL_ORDER.indexOf(required)
}

/**
 * The scene shape the review describes: foreplay, a real decision about where it goes, and a second
 * about how it ends. Deliberately two gates and no more — every turn behind a menu would make this a
 * visual novel rather than an RP client, so everything else moves on the meter and the turn floors.
 *
 * Only offered at the explicit tier and once a relationship is actually established; anyone else gets
 * `DEFAULT_SCENARIO`'s open scene, exactly as before scenarios existed.
 */
export const BRANCHING_SCENARIO: ScenarioGraph = {
  id: 'branching-explicit',
  version: 1,
  title: 'A scene with real turns in it',
  entryStage: 'foreplay',
  minDetailLevel: 'explicit',
  eligibility: [{ kind: 'commitment_at_least', status: 'dating' }],
  stages: [
    {
      id: 'foreplay',
      kind: 'foreplay',
      allowedCategories: ['kissing_spot', 'toy', 'activity'],
      minArousal: 0,
      // Long enough that the first branch can't arrive before the scene has actually begun.
      minTurns: 3,
      softMaxTurns: 8,
      edges: [
        {
          to: 'oral',
          mode: 'choice',
          label: 'Take it slower, with your mouth',
          entryId: 'pos-sixty-nine',
          conditions: [{ kind: 'arousal_at_least', value: BAND_FLOORS.warming }],
        },
        {
          to: 'together',
          mode: 'choice',
          label: 'Move straight on',
          isDefault: true,
          conditions: [{ kind: 'arousal_at_least', value: BAND_FLOORS.warming }],
        },
      ],
    },
    {
      id: 'oral',
      kind: 'oral',
      allowedCategories: ['position', 'activity'],
      minArousal: 0,
      minTurns: 2,
      softMaxTurns: 8,
      edges: [{ to: 'together', mode: 'auto', conditions: [{ kind: 'arousal_at_least', value: BAND_FLOORS.engaged }] }],
    },
    {
      id: 'together',
      kind: 'penetrative',
      allowedCategories: ['position', 'toy', 'activity'],
      minArousal: 0,
      minTurns: 3,
      softMaxTurns: 10,
      edges: [{ to: 'finish', mode: 'auto', conditions: [{ kind: 'arousal_at_least', value: BAND_FLOORS.edge }] }],
    },
    {
      id: 'finish',
      kind: 'climax',
      allowedCategories: ['position', 'activity'],
      minArousal: 0,
      // The edge itself has to be held for a beat before it can be decided on.
      minTurns: 1,
      softMaxTurns: 6,
      edges: [
        { to: RESOLVE_STAGE, mode: 'choice', label: 'Finish together, inside', isDefault: true },
        { to: RESOLVE_STAGE, mode: 'choice', label: 'Pull out first' },
        { to: 'together', mode: 'choice', label: 'Not yet — draw it out' },
      ],
    },
  ],
}

export const BUILT_IN_SCENARIOS: ScenarioGraph[] = [DEFAULT_SCENARIO, BRANCHING_SCENARIO]

/** The built-ins plus this world's own, additive — a world adds shapes rather than replacing the defaults. */
export function getScenarioCatalog(world?: { scenarios?: ScenarioGraph[] }): ScenarioGraph[] {
  return world?.scenarios?.length ? [...BUILT_IN_SCENARIOS, ...world.scenarios] : BUILT_IN_SCENARIOS
}

export interface ScenarioSelectionContext extends StageContext {
  intimacyLevel: IntimacyDetailLevel
}

function isOffered(graph: ScenarioGraph, ctx: ScenarioSelectionContext): boolean {
  return detailLevelMet(graph.minDetailLevel, ctx.intimacyLevel) && stageConditionsMet(graph.eligibility, ctx)
}

/**
 * The scenario a scene about to start should run on: the most specific one that's actually offered,
 * where specificity is how much a scenario asks for. A scenario that requires nothing can never beat
 * one that requires something, so the open-scene fallback only wins when nothing else qualifies —
 * and it always qualifies, so a scene can never fail to find a shape.
 */
export function selectScenario(catalog: ScenarioGraph[], ctx: ScenarioSelectionContext): ScenarioGraph {
  const offered = catalog.filter((graph) => isOffered(graph, ctx))
  const ranked = [...offered].sort((a, b) => specificity(b) - specificity(a))
  return ranked[0] ?? DEFAULT_SCENARIO
}

function specificity(graph: ScenarioGraph): number {
  return (graph.eligibility?.length ?? 0) + (graph.minDetailLevel ? 1 : 0)
}

/** The graph a live scene is already running on, by the id it recorded. Falls back to the open scene. */
export function scenarioById(catalog: ScenarioGraph[], id: string | undefined): ScenarioGraph {
  return catalog.find((graph) => graph.id === id) ?? DEFAULT_SCENARIO
}

/** The first eligible scenario this one names as a follow-on, or `undefined` when it ends here. */
export function successorScenario(
  graph: ScenarioGraph,
  catalog: ScenarioGraph[],
  ctx: ScenarioSelectionContext,
): ScenarioGraph | undefined {
  for (const successor of graph.successors ?? []) {
    if (!stageConditionsMet(successor.conditions, ctx)) continue
    const next = catalog.find((candidate) => candidate.id === successor.scenarioId)
    if (next && isOffered(next, ctx)) return next
  }
  return undefined
}

/**
 * Validates an imported scenario — a `data/scenarios/*.json` file, or one riding along in a world.
 * Structure first (the shape a JSON file can get wrong in ways TypeScript never sees), then the
 * graph's own rules. Returns the problems, `[]` for a scenario that's safe to load.
 */
export function validateScenarioSource(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['not an object']
  const obj = raw as Record<string, unknown>
  const problems: string[] = []
  if (typeof obj.id !== 'string' || !obj.id.trim()) problems.push('missing id')
  if (obj.version !== 1) problems.push('unsupported version — expected 1')
  if (typeof obj.title !== 'string' || !obj.title.trim()) problems.push('missing title')
  if (typeof obj.entryStage !== 'string' || !obj.entryStage.trim()) problems.push('missing entryStage')
  if (!Array.isArray(obj.stages)) return [...problems, 'stages must be an array']
  for (const [i, stage] of (obj.stages as unknown[]).entries()) {
    if (!stage || typeof stage !== 'object') {
      problems.push(`stage ${i} is not an object`)
      continue
    }
    const st = stage as Record<string, unknown>
    if (typeof st.id !== 'string' || !st.id.trim()) problems.push(`stage ${i} has no id`)
    if (typeof st.kind !== 'string') problems.push(`stage ${i} has no kind`)
    if (typeof st.minArousal !== 'number' || typeof st.minTurns !== 'number') problems.push(`stage ${i} is missing its floors`)
    if (!Array.isArray(st.edges)) problems.push(`stage ${i} has no edges array`)
    for (const [j, edge] of ((st.edges as unknown[]) ?? []).entries()) {
      if (!edge || typeof edge !== 'object') {
        problems.push(`stage ${i} edge ${j} is not an object`)
        continue
      }
      const ed = edge as Record<string, unknown>
      if (typeof ed.to !== 'string') problems.push(`stage ${i} edge ${j} has no target`)
      if (ed.mode !== 'auto' && ed.mode !== 'choice') problems.push(`stage ${i} edge ${j} has an unknown mode`)
    }
  }
  // Only worth running the graph rules once the shape is sound enough to read.
  return problems.length ? problems : validateScenarioGraph(obj as unknown as ScenarioGraph)
}

/** An imported scenario, or `undefined` with the reasons it was rejected. Import fails loudly; a scene never sees a broken graph. */
export function parseScenarioGraph(raw: unknown): { graph: ScenarioGraph } | { problems: string[] } {
  const problems = validateScenarioSource(raw)
  return problems.length ? { problems } : { graph: raw as ScenarioGraph }
}
