import type { RelationshipDimension } from '@/lib/types'
import type { CharacterMood, CharacterNeed } from '@/lib/prompt/mindGuidance'

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

/**
 * Asymmetric pacing — momentum above answers "how fast is warmth moving", not "whose doing the
 * moving". Two warmth-90 couples that got there the same way can still differ: one where the player
 * carries every overture and the character barely reciprocates reads very differently from one
 * where the character is visibly the one closing distance. This is that second axis: a decayed
 * running balance of who has actually been initiating lately, same "decayed running sum" shape as
 * `nextMomentum` (and the same decay constant — nothing about *how* it forgets a burst needs to
 * differ from momentum's own tuning), just fed a different per-turn signal.
 *
 * Positive = the player has been the one reaching, without much coming back the other way (the
 * character reads as reserved lately). Negative = the character has been initiating warmth on their
 * own, unprompted by a tagged player overture (the character reads as the one leaning in).
 */
export const INITIATIVE_CLAMP = 6

/**
 * This turn's contribution to the balance. `hadPlayerIntent` is whether the player tagged their line
 * with one of the romantic/emotional intent chips (`dating/intent.ts`) — a deliberate overture, not
 * just an ordinary line. `warmthDelta` is this same turn's `warmthDeltaOf` reading.
 *
 * - A tagged overture that didn't move warmth: the player reached, the character didn't meet it —
 *   +1 (player carrying it).
 * - A tagged overture that did move warmth: reciprocated, balanced — 0.
 * - No tagged overture, but warmth still moved up: the character initiated on their own — -1
 *   (character carrying it).
 * - No tagged overture and no warmth movement: nothing happened either way — 0.
 */
export function initiativeContribution(hadPlayerIntent: boolean, warmthDelta: number): number {
  if (hadPlayerIntent) return warmthDelta <= 0 ? 1 : 0
  return warmthDelta > 0 ? -1 : 0
}

/** The next balance after this turn's contribution — same decay/clamp/rounding shape as `nextMomentum`. */
export function nextInitiativeBalance(prev: number | undefined, contribution: number): number {
  const raw = (prev ?? 0) * MOMENTUM_DECAY + contribution
  return Math.max(-INITIATIVE_CLAMP, Math.min(INITIATIVE_CLAMP, Math.round(raw * 100) / 100))
}

/**
 * A `styleGuidance`-ready nudge once the imbalance is real and sustained, not a single lopsided
 * turn — mirrors the two example phrasings from the brief almost verbatim. Uses `{{user}}`/`{{char}}`
 * macros deliberately: unlike most of this module (folded into real-name `styleGuidance` strings by
 * callers), this is meant to be read into `buildRelationshipDescription`'s output, which
 * `buildPrompt` macro-substitutes (see that file's own doc comment). Returns `undefined` below the
 * threshold, which is most of the time — a small, ordinary lopsidedness isn't worth a callout.
 */
/** A one-word-ish player-facing label for `RelationshipPanel`, same spirit as `describeMomentum`. */
export function describeInitiativeBalance(balance: number | undefined): string | undefined {
  const b = balance ?? 0
  if (b >= 2) return "you've been carrying it lately"
  if (b <= -2) return "they've been the one reaching lately"
  return undefined
}

export function asymmetricPacingNote(charName: string, balance: number): string | undefined {
  if (balance >= 2) {
    return `${charName} has been more reserved than {{user}} has lately — {{user}}'s the one who keeps reaching first, without much coming back the other way. That's not nothing; it can read as real hesitation worth letting show, not just quiet shyness to smooth over.`
  }
  if (balance <= -2) {
    return `${charName} has actually been the one initiating more than {{user}} lately — worth reflecting that ${charName} isn't only reacting here, they're the one closing the distance right now.`
  }
  return undefined
}

/**
 * Item 2(a): the `slowBurnPacing` toggle (`useChatSession.ts`) used to fold in one fixed instruction
 * for every character regardless of who they actually are right now — a `content`, easygoing
 * character and one who's actively `guarded` or holding back on a `distance`-kind plan got the exact
 * same wording. This reads the character's own current mood/plan/unmet-need (all already tracked,
 * see `prompt/mindGuidance.ts`) and scales the actual severity of the instruction: a character with a
 * live, in-character reason to resist gets told to resist *harder* — a flat no or real deflection,
 * not just a token hesitation that quickly gives way — while an otherwise-settled character keeps the
 * gentler baseline wording the toggle always had.
 */
const HIGH_RESISTANCE_MOODS: readonly CharacterMood[] = ['guarded', 'anxious', 'hurt', 'embarrassed', 'tense']

export function slowBurnPacingNote(
  charName: string,
  mood: CharacterMood | undefined,
  isHoldingBackByPlan: boolean,
  unmetNeed: CharacterNeed | undefined,
): string {
  const base = "Pace intimacy like a slow burn. Earn it through many small moments; don't grant it just because it was asked for."
  const strongResistance = isHoldingBackByPlan || (!!mood && HIGH_RESISTANCE_MOODS.includes(mood))
  if (strongResistance) {
    const because = isHoldingBackByPlan ? 'is actively holding back right now, on their own terms' : `is currently ${mood}`
    return `${base} Right now ${charName} ${because} — that's a live, in-character reason to resist harder than usual, not less: an outright deflection, a flat no, or genuinely pulling back are the honest reactions here, more than a token hesitation that quickly gives way anyway. Don't cave just to be agreeable, and don't let accumulated warmth talk ${charName} out of this.`
  }
  const needClause = unmetNeed
    ? ` ${charName} has also been quietly wanting more ${unmetNeed} lately — that undercurrent should make them slower to open up physically until it's actually been met, not faster.`
    : ''
  return `${base} If pushed toward more affection, a kiss, or closeness faster than the relationship has earned, react the way your character actually would. Hesitation, deflection, or a flat no are often the right call, especially early on. Don't cave just to be agreeable.${needClause} None of this makes your character passive, though: once something is genuinely earned, don't just sit and wait for it to be asked for either. Let your character be the one who closes the distance, reaches for a hand, or leans in first sometimes, the same way a real person catching feelings would.`
}
