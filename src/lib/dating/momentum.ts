import type { RelationshipDimension } from '@/lib/types'
import type { CharacterMood } from '@/lib/prompt/mindGuidance'

// Relationship *momentum*: the derivative of warmth, not its level — a warmth-90 couple in a quiet
// stretch vs. mid-whirlwind shouldn't read the same. Stored as one decayed running number per turn:
// `momentum = momentum * DECAY + (this turn's warmth movement)`, so a burst fades on its own over
// ~4-5 quiet turns. Also covers the initiative-balance axis (who's doing the reaching) and the
// mood-aware slow-burn pacing note.

export const MOMENTUM_DECAY = 0.65

/** Kept in a sane band — a runaway value would just make every clause say "moving fast" forever. */
const MOMENTUM_CLAMP = 8

/** The dimensions that feed `computeWarmth` (`stage.ts`) — `tension`/`curiosity` deliberately don't count. */
const WARMTH_DELTA_KEYS: (RelationshipDimension | 'affection')[] = ['affection', 'trust', 'chemistry', 'comfort', 'respect']

/** This turn's warmth movement — the mean of the warmth-relevant deltas. */
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

/** Pacing clause folded into `buildRelationshipDescription`. Real names, no macros. `undefined` when there's nothing worth saying. */
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

/** Who's actually been initiating lately, not just how fast warmth is moving. Positive = player carrying it (character reads reserved); negative = character carrying it. Same decayed-running-sum shape as momentum. */
export const INITIATIVE_CLAMP = 6

/** This turn's contribution to the balance. `hadPlayerIntent` = the player tagged a romantic/emotional intent chip (a deliberate overture). */
export function initiativeContribution(hadPlayerIntent: boolean, warmthDelta: number): number {
  if (hadPlayerIntent) return warmthDelta <= 0 ? 1 : 0
  return warmthDelta > 0 ? -1 : 0
}

/** The next balance after this turn's contribution — same decay/clamp/rounding shape as `nextMomentum`. */
export function nextInitiativeBalance(prev: number | undefined, contribution: number): number {
  const raw = (prev ?? 0) * MOMENTUM_DECAY + contribution
  return Math.max(-INITIATIVE_CLAMP, Math.min(INITIATIVE_CLAMP, Math.round(raw * 100) / 100))
}

/** A one-word-ish player-facing label for `RelationshipPanel`, same spirit as `describeMomentum`. */
export function describeInitiativeBalance(balance: number | undefined): string | undefined {
  const b = balance ?? 0
  if (b >= 2) return "you've been carrying it lately"
  if (b <= -2) return "they've been the one reaching lately"
  return undefined
}

/** `{{user}}`/`{{char}}` macro version, read into `buildRelationshipDescription`'s macro-substituted output. `undefined` below the threshold — most of the time. */
export function asymmetricPacingNote(charName: string, balance: number): string | undefined {
  if (balance >= 2) {
    return `${charName} has been more reserved than {{user}} has lately — {{user}}'s the one who keeps reaching first, without much coming back the other way. That's not nothing; it can read as real hesitation worth letting show, not just quiet shyness to smooth over.`
  }
  if (balance <= -2) {
    return `${charName} has actually been the one initiating more than {{user}} lately — worth reflecting that ${charName} isn't only reacting here, they're the one closing the distance right now.`
  }
  return undefined
}

// Moods that give a character a live, in-character reason to resist harder than the baseline slow-burn wording.
const HIGH_RESISTANCE_MOODS: readonly CharacterMood[] = ['guarded', 'anxious', 'hurt', 'embarrassed', 'tense']

/** Slow-burn pacing note, scaled to the character's current mood/plan/unmet-need rather than one fixed instruction for everyone. */
export function slowBurnPacingNote(
  charName: string,
  mood: CharacterMood | undefined,
  isHoldingBackByPlan: boolean,
): string {
  const strongResistance = isHoldingBackByPlan || (!!mood && HIGH_RESISTANCE_MOODS.includes(mood))
  if (strongResistance) {
    const because = isHoldingBackByPlan ? 'is actively holding back right now, on their own terms' : `is currently ${mood}`
    return `Slow burn: ${charName} ${because}. Escalation is especially unearned now; let them refuse, deflect, or pull back rather than yielding to momentum or warmth.`
  }
  return `Slow burn: earn intimacy through small moments, never because it was requested. If pushed early, hesitate, deflect, or say no rather than agreeing to please; once it is earned, let ${charName} initiate sometimes too.`
}
