// One-shot "correct the scene" directive for a single regeneration — unlike intent chips or
// Author's Note, it applies once and is discarded immediately after.

/** Wraps the player's correction as a directive telling the model to override the previous attempt. */
export function buildSteerDirective(steerText: string, charName: string): string {
  const trimmed = steerText.trim()
  return `Before writing this reply again: the previous attempt went the wrong way, and the player has stepped in to correct it. This overrides any instinct to continue what the last attempt was doing — ${charName} should not continue in that direction. The correction: ${trimmed}`
}
