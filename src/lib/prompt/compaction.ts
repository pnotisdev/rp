// Decides when the verbatim chat window is folded into the rolling summary

export interface CompactionTurn {
  role: 'user' | 'char'
  tokens: number
}

export interface CompactionPlanInput {
  /** Verbatim messages still in the prompt (after the summary cutoff), oldest first. */
  turns: CompactionTurn[]
  /** Tokens the prompt leaves for history (`PromptBuildResult.historyCapacity`). */
  capacity: number
  /** Expected tokens the next exchange adds (the user's line plus a reply). */
  growth: number
  /** Fraction of capacity that triggers compaction. Default 0.92. */
  highWater?: number
  /** Fraction of capacity left verbatim afterwards. Default 0.5. */
  lowWater?: number
  /** Messages that are never folded away. Default 4. */
  minKeep?: number
}

/** How many of the oldest messages to fold into the summary now; 0 when the window still has room. */
export function planCompaction(input: CompactionPlanInput): number {
  const { turns, capacity, growth } = input
  const high = input.highWater ?? 0.92
  // High-water 0 means "compact now" (manual); otherwise keep the low mark clearly under the trigger.
  const low = Math.max(0.05, high > 0 ? Math.min(input.lowWater ?? 0.5, high - 0.05) : (input.lowWater ?? 0.5))
  const minKeep = Math.max(1, input.minKeep ?? 4)
  const maxFold = turns.length - minKeep
  if (maxFold <= 0 || capacity <= 0) return 0

  let remaining = turns.reduce((sum, t) => sum + t.tokens, 0)
  if (remaining + Math.max(0, growth) <= capacity * high) return 0

  const target = capacity * low
  let fold = 0
  while (fold < maxFold && remaining > target) {
    remaining -= turns[fold].tokens
    fold++
  }
  // Start the kept window on the user's line so the transcript still reads as alternating turns.
  while (fold < maxFold && turns[fold].role !== 'user') fold++
  return fold
}
