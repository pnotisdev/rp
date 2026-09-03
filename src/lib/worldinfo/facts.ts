import type { Lorebook } from '@/lib/characters/cardSpec'
import type { ChatFact } from '@/lib/types'

/** Token cap for the synthetic "Remembered facts" lorebook (10f) — enough for roughly 15-20 short one-line facts, the "handful" the roadmap asks for, not an unbounded, ever-growing list. */
export const FACTS_TOKEN_BUDGET = 200

/**
 * Turns a chat's active durable facts into a synthetic constant lorebook, so they ride through
 * the exact same activation/budget/placement machinery as any other lorebook rather than a new
 * prompt section. Capped to `FACTS_TOKEN_BUDGET` the same way any other lorebook already is
 * (unset defaults to unbounded, so before this existed facts were silently the one book with no
 * cap at all — a long-running chat's memory would grow forever, eventually crowding out either
 * the lore budget or recent conversation history), and prioritized by recency: the most recently
 * confirmed facts win a spot when there isn't room for all of them, since recency is the only
 * deterministic relevance proxy available without either a real retrieval system or another
 * model call — matches 10f's "a handful of the most relevant typed memories."
 */
export function buildFactsLorebook(facts: ChatFact[], tokenBudget: number = FACTS_TOKEN_BUDGET): Lorebook[] {
  if (facts.length === 0) return []
  return [
    {
      name: 'Remembered facts',
      token_budget: tokenBudget,
      entries: [...facts]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((f, i) => ({
          id: i,
          keys: [],
          content: f.text,
          constant: true,
          selective: false,
          // Later in this recency-sorted array = more recent = higher priority for both the
          // budget cut (activateWorldInfo fills highest insertion_order first) and final
          // placement (closer to generation).
          insertion_order: 100 + i,
          enabled: true,
          activationMode: 'always' as const,
        })),
    },
  ]
}
