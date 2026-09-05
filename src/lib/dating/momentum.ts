import type { RelationshipDimension } from '@/lib/types'

/**
 * Relationship *momentum* — the derivative of warmth, not its level. The state model
 * (`RelationshipTrack`) is good at "where is this relationship"; it can't say "how fast is it
 * moving right now", which is what actually governs pacing: a warmth-90 couple in a quiet stretch
 * and a warmth-90 couple mid-whirlwind should not be written the same.
 *
 * Stored as one decayed running number on the track (`Chat.momentum` for the primary). Each turn:
 * `momentum = momentum * DECAY + (this turn's warmth movement)`. The decay makes it forget a burst
 * over ~4-5 quiet turns on its own, so nothing has to actively wind it back down.
 */
export const MOMENTUM_DECAY = 0.65

/** Kept in a sane band — a runaway value would just make every clause say "moving fast" forever. */
const MOMENTUM_CLAMP = 8

/** The dimensions that feed `computeWarmth` (see `stage.ts`) — momentum tracks movement in the same set, so it lines up with the warmth the rest of the app reasons about. `tension` and `curiosity` deliberately don't count. */
const WARMTH_DELTA_KEYS: (RelationshipDimension | 'affection')[] = ['affection', 'trust', 'chemistry', 'comfort', 'respect']

/** This turn's warmth movement — the mean of the warmth-relevant deltas, matching how `computeWarmth` averages the levels. */
export function warmthDeltaOf(deltas: Partial<Record<RelationshipDimension | 'affection', number>>): number {
  const sum = WARMTH_DELTA_KEYS.reduce((total, k) => total + (deltas[k] ?? 0), 0)
  return sum / WARMTH_DELTA_KEYS.length
}

/** The next momentum value after a turn moved warmth by `warmthDelta`. */
export function nextMomentum(prev: number | undefined, warmthDelta: number): number {
  const raw = (prev ?? 0) * MOMENTUM_DECAY + warmthDelta
  return Math.max(-MOMENTUM_CLAMP, Math.min(MOMENTUM_CLAMP, Math.round(raw * 100) / 100))
}

/** A one-word player-facing label for `RelationshipPanel`. */
export function describeMomentum(momentum: number | undefined): string | undefined {
  const m = momentum ?? 0
  if (m >= 2) return 'deepening fast'
  if (m >= 0.8) return 'warming'
  if (m <= -1.5) return 'cooling off'
  if (m <= -0.5) return 'cooled a little'
  return undefined
}

/**
 * The pacing clause folded into `buildRelationshipDescription` — the "how fast, and is that a
 * standing invitation" read the raw warmth/stage lines can't give. Real names, no `{{macros}}`
 * (`styleGuidance` / relationshipDescription strings are macro-substituted by `buildPrompt`, but
 * this file is also reused headlessly by `outreach.ts`, and keeping it name-literal matches
 * `mindGuidance.ts`). Returns `undefined` when there's nothing worth saying (a settled early-stage
 * relationship, no momentum either way).
 */
export function relationshipPacingNote(charName: string, warmth: number, momentum: number, tension: number): string | undefined {
  if (tension >= 55 && warmth >= 45) {
    return `There's been real friction lately, running right alongside the closeness — both are true at once. Don't smooth it over, and don't let accumulated warmth make ${charName} more romantically receptive than the current strain would allow.`
  }
  if (momentum >= 2) {
    return `The relationship has moved fast these last few exchanges. ${charName} is more likely to want to slow down and let it settle than to keep accelerating — treat the recent momentum as something that might need a beat to catch up to, not a standing invitation for more.`
  }
  if (momentum <= -1.5) {
    return `The last few exchanges have cooled things off. Right now ${charName} is more guarded and less open than the overall closeness would suggest — that recent cooling is the more current read of where they actually are.`
  }
  if (momentum >= 0.8) {
    return `Things have been genuinely warming lately and moving in a good direction — ${charName} can let that show.`
  }
  if (momentum <= -0.5) {
    return `Things have drifted a little flat or distant in the last few exchanges — not a crisis, just a cooler stretch than the numbers alone would say.`
  }
  if (warmth >= 50) {
    return `Things have been steady and comfortable lately, not pushing forward, and that's fine — not every stretch of a relationship has to escalate. ${charName} doesn't need to manufacture a new development this turn.`
  }
  return undefined
}
