import { BAND_FLOORS } from '@/lib/dating/arousal'
import type { IntimacyDetailLevel } from '@/lib/store/useSettingsStore'
import type { IntimacyCategory } from '@/lib/dating/intimacyCatalog'
import { conditionHolds, type TriggerCondition, type TriggerContext } from '@/lib/world/triggers'

/**
 * What is physically happening in a scene, as a node in a per-scenario directed graph — the axis
 * `arousal.ts` is not. Intensity is the continuous meter; this is the discrete shape of the scene,
 * and the engine owns both. The model never names a stage, never picks an edge, and cannot reach one
 * the graph won't route to.
 *
 * Same constraint as `world/triggers.ts`, deliberately: a closed condition vocabulary over state the
 * app already computes, not a scripting language. A scenario can decide *when* something happens; it
 * can never express a state the engine has no way to reason about. `StageCondition` is a literal
 * superset of `TriggerCondition` so the two share this module's evaluator rather than drifting apart.
 */

/** Structural role of a stage, for engine logic only — the content lives in the authored catalog entries.
 *  There is deliberately no `aftercare` kind: aftercare is not a stage (see `RESOLVE_STAGE`). */
export type IntimacyStageKind = 'opening' | 'foreplay' | 'oral' | 'penetrative' | 'climax'

/** Reserved edge target that ends the scene. Traversing it returns `null` from the scene machine, and
 *  `aftercare.ts`'s already-open window carries the aftermath — modelling that as a node would give two
 *  systems a say in when a scene ended. */
export const RESOLVE_STAGE = 'resolve'

export type StageCondition =
  | TriggerCondition
  | { kind: 'arousal_at_least'; value: number }
  | { kind: 'arousal_below'; value: number }
  | { kind: 'stage_visited'; stage: string }
  | { kind: 'inventory_has'; itemId: string }
  /** `kink` is a bare string until the kink profile lands and can supply a real id union. */
  | { kind: 'kink_not_limited'; kink: string }
  | { kind: 'kink_at_least'; kink: string; valence: number }

export interface StageEdge {
  /** A stage id in this graph, or `RESOLVE_STAGE` to end the scene. */
  to: string
  /** `auto` traverses on its own once conditions hold; `choice` waits to be offered to the player. */
  mode: 'auto' | 'choice'
  /** Player-facing label, required in practice for a `choice` edge. */
  label?: string
  /** Catalog entry this edge moves the scene into, so taking it reuses the existing clicked-action path. */
  entryId?: string
  /** Fires on its own if the player leaves a choice sitting. One per stage; the first eligible option is used when none is marked. */
  isDefault?: boolean
  /** Every condition must hold. Empty/absent means the edge is gated only by its stage's own floors. */
  conditions?: StageCondition[]
}

/**
 * A branch the scene has reached and will not cross on its own. While one of these is open the stage
 * cannot advance — the player picks, or the default fires after a few turns so a scene can never
 * deadlock waiting on someone who has moved on to something else.
 */
export interface PendingChoice {
  fromStage: string
  /** Only edges whose conditions currently hold — a limit or an unmet gate simply doesn't appear. */
  options: { edgeTo: string; label: string; entryId?: string }[]
  defaultEdgeTo?: string
  /** Turn the branch was raised, for the default's own timer. */
  sinceTurn: number
}

/** Character replies a branch can sit unanswered before its default fires. */
export const CHOICE_DEFAULT_AFTER_TURNS = 3

export interface IntimacyStage {
  id: string
  kind: IntimacyStageKind
  /** Catalog categories selectable while in this stage. Empty means no restriction. */
  allowedCategories?: IntimacyCategory[]
  /** Arousal floor before any exit edge may fire. */
  minArousal: number
  /** Turns this stage must hold regardless of arousal — what kills "straight to the end". */
  minTurns: number
  /** Soft cap; past this the scene is nudged toward an exit rather than blocked from staying. */
  softMaxTurns?: number
  /** Per-turn passive arousal drift while engaged in this stage. Unset uses the meter's own default. */
  passiveGain?: number
  edges: StageEdge[]
}

export interface ScenarioGraph {
  id: string
  version: 1
  title: string
  entryStage: string
  stages: IntimacyStage[]
  /** Which situations this scenario is offered in at all. Empty/absent means always eligible. */
  eligibility?: StageCondition[]
  /** Scenarios that may follow this one when it resolves, best match by conditions, first eligible wins. */
  successors?: { scenarioId: string; conditions?: StageCondition[] }[]
  /** Content dial floor — a scenario can require the explicit tier to be offered at all. */
  minDetailLevel?: IntimacyDetailLevel
}

/** Everything a `StageCondition` can read. The relationship half is a `TriggerContext`, unchanged, so
 *  the shared condition kinds evaluate identically here and in a world's own trigger rules. */
export interface StageContext {
  arousal: number
  visitedStages?: readonly string[]
  ownedItemIds?: ReadonlySet<string>
  /** Kink id → valence, once profiles exist. Absent means nothing is known, not that everything is allowed. */
  kinks?: Readonly<Record<string, number>>
  /** Relationship state, when the caller has it. A shared-kind condition can never hold without it. */
  relationship?: TriggerContext
}

