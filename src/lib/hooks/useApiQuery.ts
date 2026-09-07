import { useEffect, useState } from 'react'
import { subscribe } from '@/lib/api/client'

/**
 * `useLiveQuery`'s replacement now that data lives on the server instead of IndexedDB: fetches on
 * mount/dep-change, re-fetches on invalidation broadcasts, and coalesces simultaneous identical
 * requests (e.g. several components listing the same resource on first paint) into one round trip.
 */

/** Entries exist only while their fetch is in flight, so this never serves stale data. */
const inFlight = new Map<string, Promise<unknown>>()

/** Keys by the fetcher's own source text plus `deps` (not `resources`, which unrelated queries can share); `null` opts out when `deps` isn't JSON-safe. */
export function coalesceKey(fetcher: () => unknown, deps: unknown[]): string | null {
  try {
    return `${fetcher.toString()}::${JSON.stringify(deps)}`
  } catch {
    return null
  }
}

/** Runs `run()` once per outstanding `key`, sharing the result with any concurrent caller using the same key. `null` always runs fresh. */
export function withCoalescing<T>(key: string | null, run: () => Promise<T>): Promise<T> {
  if (!key) return run()
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const promise = run()
  inFlight.set(key, promise)
  const cleanup = () => {
    // Only clear this call's own entry, not a newer in-flight promise for the same key.
    if (inFlight.get(key) === promise) inFlight.delete(key)
  }
  // .then(cleanup, cleanup) instead of .finally: avoids an unhandled rejection on the derived promise.
  promise.then(cleanup, cleanup)
  return promise
}

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
