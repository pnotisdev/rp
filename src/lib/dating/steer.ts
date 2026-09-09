// One-shot "correct the scene" directive for a single regeneration — unlike intent chips or
// Author's Note, it applies once and is discarded immediately after.

/**
 * Wraps the player's correction as a directive telling the model to override the previous attempt.
 *
 * Written to displace the previous attempt rather than amend it: the failure mode a milder wording
 * produces is a reply that keeps the rejected direction and bolts the correction on at the end, which
 * is worse than the original, because now the scene has gone the wrong way *and* doubled back.
 */
export function buildSteerDirective(steerText: string, charName: string): string {
  const trimmed = steerText.trim()
  return `Before writing this reply again: the previous attempt went the wrong way, and the player has stepped in to correct it. This overrides any instinct to continue what the last attempt was doing. Write this turn as if that attempt had never happened — don't carry its direction forward, don't have ${charName} walk it back on the page, and don't acknowledge the correction inside the fiction. Just write the turn it should have been. The correction: ${trimmed}`
}

/** Same one-shot directive, auto-built from a hard-rail hit (a boundary cross, an agency violation, and/or a
 *  contradiction of the tracked scene state) instead of the player's own words. `undefined` when none fired. */
export function hardFailCorrectionDirective(
  charName: string,
  userName: string,
  crossed: string | undefined,
  agencyViolation: string | undefined,
  continuityBreak?: string,
): string | undefined {
  if (!crossed && !agencyViolation && !continuityBreak) return undefined
  const reasons = [
    crossed ? `crossed a stated limit ("${crossed}")` : '',
    agencyViolation ? `narrated ${userName}'s own action, feeling, or thought for them ("${agencyViolation}")` : '',
    continuityBreak ? `contradicted what is already true in this scene: ${continuityBreak}` : '',
  ].filter(Boolean)
  return buildSteerDirective(
    `It ${reasons.join(' and it ')}. Don't do that this time. Write only ${charName}'s own side, and stay consistent with the scene state you were given.`,
    charName,
  )
}
