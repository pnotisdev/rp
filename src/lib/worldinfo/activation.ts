import type { Lorebook, LorebookEntry } from '@/lib/characters/cardSpec'
import { estimateTokens } from '@/lib/tokenEstimate'

export interface ActivationOptions {
  /** How many recent messages (rendered as plain text) to scan for keyword hits. */
  scanDepth: number
}

/**
 * Scans recent chat text for lorebook entry keyword matches. `always`-mode
 * entries (constant: true) are always included. `manual` entries are only
 * included if their id is present in manuallyActivatedIds.
 * Mirrors ST's "always / when relevant (keyword) / manual" activation modes.
 */
export interface WorldInfoActivationResult {
  activated: LorebookEntry[]
  /** Entries that matched but were dropped because their book's token budget was full. */
  droppedForBudget: LorebookEntry[]
}

/**
 * Scans for matches per-book, then caps each book to its own token_budget
 * (estimated, since this runs synchronously) so a large lorebook can never
 * silently eat the whole context — this is the actual "token saving"
 * mechanism: only relevant, budget-fitting lore gets injected, never
 * everything that merely matches a keyword.
 */
export function activateWorldInfo(
  books: Lorebook[],
  recentText: string,
  manuallyActivatedIds: Set<number> = new Set(),
): WorldInfoActivationResult {
  const haystack = recentText.toLowerCase()
  const activated: LorebookEntry[] = []
  const droppedForBudget: LorebookEntry[] = []

  for (const book of books) {
    const matched: LorebookEntry[] = []
    for (const entry of book.entries) {
      if (!entry.enabled) continue
      const mode = entry.activationMode ?? (entry.constant ? 'always' : 'keyword')
      if (mode === 'always') {
        matched.push(entry)
        continue
      }
      if (mode === 'manual') {
        // Manual entries are considered "on" purely via their enabled toggle,
        // or explicitly via manuallyActivatedIds for one-off inclusion.
        if (entry.enabled || (entry.id !== undefined && manuallyActivatedIds.has(entry.id))) {
          matched.push(entry)
        }
        continue
      }
      if (matchesKeywords(entry, haystack)) {
        matched.push(entry)
      }
    }

    // Higher insertion_order = higher priority = filled into the budget first.
    const byPriority = [...matched].sort((a, b) => b.insertion_order - a.insertion_order)
    const budget = book.token_budget ?? Infinity
    let used = 0
    for (const entry of byPriority) {
      const cost = estimateTokens(entry.content)
      if (used + cost > budget) {
        droppedForBudget.push(entry)
        continue
      }
      used += cost
      activated.push(entry)
    }
  }

  // Higher insertion_order wins placement priority (inserted closer to the end).
  activated.sort((a, b) => a.insertion_order - b.insertion_order)
  return { activated, droppedForBudget }
}

function matchesKeywords(entry: LorebookEntry, haystackLower: string): boolean {
  if (entry.keys.length === 0) return false
  const test = (k: string) => {
    const needle = entry.case_sensitive ? k : k.toLowerCase()
    const hay = entry.case_sensitive ? haystackLower : haystackLower
    return needle.length > 0 && hay.includes(needle)
  }
  const primaryHit = entry.keys.some(test)
  if (!primaryHit) return false
  if (entry.selective && entry.secondary_keys && entry.secondary_keys.length > 0) {
    return entry.secondary_keys.some(test)
  }
  return true
}

export function recentMessagesText(messages: { text: string }[], scanDepth: number): string {
  return messages
    .slice(-scanDepth)
    .map((m) => m.text)
    .join('\n')
}
