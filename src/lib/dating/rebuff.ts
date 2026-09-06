/**
 * A deflected or backfired commitment/intimacy ask (`assessCommitmentAsk`/`assessIntimacyMilestone`
 * in `relationshipAssist.ts`) already costs something in the moment — the outcome's own `deltas` —
 * but that's a single-turn stat move, gone the instant the next line is written. A real "not right
 * now" doesn't actually stop mattering that fast: item 2's "missed opportunity" gap is exactly this,
 * a lingering, decaying cue that colors the next handful of turns, distinct from
 * `RelationshipWarning` (a standing, hard breakup-risk banner for a *committed* relationship under
 * real strain) — this is soft, temporary, and fires on an ordinary deflection, not only a crisis.
 *
 * Same "counted in the character's own replies" unit `dating/aftercare.ts`'s `Afterglow` already
 * uses, for the same reason: measuring in raw messages would let one long player turn or one
 * one-word reply close the window at very different real paces, and it keeps every one of this
 * app's turn-counted windows (`Afterglow`, plans' staleness, this) agreeing on what "N turns" means.
 */

export const REBUFF_WINDOW_TURNS = 5

export type RebuffKind = 'commitment' | 'intimacy_milestone'

/** Stored per relationship (`RelationshipTrack.recentRebuff`). `null` clears it — same convention `Afterglow`/`relationshipWarning` already use for "JSON.stringify drops undefined keys". */
export interface RecentRebuff {
  /** `countCharReplies` value when the ask was turned down. */
  startedAtTurn: number
  kind: RebuffKind
  /** A plain deflect ("not right now, nothing damaged") reads much softer than a backfire (a real, earned cost) — see `rebuffGuidance`. */
  severity: 'deflect' | 'backfire'
}

/**
 * How many of the character's own replies since the rebuff, or `null` when there is none, or when
 * the stored one is stale — its start now *ahead* of the conversation, exactly what a rewind or a
 * fork-from-earlier produces. Treating a stale one as "0 turns in" would resurrect a rebuff for a
 * timeline where it never actually happened, the same trap `afterglowTurnsSince` already guards.
 */
export function turnsSinceRebuff(rebuff: RecentRebuff | undefined | null, charReplyCount: number): number | null {
  if (!rebuff) return null
  const since = charReplyCount - rebuff.startedAtTurn
  if (since < 0) return null
  return since
}

/** Whether the window is still live right now. */
export function isRebuffActive(rebuff: RecentRebuff | undefined | null, charReplyCount: number): boolean {
  const since = turnsSinceRebuff(rebuff, charReplyCount)
  return since !== null && since < REBUFF_WINDOW_TURNS
}

/**
 * A `styleGuidance` line for the still-live window — real names, no `{{macros}}` (this is meant to
 * be folded straight into `styleGuidance`, never macro-substituted; see `mindGuidance.ts`'s own
 * note on the same point). Deliberately doesn't say what to write, only what's true, same restraint
 * `RelationshipPanel`'s own afterglow copy already uses — printing "be extra guarded" would turn a
 * read of the character into a checklist rather than a texture.
 */
export function rebuffGuidance(charName: string, userName: string, rebuff: RecentRebuff): string {
  const askKind = rebuff.kind === 'commitment' ? 'define where things actually stood' : 'take things further, physically'
  if (rebuff.severity === 'backfire') {
    return `Not long ago ${userName} pushed to ${askKind} and it genuinely stung ${charName} — bad timing, or it read as presumptuous. That doesn't heal in one warm line: ${charName} can be slower to open back up or a little more guarded than usual for a while, without it becoming a punishment that never lifts.`
  }
  return `${userName} recently asked to ${askKind} and ${charName} put it off. That isn't forgotten the instant the subject changes: a touch more self-protection or hesitation than usual is natural for a little while, even while things otherwise carry on normally.`
}
