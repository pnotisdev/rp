/** Memoizes tokenizer round-trips. */

/** Entry cap. Comfortably covers a long chat's turns plus the fixed blocks across several rebuilds. */
const MAX_ENTRIES = 2000

const counts = new Map<string, number>()
/** In-flight requests, so concurrent builds asking for the same text share one round-trip. */
const inflight = new Map<string, Promise<number>>()

/** Returns the cached count for `text`, or awaits `compute` once and caches it. */
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