const SHARED_KINDS = new Set(['stat_at_least', 'stat_below', 'flag_set', 'commitment_at_least', 'day_at_least', 'trigger_fired'])

export function stageConditionHolds(condition: StageCondition, ctx: StageContext): boolean {
  switch (condition.kind) {
    case 'arousal_at_least':
      return ctx.arousal >= condition.value
    case 'arousal_below':
      return ctx.arousal < condition.value
    case 'stage_visited':
      return !!ctx.visitedStages?.includes(condition.stage)
    case 'inventory_has':
      return !!ctx.ownedItemIds?.has(condition.itemId)
    case 'kink_not_limited':
      // Unknown is permissive here and restrictive below: nothing on record is not a stated limit,
      // but it is also not stated enthusiasm.
      return (ctx.kinks?.[condition.kink] ?? 0) > -2
    case 'kink_at_least':
      return (ctx.kinks?.[condition.kink] ?? 0) >= condition.valence
    default:
      // Shared with `triggers.ts` — evaluated by that module so the two can never disagree.
      return !!ctx.relationship && conditionHolds(condition, ctx.relationship)
  }
}

export function stageConditionsMet(conditions: StageCondition[] | undefined, ctx: StageContext): boolean {
  return (conditions ?? []).every((condition) => stageConditionHolds(condition, ctx))
}

export function stageById(graph: ScenarioGraph, id: string | undefined): IntimacyStage | undefined {
  return graph.stages.find((stage) => stage.id === id)
}

/** Whether the stage's own floors are clear — checked before any edge, and before the judge's completion vote. */
export function stageFloorsMet(stage: IntimacyStage, turnsInStage: number, arousal: number): boolean {
  return turnsInStage >= stage.minTurns && arousal >= stage.minArousal
}

function edgesOfMode(stage: IntimacyStage, mode: StageEdge['mode'], ctx: StageContext): StageEdge[] {
  return stage.edges.filter((edge) => edge.mode === mode && stageConditionsMet(edge.conditions, ctx))
}

/**
 * The auto edge to take, or `undefined` to stay put. An edge to `RESOLVE_STAGE` is never taken on its
 * own: ending a scene needs the judge to have observed it actually finishing, which the caller weighs
 * separately. Everything else transitions on thresholds and floors alone.
 */
export function nextAutoEdge(stage: IntimacyStage, ctx: StageContext): StageEdge | undefined {
  return edgesOfMode(stage, 'auto', ctx).find((edge) => edge.to !== RESOLVE_STAGE)
}

/**
 * The resolve edge an observed finish is allowed to take, if this stage has one whose conditions
 * currently hold. Deliberately `auto`-only: a `choice`-mode resolve edge is a decision the player
 * owns (how a scene ends, with consequences attached), so it is offered through `buildPendingChoice`
 * and traversed only by an actual answer. Without the mode filter here, a judge reporting
 * `stageCompleteSignalled` on a closing stage would end the scene before the branch was ever raised
 * — the model drifting past a gate, which is the one thing gating it was for.
 */
export function resolveEdge(stage: IntimacyStage, ctx: StageContext): StageEdge | undefined {
  return stage.edges.find(
    (edge) => edge.to === RESOLVE_STAGE && edge.mode === 'auto' && stageConditionsMet(edge.conditions, ctx),
  )
}

/** Choice edges whose conditions hold — what the blocking-choice UI will offer. Nothing traverses these automatically. */
export function eligibleChoiceEdges(stage: IntimacyStage, ctx: StageContext): StageEdge[] {
  return edgesOfMode(stage, 'choice', ctx)
}

/** The branch to raise at this stage, or `undefined` when there's nothing to ask. */
export function buildPendingChoice(stage: IntimacyStage, ctx: StageContext, charReplyCount: number): PendingChoice | undefined {
  const edges = eligibleChoiceEdges(stage, ctx)
  // One option is not a decision — it's a transition the author should have marked `auto`.
  if (edges.length < 2) return undefined
  return {
    fromStage: stage.id,
    options: edges.map((edge) => ({ edgeTo: edge.to, label: edge.label ?? edge.to, entryId: edge.entryId })),
    defaultEdgeTo: (edges.find((edge) => edge.isDefault) ?? edges[0]).to,
    sinceTurn: charReplyCount,
  }
}

/** Whether a raised branch has sat long enough for its default to take over. */
export function choiceDefaultDue(choice: PendingChoice, charReplyCount: number): boolean {
  return !!choice.defaultEdgeTo && charReplyCount - choice.sinceTurn >= CHOICE_DEFAULT_AFTER_TURNS
}

/** Past its soft cap, a stage is overstaying — a nudge, never a block. */
export function stageOverstayed(stage: IntimacyStage, turnsInStage: number): boolean {
  return stage.softMaxTurns !== undefined && turnsInStage > stage.softMaxTurns
}

const PEAK_KINDS: IntimacyStageKind[] = ['oral', 'penetrative', 'climax']

