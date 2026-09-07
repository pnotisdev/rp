import type { Lorebook } from '@/lib/characters/cardSpec'
import type { ChatFact } from '@/lib/types'

/**
 * Turns a chat's durable facts into a synthetic constant lorebook, so they ride through the same
 * activation/budget/placement machinery as any other lorebook rather than a new prompt section.
 * Prioritized by a blend of recency, importance, and unresolved-ness so what matters survives the
 * token cut.
 */

/** Token cap for the synthetic "Remembered facts" lorebook — room for roughly 15-20 short facts. */
export const FACTS_TOKEN_BUDGET = 200

/** How a fact's `content` reads in the prompt — unresolved threads get flagged (more strongly if negative) so the model can let them colour a later callback. */
export function factContent(f: Pick<ChatFact, 'text' | 'valence' | 'unresolved'>): string {
  if (!f.unresolved) return f.text
  if ((f.valence ?? 0) <= -0.15) return `Still unsettled, not resolved: ${f.text}`
  return `Still an open thread: ${f.text}`
}

/** A fact's priority for the token-budget cut and placement — a blend of importance, recency, and unresolved-ness (weighted heaviest, so open threads don't age out just for being old). */
function factScore(f: ChatFact, recencyRank: number): number {
  const importance = f.importance ?? 0.5
  return 0.45 * importance + 0.3 * recencyRank + (f.unresolved ? 0.45 : 0)
}

export function buildFactsLorebook(facts: ChatFact[], tokenBudget: number = FACTS_TOKEN_BUDGET): Lorebook[] {
  // Skip a malformed row (non-string `text`) rather than let `[object Object]` reach the prompt.
  const usable = facts.filter((f) => typeof f.text === 'string' && f.text.trim())
  if (usable.length === 0) return []
  const byAge = [...usable].sort((a, b) => a.createdAt - b.createdAt)
  const lastRank = Math.max(1, byAge.length - 1)
  const ranked = byAge
    .map((f, i) => ({ f, score: factScore(f, i / lastRank) }))
    .sort((a, b) => a.score - b.score) // lowest score first, so the highest ends up with the top insertion_order
  return [
    {
      name: 'Remembered facts',
      token_budget: tokenBudget,
      entries: ranked.map(({ f }, i) => ({
        id: i,
        keys: [],
        content: factContent(f),
        constant: true,
        selective: false,
        // Higher insertion_order fills/places first, so higher score = later in this array = more likely kept.
        insertion_order: 100 + i,
        enabled: true,
        activationMode: 'always' as const,
      })),
    },
  ]
}
