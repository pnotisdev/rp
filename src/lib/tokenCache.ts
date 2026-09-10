/**
 * Memoizes tokenizer round-trips.
 *
 * `buildPrompt` counts tokens for every history turn to decide what fits the context budget, and
 * KoboldCpp's tokenizer is an HTTP POST per call — so a 200-message chat spent 200 sequential
 * requests per prompt build, and a single generation builds the prompt more than once (the
 * auto-continue loop, plus a rebuild whenever an over-budget turn triggers a summary). The Prompt
 * Inspector pays it again on open. The inputs are almost entirely identical between those builds:
 * a stored message's rendered text doesn't change unless it's edited.
 *
 * Counting is a pure function of (text, tokenizer), so caching it is safe as long as the cache is
 * dropped when the tokenizer changes. Both signals are wired up: `useChatBackendClient` invalidates
 * when the backend/model setting changes, and `useConnectionStatus` invalidates when the model
 * KoboldCpp reports loaded changes underneath us (someone swapping the GGUF without touching
 * settings — the case a config-keyed cache alone would miss).
 */

/** Entry cap. Comfortably covers a long chat's turns plus the fixed blocks across several rebuilds. */
const MAX_ENTRIES = 2000

const counts = new Map<string, number>()
/** In-flight requests, so concurrent builds asking for the same text share one round-trip. */
const inflight = new Map<string, Promise<number>>()

/**
 * Returns the cached count for `text`, or awaits `compute` once and caches it. Concurrent callers
 * for the same text share a single `compute` call rather than each firing their own.
 */
export async function countTokensCached(text: string, compute: (text: string) => Promise<number>): Promise<number> {
  if (!text) return 0
  const hit = counts.get(text)
  if (hit !== undefined) {
    // Re-insert so the most recently used entry is last, making the eviction below a real LRU.
    counts.delete(text)
    counts.set(text, hit)
    return hit
  }
  const pending = inflight.get(text)
  if (pending) return pending

  const promise = compute(text)
    .then((count) => {
      counts.set(text, count)
      if (counts.size > MAX_ENTRIES) {
        // Map iterates in insertion order, so the first key is the least recently used.
        const oldest = counts.keys().next().value
        if (oldest !== undefined) counts.delete(oldest)
      }
      return count
    })
    .finally(() => {
      inflight.delete(text)
    })
  inflight.set(text, promise)
  return promise
}

/** Drops every cached count. Call whenever the active tokenizer may have changed. */
export function invalidateTokenCache(): void {
  counts.clear()
  inflight.clear()
}

/** Entry count — for tests and the Prompt Inspector's diagnostics. */
export function tokenCacheSize(): number {
  return counts.size
}
