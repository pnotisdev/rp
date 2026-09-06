import { useEffect, useState } from 'react'
import { subscribe } from '@/lib/api/client'

/**
 * In-flight request coalescing: several `useApiQuery` instances mounted at the same moment for the
 * exact same query (e.g. a parent view and a child panel both listing `characters` on first paint)
 * would otherwise each fire their own identical fetch — confirmed in practice across several
 * screens (`ChatsPanel`, `GlobalBgm`, `CommandPalette` all independently listing the same
 * `chats`/`characters`/`worlds` on the same render). Keyed by resources+deps rather than a
 * long-lived cache — an entry only exists while its fetch is actually in flight, cleared the
 * instant it settles — so this never serves stale data; it only merges truly-simultaneous requests
 * into one network round trip. A later refetch (invalidation, dep change) always runs fresh.
 */
const inFlight = new Map<string, Promise<unknown>>()

/**
 * `resources` is only a broadcast channel name for invalidation — two genuinely different queries
 * routinely share one (`ChatsPanel` lists both `chatsApi.list()` *and* `chatsApi.trash()` under the
 * `'chats'` channel, both with `deps: []`), so it's deliberately NOT part of this key; using it
 * would coalesce `list()` into serving `trash()`'s result or vice versa. `fetcher.toString()` (the
 * closure's own source text) disambiguates that instead — two call sites invoking the same API
 * method the same way stringify identically and are safe to share, while `list()` vs `trash()`
 * stringify differently and never collide. `deps` still carries "which entity" (an id, etc.).
 * Returning `null` (deps aren't JSON-safe — a function, a `Map`/`Set`, ...) just opts that call out
 * of coalescing; it's never a correctness risk, only a missed dedup.
 */
export function coalesceKey(fetcher: () => unknown, deps: unknown[]): string | null {
  try {
    return `${fetcher.toString()}::${JSON.stringify(deps)}`
  } catch {
    return null
  }
}

/**
 * Runs `run()` once per outstanding `key`, sharing the result with any other caller using the same
 * key while it's still pending. `key === null` always runs fresh (coalescing opted out of, e.g. by
 * `coalesceKey` above). Exported on its own — pure enough (a plain module-level `Map`, no React) to
 * unit-test directly rather than needing a hook-rendering harness this codebase doesn't otherwise
 * carry a dependency for.
 */
export function withCoalescing<T>(key: string | null, run: () => Promise<T>): Promise<T> {
  if (!key) return run()
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const promise = run()
  inFlight.set(key, promise)
  const cleanup = () => {
    // Only clear this call's own entry — a slower call for the same key that started after this
    // one already cleared it would otherwise delete the wrong (newer) in-flight promise.
    if (inFlight.get(key) === promise) inFlight.delete(key)
  }
  // `.then(cleanup, cleanup)` rather than `.finally(cleanup)`: `.finally` re-throws through its
  // own returned promise, which nobody here awaits — an unhandled rejection when `run()` rejects,
  // even though the caller's own `promise` (returned below) is handled correctly. Neither handler
  // here rethrows, so this derived promise always settles fulfilled.
  promise.then(cleanup, cleanup)
  return promise
}

/**
 * useLiveQuery's replacement now that data lives on the server instead of IndexedDB:
 * fetches on mount/dep-change, and re-fetches whenever any mutation announces a change
 * to one of the named resources (see invalidate() in client.ts) — including mutations
 * from this exact same hook instance, so the shape callers already rely on (mutate, then
 * see it reflected) keeps working without each call site managing its own refetch.
 */
export function useApiQuery<T>(
  resources: string | string[],
  fetcher: () => Promise<T>,
  deps: unknown[],
): T | undefined {
  const [data, setData] = useState<T | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      withCoalescing(coalesceKey(fetcher, deps), fetcher)
        .then((result) => {
          if (!cancelled) setData(result)
        })
        .catch(() => {
          if (!cancelled) setData(undefined)
        })
    }
    load()
    const names = Array.isArray(resources) ? resources : [resources]
    const unsubscribers = names.map((name) => subscribe(name, load))
    return () => {
      cancelled = true
      unsubscribers.forEach((fn) => fn())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return data
}
