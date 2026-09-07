// One-shot "correct the scene" directive for a single regeneration — unlike intent chips or
// Author's Note, it applies once and is discarded immediately after.

/** Wraps the player's correction as a directive telling the model to override the previous attempt. */
export function buildSteerDirective(steerText: string, charName: string): string {
  const trimmed = steerText.trim()
  return `Before writing this reply again: the previous attempt went the wrong way, and the player has stepped in to correct it. This overrides any instinct to continue what the last attempt was doing — ${charName} should not continue in that direction. The correction: ${trimmed}`
}

/** Same one-shot directive, auto-built from a hard-rail hit (a boundary cross and/or an agency violation) instead of the player's own words. `undefined` when neither actually fired. */
export function hardFailCorrectionDirective(
  charName: string,
  userName: string,
  crossed: string | undefined,
  agencyViolation: string | undefined,
): string | undefined {
  if (!crossed && !agencyViolation) return undefined
  const reasons = [
    crossed ? `crossed a stated limit ("${crossed}")` : '',
    agencyViolation ? `narrated ${userName}'s own action, feeling, or thought for them ("${agencyViolation}")` : '',
  ].filter(Boolean)
  return buildSteerDirective(`It ${reasons.join(' and it ')}. Don't do that this time — write only ${charName}'s own side.`, charName)
}
