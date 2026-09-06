/**
 * Item 4's second deterministic control: a player-facing "correct the scene" action, separate from
 * both intent chips (`dating/intent.ts` — colors how the *player's own next line* should be read)
 * and Author's Note (`AuthorNote` — a standing, persistent steer that stays in every future prompt
 * until the player edits or clears it). This is neither: a one-shot, strongly-worded correction that
 * applies to exactly one regeneration and is discarded the instant it's used. Nothing is written to
 * the chat, the character card, or any persistent prompt section — see `useChatSession.ts`'s
 * `regenerateWithSteer`, which threads this straight into `runGeneration`'s existing
 * `extraStyleGuidance` for that one call only, the same one-shot channel `intimacyActionDirective`
 * already uses for a single reply turn.
 *
 * The use case: a reply just went somewhere the player didn't want (wrong tone, wrong direction,
 * glossed past something that mattered), and a bare regenerate reroll gives the model no signal
 * about *what* was wrong — it can easily reproduce the same miss. This gives the regeneration an
 * explicit, unambiguous correction to work from instead.
 */
export function buildSteerDirective(steerText: string, charName: string): string {
  const trimmed = steerText.trim()
  return `Before writing this reply again: the previous attempt went the wrong way, and the player has stepped in to correct it. This overrides any instinct to continue what the last attempt was doing — ${charName} should not continue in that direction. The correction: ${trimmed}`
}
