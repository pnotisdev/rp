import type { Lorebook } from '@/lib/characters/cardSpec'
import type { ChatFact } from '@/lib/types'

/** Token cap for the synthetic "Remembered facts" lorebook (10f) — enough for roughly 15-20 short one-line facts, the "handful" the roadmap asks for, not an unbounded, ever-growing list. */
export const FACTS_TOKEN_BUDGET = 200

/**
 * How a fact's `content` reads in the prompt. An unresolved thread that landed badly gets flagged
 * so the model can let it colour a later, unrelated moment (a callback) without the app having to
 * re-narrate the whole event; an unresolved thread that isn't negative (a promise not yet kept, a
 * question still open) gets a lighter tag; everything else is stated plainly.
 */
export function factContent(f: Pick<ChatFact, 'text' | 'valence' | 'unresolved'>): string {
  if (!f.unresolved) return f.text
  if ((f.valence ?? 0) <= -0.15) return `Still unsettled, not resolved: ${f.text}`
  return `Still an open thread: ${f.text}`
}

/**
 * A fact's priority for the token-budget cut and placement. Was pure recency; now a blend, so
 * "forgot her birthday" (high importance, unresolved) outlives "ordered the pasta" (trivial,
 * recent). Recency still carries real weight — it's the only signal for a fact with no metadata,
 * so a chat from before "memory emotion" existed keeps behaving exactly as it did (every fact
 * `importance ≈ 0.5`, `unresolved` false → recency decides, same as before).
 */
function factScore(f: ChatFact, recencyRank: number): number {
  const importance = f.importance ?? 0.5
  // `unresolved` weighs heaviest on purpose: an open thread by definition hasn't been closed, so it
  // shouldn't age out of the prompt just for being old — that's what makes a late callback possible.
  return 0.45 * importance + 0.3 * recencyRank + (f.unresolved ? 0.45 : 0)
}

/**
 * Turns a chat's active durable facts into a synthetic constant lorebook, so they ride through
 * the exact same activation/budget/placement machinery as any other lorebook rather than a new
 * prompt section. Capped to `FACTS_TOKEN_BUDGET` the same way any other lorebook already is
 * (unset defaults to unbounded, so before this existed facts were silently the one book with no
 * cap at all — a long-running chat's memory would grow forever, eventually crowding out either
 * the lore budget or recent conversation history), and prioritized by `factScore` — importance
 * and unresolved-ness on top of recency — so the memories that matter keep their slot when the
 * budget is tight. Matches 10f's "a handful of the most relevant typed memories."
 */
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
        // `activateWorldInfo` fills highest insertion_order first (budget) and places it closest to
        // generation — so higher score = later in this array = more likely kept, printed last.
        insertion_order: 100 + i,
        enabled: true,
        activationMode: 'always' as const,
      })),
    },
  ]
}
