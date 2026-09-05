import type { CommitmentStatus, RelationshipDimension } from '@/lib/types'
import { COMMITMENT_ORDER } from '@/lib/dating/stage'
import { slugifyId } from '@/lib/text/slugify'

/**
 * Author-defined "when X, then Y" rules, scoped to a world.
 *
 * The app already *produces* every signal an author would want to react to — relationship
 * dimensions, scene flags, the commitment ladder, the world clock — and had no way to hang
 * behaviour off any of them without editing code. That's the whole gap: a world author could
 * write lore and gifts and thresholds, but not "once she trusts him enough, she'll have told him
 * about her father."
 *
 * Deliberately not a scripting language. RisuAI's CBS and AI Dungeon's scenario scripts both go
 * that way and both pay for it in sandboxing, debuggability, and a syntax nobody can read six
 * months later. This is a closed set of conditions over state the app already computes, and a
 * closed set of actions that route into systems that already exist — so a trigger can't do
 * anything the app couldn't already do, it just decides *when*.
 *
 * Evaluation is deterministic and runs after the per-turn relationship update, on state that has
 * already been written. Nothing here calls a model, and nothing here can fail a turn.
 */

/** The numeric signals a condition can test. `warmth` is the derived average (see `stage.ts`), not a stored field. */
export type TriggerStat = 'affection' | 'warmth' | RelationshipDimension

export type TriggerCondition =
  | { kind: 'stat_at_least'; stat: TriggerStat; value: number }
  | { kind: 'stat_below'; stat: TriggerStat; value: number }
  | { kind: 'flag_set'; flag: string }
  | { kind: 'commitment_at_least'; status: CommitmentStatus }
  | { kind: 'day_at_least'; day: number }

export type TriggerAction =
  /** Sets a scene flag, exactly as the AI classifier can — so gallery entries, outfits, and other triggers can all gate on an authored beat. */
  | { kind: 'set_flag'; flag: string }
  /** Writes a durable `ChatFact`, which then rides into every later prompt through the existing "Remembered facts" lorebook. The one action that changes what the model knows. */
  | { kind: 'remember'; text: string }
  /** Tells the player something happened. Purely informational; never touches state. */
  | { kind: 'notify'; text: string }

export interface Trigger {
  id: string
  label: string
  /** Unset counts as enabled — an author disabling one shouldn't require a migration. */
  enabled?: boolean
  /** Every condition must hold. An empty list never fires, rather than firing constantly. */
  when: TriggerCondition[]
  then: TriggerAction[]
  /**
   * Fires again every time the conditions hold, instead of once ever. Off by default, because
   * "once" is what almost every authored beat wants and a repeatable rule that sets a flag or
   * writes a memory would otherwise spam both on every single turn.
   */
  repeatable?: boolean
}

/** Everything a condition can read, assembled once per evaluation by the caller. */
export interface TriggerContext {
  affection: number
  warmth: number
  stats: Partial<Record<RelationshipDimension, number>>
  flags: ReadonlySet<string>
  commitmentStatus: CommitmentStatus
  /** The world clock's current day, or undefined for a character with no world bound — a `day_at_least` condition simply never holds then. */
  day?: number
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
      // Undefined means no world clock at all, which can never satisfy a day condition — as
      // opposed to day 0, which legitimately satisfies `day_at_least: 0`.
      return ctx.day !== undefined && ctx.day >= condition.day
    default:
      // An unknown condition kind (a world authored by a newer build, or hand-edited data) must
      // never hold — silently firing an author's rule on a condition this build cannot evaluate
      // would be worse than not firing it.
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
  /** Their actions, flattened in the same order — what the caller actually applies. */
  actions: TriggerAction[]
  /** The updated fired-id set to persist. Unchanged (same contents) when nothing one-shot fired. */
  firedIds: string[]
}

/**
 * Which triggers fire right now. Pure: the caller applies the actions and persists `firedIds`.
 *
 * A one-shot trigger is remembered by id, so it stays fired across restarts and can't re-fire when
 * a stat dips below its threshold and comes back. Fired ids live on the chat rather than the world,
 * so two chats in the same world progress through its triggers independently — and a fork inherits
 * exactly what the parent had already fired.
 */
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
    if (!triggerSatisfied(trigger, ctx)) continue
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
    default:
      return 'unknown action'
  }
}
