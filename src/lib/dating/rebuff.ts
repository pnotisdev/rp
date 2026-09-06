// A decaying "recently turned down" cue for a deflected/backfired commitment or intimacy ask —
// colors the next handful of turns rather than stopping the instant the outcome's deltas apply.
// Soft and temporary, distinct from `RelationshipWarning`'s standing breakup-risk banner. Counted
// in the character's own replies, same unit as `dating/aftercare.ts`'s `Afterglow`.

export const REBUFF_WINDOW_TURNS = 5

export type RebuffKind = 'commitment' | 'intimacy_milestone'

/** Stored per relationship (`RelationshipTrack.recentRebuff`). `null` clears it. */
export interface RecentRebuff {
  /** `countCharReplies` value when the ask was turned down. */
  startedAtTurn: number
  kind: RebuffKind
  /** A deflect reads softer than a backfire — see `rebuffGuidance`. */
  severity: 'deflect' | 'backfire'
}

/** Turns since the rebuff, or `null` if none, or stale (start ahead of the conversation — a rewind/fork). */
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

/** `styleGuidance` line for the still-live window — real names, no `{{macros}}`. States what's true rather than what to write. */
export function rebuffGuidance(charName: string, userName: string, rebuff: RecentRebuff): string {
  const askKind = rebuff.kind === 'commitment' ? 'define where things actually stood' : 'take things further, physically'
  if (rebuff.severity === 'backfire') {
    return `Not long ago ${userName} pushed to ${askKind} and it genuinely stung ${charName} — bad timing, or it read as presumptuous. That doesn't heal in one warm line: ${charName} can be slower to open back up or a little more guarded than usual for a while, without it becoming a punishment that never lifts.`
  }
  return `${userName} recently asked to ${askKind} and ${charName} put it off. That isn't forgotten the instant the subject changes: a touch more self-protection or hesitation than usual is natural for a little while, even while things otherwise carry on normally.`
}
