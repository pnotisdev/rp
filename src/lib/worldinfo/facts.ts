import type { Lorebook } from '@/lib/characters/cardSpec'
import type { ChatFact } from '@/lib/types'

/** Turns a chat's durable facts into a synthetic constant lorebook */

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

const STOPWORDS = new Set(
  'about after again also another because before being could does doing down each from have having here into just like more most much only other over said same should some such than that their them then there these they this those through very want well were what when where which while will with would your'.split(' '),
)

function significantWords(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of text.toLowerCase().match(/[a-z0-9À-￿']{4,}/g) ?? []) {
    if (!STOPWORDS.has(w)) out.add(w)
  }
  return out
}

/** 0-1 keyword relevance of each fact to the live chat; rarer shared words count more. No model call. */
function relevanceScores(facts: ChatFact[], contextText: string): number[] {
  const context = significantWords(contextText)
  if (context.size === 0) return facts.map(() => 0)
  const factWords = facts.map((f) => significantWords(f.text))
  const docFreq = new Map<string, number>()
  for (const ws of factWords) for (const w of ws) docFreq.set(w, (docFreq.get(w) ?? 0) + 1)
  return factWords.map((ws) => {
    let hit = 0
    let total = 0
    for (const w of ws) {
      const idf = Math.log(1 + facts.length / (docFreq.get(w) ?? 1))
      total += idf
      if (context.has(w)) hit += idf
    }
    return total > 0 ? Math.min(1, (hit / total) * 1.5) : 0
  })
}

/** Weight of live-conversation relevance against importance/recency/unresolved in a fact's priority. */
const RELEVANCE_WEIGHT = 0.6

/** `contextText` (recent turns) lets a fact the chat is touching on beat a newer unrelated one; only pass it when facts trail the history. */
export function buildFactsLorebook(facts: ChatFact[], tokenBudget: number = FACTS_TOKEN_BUDGET, contextText = ''): Lorebook[] {
  // Skip a malformed row (non-string `text`) rather than let `[object Object]` reach the prompt.
  const usable = facts.filter((f) => typeof f.text === 'string' && f.text.trim())
  if (usable.length === 0) return []
  const byAge = [...usable].sort((a, b) => a.createdAt - b.createdAt)
  const lastRank = Math.max(1, byAge.length - 1)
  const relevance = relevanceScores(byAge, contextText)
  const ranked = byAge
    .map((f, i) => ({ f, score: factScore(f, i / lastRank) + RELEVANCE_WEIGHT * relevance[i] }))
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
        volatile: true,
        selective: false,
        // Higher insertion_order fills/places first, so higher score = later in this array = more likely kept.
        insertion_order: 100 + i,
        enabled: true,
        activationMode: 'always' as const,
      })),
    },
  ]
}
