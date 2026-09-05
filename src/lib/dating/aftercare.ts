import type { RelationshipDeltas } from '@/lib/dating/relationshipAssist'
import type { CharacterNeed } from '@/lib/prompt/mindGuidance'

/**
 * Aftercare: the window right after an intimate scene, and what the player does with it.
 *
 * Everything else in this app treats intimacy as a thing that happens and then stops mattering —
 * the scene is written, a few stats move on the turn itself, and the next morning reads exactly
 * like any other turn. That's the least true part of the simulation: the hours *after* are where
 * a relationship actually gets made or quietly damaged, and they're the part a dating sim can
 * model without writing a word of the content itself.
 *
 * So: an explicit intimacy action (or the "first time together" milestone) opens a window of a few
 * turns. During it the character is written as someone in the immediate aftermath — more open,
 * more exposed, easier to hurt. When the window closes, the same per-turn judge that already runs
 * on every reply is asked one extra question about how those turns actually went, and the app
 * applies the consequence. No extra model call: the ask rides along exactly the way objective-task
 * detection already does (see `assessRelationshipMoment`'s `pendingTasks`).
 *
 * The deltas below are deliberately sized between the two existing scales — bigger than a single
 * ordinary turn (-2..2, `assessRelationshipMoment`) because this is a verdict on several turns,
 * smaller than a whole date (-5..5, `assessDateOutcome`) because it's a coda rather than a scene.
 */

/**
 * How many of the character's own replies the window covers, counted from the turn the scene was
 * initiated. Four is long enough that the player has to actually sustain something (one warm line
 * doesn't buy a verdict) and short enough that it still reads as "after", not as the new normal.
 */
export const AFTERGLOW_TURNS = 4

/** A closed vocabulary, for the same reason `MOOD_VOCAB` is one — it keeps the classifier legible and stops it inventing shades. */
export const AFTERCARE_VERDICTS = ['tender', 'awkward', 'cold'] as const
export type AftercareVerdict = (typeof AFTERCARE_VERDICTS)[number]

/** State stored on a `RelationshipTrack` while the window is open. Cleared the moment its outcome is applied. */
export interface Afterglow {
  /**
   * How many replies the character had already given when the scene was initiated — so the window
   * is measured in their turns, not in raw messages (which grow at a different rate depending on
   * whether the player sends one line or several) and not in world-clock time (which one action
   * can advance by a whole day, closing the window instantly). See `afterglowTurnsSince` for what
   * happens when a rewind puts this ahead of the conversation.
   */
  startedAtTurn: number
  /** Short human label of what opened it, for prompt flavour only — never a gate, and safe to be absent. */
  sourceLabel?: string
}

/**
 * How many turns into the window we are, or `null` when there is no live window.
 *
 * Returns `null` rather than a number for a *stale* window too — one whose start is now ahead of
 * the conversation, which is exactly what a rewind or a fork-from-earlier produces. Treating that
 * as "0 turns in" would silently reopen an aftermath for a scene that no longer exists in this
 * timeline.
 */
export function afterglowTurnsSince(afterglow: Afterglow | undefined, charReplyCount: number): number | null {
  if (!afterglow) return null
  const since = charReplyCount - afterglow.startedAtTurn
  if (since < 0) return null
  return since
}

/** The unit the window is counted in — the character's own replies. One place, so the two call sites can't drift. */
export function countCharReplies(messages: readonly { role: string }[]): number {
  return messages.reduce((n, m) => (m.role === 'char' ? n + 1 : n), 0)
}

/** Whether the window has run its course and its outcome is now due. */
export function isAfterglowComplete(afterglow: Afterglow | undefined, charReplyCount: number): boolean {
  const since = afterglowTurnsSince(afterglow, charReplyCount)
  return since !== null && since >= AFTERGLOW_TURNS
}

/** Whether the character should currently be written as being in the aftermath. */
export function isAfterglowActive(afterglow: Afterglow | undefined, charReplyCount: number): boolean {
  const since = afterglowTurnsSince(afterglow, charReplyCount)
  return since !== null && since < AFTERGLOW_TURNS
}

const ZERO: RelationshipDeltas = { affection: 0, trust: 0, chemistry: 0, comfort: 0, respect: 0, curiosity: 0, tension: 0 }

/**
 * What each verdict is worth. `cold` is deliberately the sharpest of the three and the only one
 * that moves `tension`: being left alone after being that exposed is a specific, memorable hurt,
 * and a dating sim that only ever rewards should not be trusted about the times it does. `awkward`
 * is close to nothing on purpose — fumbling the moment is not a betrayal, and most real aftermaths
 * land here rather than at either pole.
 */
const VERDICT_DELTAS: Record<AftercareVerdict, Partial<RelationshipDeltas>> = {
  tender: { affection: 2, trust: 3, comfort: 3, chemistry: 1 },
  awkward: { comfort: 1 },
  cold: { affection: -1, trust: -4, comfort: -4, tension: 3 },
}

export function aftercareDeltas(verdict: AftercareVerdict): RelationshipDeltas {
  return { ...ZERO, ...VERDICT_DELTAS[verdict] }
}

/** The one-line reason logged to the relationship history, so a later "why did trust drop 4" has an answer. */
export function aftercareReason(verdict: AftercareVerdict): string {
  switch (verdict) {
    case 'tender':
      return 'Stayed close and warm in the hours after'
    case 'cold':
      return 'Pulled away in the hours after'
    case 'awkward':
    default:
      return 'The hours after landed awkwardly'
  }
}

/** Player-facing note for the quiet toast when a window resolves. `awkward` returns null — not every outcome deserves an interruption. */
export function aftercareToast(charName: string, verdict: AftercareVerdict): string | null {
  switch (verdict) {
    case 'tender':
      return `${charName} felt looked after in the hours that followed.`
    case 'cold':
      return `${charName} was left alone with it afterwards.`
    default:
      return null
  }
}

/**
 * The underlying need a verdict leaves behind, if any — so a bad aftermath doesn't stop mattering
 * the instant its window closes. `currentNeed` (`prompt/mindGuidance.ts`) is already the app's
 * "steadier undercurrent this stretch of the story hasn't been meeting", already reaches the
 * prompt on every turn, and already decays only when the judge reads a genuine change. Routing the
 * consequence through it means a `cold` aftermath keeps colouring the character for a while
 * afterwards, using machinery that exists rather than a second bespoke timer.
 *
 * Only `cold` leaves one. `tender` deliberately does not: "they were looked after" is not an unmet
 * need, and inventing a positive one would put words in the judge's mouth about a character who
 * has nothing to want. Clearing an existing need on `tender` was considered and rejected for the
 * same reason — whether a need has actually been met is a read of the story, which is the judge's
 * job, not a thing to infer from one verdict.
 */
export function aftercareNeed(verdict: AftercareVerdict): CharacterNeed | undefined {
  return verdict === 'cold' ? 'reassurance' : undefined
}

export function isAftercareVerdict(value: unknown): value is AftercareVerdict {
  return typeof value === 'string' && (AFTERCARE_VERDICTS as readonly string[]).includes(value)
}
