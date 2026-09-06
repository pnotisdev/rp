import type { CommitmentStatus, RelationshipDimension } from '@/lib/types'
import { COMMITMENT_ORDER } from '@/lib/dating/stage'
import { slugifyId } from '@/lib/text/slugify'

/**
 * Author-defined "when X, then Y" rules, scoped to a world: a closed set of conditions over
 * state the app already computes (relationship stats, flags, commitment, world clock), and a
 * closed set of actions routed into existing systems — deliberately not a scripting language.
 * Evaluation is deterministic and runs after the per-turn relationship update; nothing here
 * calls a model or can fail a turn.
 */

/** The numeric signals a condition can test. `warmth` is the derived average (see `stage.ts`), not a stored field. */
export type TriggerStat = 'affection' | 'warmth' | RelationshipDimension

export type TriggerCondition =
  | { kind: 'stat_at_least'; stat: TriggerStat; value: number }
  | { kind: 'stat_below'; stat: TriggerStat; value: number }
  | { kind: 'flag_set'; flag: string }
  | { kind: 'commitment_at_least'; status: CommitmentStatus }
  | { kind: 'day_at_least'; day: number }
  /** Holds once rule `triggerId` has fired — earlier in this same pass, or on a previous turn via `alreadyFired`. Only ever true for one-shot rules. */
  | { kind: 'trigger_fired'; triggerId: string }

export type TriggerAction =
  /** Sets a scene flag, same as the AI classifier can. */
  | { kind: 'set_flag'; flag: string }
  /** Writes a durable `ChatFact` into the "Remembered facts" lorebook — the one action that changes what the model knows. */
  | { kind: 'remember'; text: string }
  /** Tells the player something happened. Purely informational. */
  | { kind: 'notify'; text: string }
  /** A named connection from the character's authored `socialConnections` reacts to `topic`; `world/ambientEvents.ts`'s `selectSocialReaction` picks who. */
  | { kind: 'social_reaction'; topic: string }
  /** A free-text steer folded into the live per-turn `styleGuidance` channel. Pair with `repeatable: true` for a steer that stays live only while its condition holds. */
  | { kind: 'style_guidance'; text: string }

export interface Trigger {
  id: string
  label: string
  /** Unset counts as enabled — an author disabling one shouldn't require a migration. */
  enabled?: boolean
  /** Every condition must hold. An empty list never fires, rather than firing constantly. */
  when: TriggerCondition[]
  then: TriggerAction[]
  /** Fires every time conditions hold, instead of once ever. Off by default. */
  repeatable?: boolean
}

/** Everything a condition can read, assembled once per evaluation by the caller. */
export interface TriggerContext {
  affection: number
  warmth: number
  stats: Partial<Record<RelationshipDimension, number>>
  flags: ReadonlySet<string>
  commitmentStatus: CommitmentStatus
  /** The world clock's current day, or undefined with no world bound. */
  day?: number
  /** Ids already known to have fired. `evaluateTriggers` manages this itself; safe to omit elsewhere. */
  firedTriggerIds?: ReadonlySet<string>
}

function statValue(stat: TriggerStat, ctx: TriggerContext): number {
  if (stat === 'affection') return ctx.affection
  if (stat === 'warmth') return ctx.warmth
  return Number(ctx.stats[stat] ?? 0)
}

export function conditionHolds(condition: TriggerCondition, ctx: TriggerContext): boolean {
  switch (condition.kind) {
    case 'stat_at_least':
      return statValue(condition.stat, ctx) >= condition.value
    case 'stat_below':
      return statValue(condition.stat, ctx) < condition.value
    case 'flag_set':
      return ctx.flags.has(condition.flag)
    case 'commitment_at_least': {
      const have = COMMITMENT_ORDER.indexOf(ctx.commitmentStatus)
      const need = COMMITMENT_ORDER.indexOf(condition.status)
      return have >= 0 && need >= 0 && have >= need
    }
    case 'day_at_least':
      // No world clock (undefined) never satisfies this, unlike day 0 which legitimately does.
      return ctx.day !== undefined && ctx.day >= condition.day
    case 'trigger_fired':
      return !!ctx.firedTriggerIds?.has(condition.triggerId)
    default:
      // Unknown condition kind (newer build's data) must never hold.
      return false
  }
}

/** Whether every one of a trigger's conditions currently holds. An empty condition list is never satisfied. */
export function triggerSatisfied(trigger: Trigger, ctx: TriggerContext): boolean {
  if (trigger.when.length === 0) return false
  return trigger.when.every((c) => conditionHolds(c, ctx))
}

export interface TriggerEvaluation {
  /** Triggers that fired this evaluation, in author order. */
  fired: Trigger[]
  /** Their actions, flattened in the same order. */
  actions: TriggerAction[]
  /** The updated fired-id set to persist. */
  firedIds: string[]
}

/** Which triggers fire right now. Pure: the caller applies the actions and persists `firedIds`. One-shot fires are remembered by id (per chat) so they can't re-fire later. */
export function evaluateTriggers(
  triggers: Trigger[] | undefined,
  ctx: TriggerContext,
  alreadyFired: readonly string[] = [],
): TriggerEvaluation {
  const firedIds = new Set(alreadyFired)
  const fired: Trigger[] = []
  for (const trigger of triggers ?? []) {
    if (trigger.enabled === false) continue
    if (!trigger.repeatable && firedIds.has(trigger.id)) continue
    // firedIds already holds prior-turn fires plus this pass's fires so far — what trigger_fired needs.
    if (!triggerSatisfied(trigger, { ...ctx, firedTriggerIds: firedIds })) continue
    fired.push(trigger)
    if (!trigger.repeatable) firedIds.add(trigger.id)
  }
  return { fired, actions: fired.flatMap((t) => t.then), firedIds: [...firedIds] }
}

/** Turns a free-typed trigger name into a safe, stable id — the id is what "already fired" is remembered by, so it must not change when the label is edited. */
export function slugifyTriggerId(label: string, existingIds: string[]): string {
  return slugifyId(label, existingIds, 'trigger')
}

/** A short human description of a condition, for the editor's summary line. */
export function describeCondition(condition: TriggerCondition): string {
  switch (condition.kind) {
    case 'stat_at_least':
      return `${condition.stat} ≥ ${condition.value}`
    case 'stat_below':
      return `${condition.stat} < ${condition.value}`
    case 'flag_set':
      return `flag "${condition.flag}"`
    case 'commitment_at_least':
      return `at least ${condition.status.replace(/_/g, ' ')}`
    case 'day_at_least':
      return `day ${condition.day}+`
    case 'trigger_fired':
      return `rule "${condition.triggerId}" has already fired`
    default:
      return 'unknown condition'
  }
}

/** A short human description of an action, for the editor's summary line. */
export function describeAction(action: TriggerAction): string {
  switch (action.kind) {
    case 'set_flag':
      return `set flag "${action.flag}"`
    case 'remember':
      return `remember "${action.text}"`
    case 'notify':
      return `notify "${action.text}"`
    case 'social_reaction':
      return `a named connection reacts to "${action.topic}"`
    case 'style_guidance':
      return `steer: "${action.text}"`
    default:
      return 'unknown action'
  }
}
