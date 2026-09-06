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
  /**
   * A consequence-chain condition: holds once another rule (by id) has fired — either earlier in
   * this SAME evaluation pass (author order matters — a rule can only reference one earlier in the
   * list), or on a previous turn, via `alreadyFired`. Exists so a deliberate chain ("a jealousy
   * flag from one scene feeds a later trust rule") doesn't require the author to also invent and
   * keep in sync a redundant `set_flag` just to make the first rule's firing checkable — see
   * `evaluateTriggers`'s own comment for exactly how `firedTriggerIds` is assembled. Only ever true
   * for a one-shot (non-repeatable) rule: a repeatable rule's firing is never remembered past the
   * instant it fires, so referencing one here can only ever catch it within the same pass.
   */
  | { kind: 'trigger_fired'; triggerId: string }

export type TriggerAction =
  /** Sets a scene flag, exactly as the AI classifier can — so gallery entries, outfits, and other triggers can all gate on an authored beat. */
  | { kind: 'set_flag'; flag: string }
  /** Writes a durable `ChatFact`, which then rides into every later prompt through the existing "Remembered facts" lorebook. The one action that changes what the model knows. */
  | { kind: 'remember'; text: string }
  /** Tells the player something happened. Purely informational; never touches state. */
  | { kind: 'notify'; text: string }
  /**
   * A named person from the character's own authored `socialConnections` — someone real to this
   * world who isn't actually in the scene — has heard about `topic` and reacted. Deterministic code
   * (`world/ambientEvents.ts`'s `selectSocialReaction`) picks which connection, keeping this data-
   * grounded rather than an invented NPC; the model only ever writes the actual line, same split as
   * every other authored hook in this app. See that module for the exact call site this reaches the
   * prompt through (a `ChatFact`, the same durable channel `remember` above already uses).
   */
  | { kind: 'social_reaction'; topic: string }
  /**
   * A free-text steer folded directly into the live per-turn `styleGuidance` channel — the same
   * channel `ambientEventGuidance`/`sceneProgressionNudge` already write into (see
   * `useChatSession.ts`'s prompt assembly). Distinct from `notify` (player-facing only, touches
   * nothing the model sees) and from `remember` (a durable, permanent `ChatFact`): this exists for
   * a bounded, situational tone shift that shouldn't need a whole new mechanical gate invented for
   * it — e.g. "a gift offered right now reads as suspicious or overcompensating, not simply
   * generous" while a jealousy flare is genuinely running hot, without actually locking the gift
   * catalog itself (that logic lives in `dating/gifts.ts`, outside what a world-authored rule can
   * reach).
   *
   * The "bounded window" comes for free from how `evaluateTriggers` already works, not from any new
   * expiry-timer state: pair this action with a `repeatable: true` trigger whose `when` condition is
   * itself something that naturally rises and falls (a relationship dimension like `tension`, or a
   * `flag_set` combined with a `day_at_least` range) and the steer is only ever live while that
   * condition actually holds, re-checked fresh every turn. A one-shot rule instead surfaces this
   * exactly once, as a single-turn callout rather than a window at all.
   */
  | { kind: 'style_guidance'; text: string }

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
  /**
   * Ids of rules already known to have fired — for `trigger_fired` conditions. Callers never need
   * to assemble this themselves: `evaluateTriggers` always overwrites it per-trigger with the right
   * running set (previously-fired ids plus whichever rules already fired earlier in the same pass),
   * so this is safe to simply omit when calling `conditionHolds`/`triggerSatisfied` directly (as
   * every existing call site does) — it only matters to `evaluateTriggers` itself.
   */
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
      // Undefined means no world clock at all, which can never satisfy a day condition — as
      // opposed to day 0, which legitimately satisfies `day_at_least: 0`.
      return ctx.day !== undefined && ctx.day >= condition.day
    case 'trigger_fired':
      return !!ctx.firedTriggerIds?.has(condition.triggerId)
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
    // `firedIds` at this exact point already holds every previous-turn one-shot fire (from
    // `alreadyFired`) plus every one-shot rule that already fired earlier in THIS pass (added
    // below, in author order) — exactly what a `trigger_fired` condition needs to see. Rebuilt
    // per-trigger (a plain object spread, not a mutation of the caller's own `ctx`) so this stays
    // pure like every other condition here.
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