/** The legacy two-phase read, derived from the stage's structural kind. */
export function phaseForStageKind(kind: IntimacyStageKind): 'building' | 'peak' {
  return PEAK_KINDS.includes(kind) ? 'peak' : 'building'
}

const KNOWN_CONDITION_KINDS = new Set([
  ...SHARED_KINDS,
  'arousal_at_least',
  'arousal_below',
  'stage_visited',
  'inventory_has',
  'kink_not_limited',
  'kink_at_least',
])

/**
 * Everything wrong with a graph, as messages — `[]` for a valid one. A malformed scenario has to fail
 * loudly at import rather than mid-scene, so this is deliberately strict about the things that would
 * strand a live scene: a missing entry, an edge to nowhere, a stage nothing can reach, a dead end.
 */
export function validateScenarioGraph(graph: ScenarioGraph): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const stage of graph.stages) {
    if (ids.has(stage.id)) problems.push(`duplicate stage id "${stage.id}"`)
    ids.add(stage.id)
  }
  if (!graph.stages.length) problems.push('graph has no stages')
  if (!ids.has(graph.entryStage)) problems.push(`entry stage "${graph.entryStage}" is not in the graph`)

  for (const condition of graph.eligibility ?? []) {
    if (!KNOWN_CONDITION_KINDS.has(condition.kind)) problems.push(`eligibility uses unknown condition "${condition.kind}"`)
  }
  for (const successor of graph.successors ?? []) {
    if (!successor.scenarioId?.trim()) problems.push('a successor entry names no scenario')
    for (const condition of successor.conditions ?? []) {
      if (!KNOWN_CONDITION_KINDS.has(condition.kind)) problems.push(`successor "${successor.scenarioId}" uses unknown condition "${condition.kind}"`)
    }
  }

  for (const stage of graph.stages) {
    if (!stage.edges.length) problems.push(`stage "${stage.id}" is a dead end — it has no exit edges`)
    // One option is not a decision, so `buildPendingChoice` never raises a lone choice edge. A stage
    // with no auto edge and exactly one choice edge therefore has no way out at all at runtime, which
    // reads as a valid graph on paper and traps a live scene.
    if (!stage.edges.some((edge) => edge.mode === 'auto') && stage.edges.filter((edge) => edge.mode === 'choice').length === 1) {
      problems.push(`stage "${stage.id}" can never be left — a single choice edge is not a decision, so it is never offered`)
    }
    for (const edge of stage.edges) {
      if (edge.to !== RESOLVE_STAGE && !ids.has(edge.to)) problems.push(`stage "${stage.id}" has an edge to unknown stage "${edge.to}"`)
      if (edge.mode === 'choice' && !edge.label?.trim()) problems.push(`a choice edge out of "${stage.id}" has no player-facing label`)
      for (const condition of edge.conditions ?? []) {
        if (!KNOWN_CONDITION_KINDS.has(condition.kind)) problems.push(`stage "${stage.id}" uses unknown condition "${condition.kind}"`)
      }
    }
  }

  // Reachability, so a scenario can't ship a stage no play-through can ever enter.
  const reached = new Set<string>()
  const queue = ids.has(graph.entryStage) ? [graph.entryStage] : []
  while (queue.length) {
    const id = queue.shift()!
    if (reached.has(id)) continue
    reached.add(id)
    for (const edge of stageById(graph, id)?.edges ?? []) {
      if (edge.to !== RESOLVE_STAGE && !reached.has(edge.to)) queue.push(edge.to)
    }
  }
  for (const stage of graph.stages) {
    if (!reached.has(stage.id)) problems.push(`stage "${stage.id}" is unreachable from "${graph.entryStage}"`)
  }
  // A graph with no way out would hold a scene open forever.
  if (!graph.stages.some((stage) => stage.edges.some((edge) => edge.to === RESOLVE_STAGE))) {
    problems.push('no stage can resolve the scene — the graph has no edge to "resolve"')
  }
  return problems
}

/**
 * The graph every scene runs on until scenarios are loadable content. Two stages reproducing the
 * behaviour that came before it exactly: a scene builds, crosses into its peak at the same arousal
 * band the phase used to be read from, cools back out if it stops going anywhere, and resolves only
 * on an observed completion after a turn actually spent at the top.
 */
export const DEFAULT_SCENARIO: ScenarioGraph = {
  id: 'default',
  version: 1,
  title: 'Open scene',
  entryStage: 'building',
  stages: [
    {
      id: 'building',
      kind: 'foreplay',
      minArousal: 0,
      minTurns: 0,
      edges: [{ to: 'peak', mode: 'auto', conditions: [{ kind: 'arousal_at_least', value: BAND_FLOORS.edge }] }],
    },
    {
      id: 'peak',
      kind: 'climax',
      minArousal: 0,
      // One turn actually spent here before a completion vote counts — no one-turn climaxes.
      minTurns: 1,
      softMaxTurns: 6,
      edges: [
        { to: RESOLVE_STAGE, mode: 'auto' },
        { to: 'building', mode: 'auto', conditions: [{ kind: 'arousal_below', value: BAND_FLOORS.edge }] },
      ],
    },
  ],
}
