import { useEffect, useState } from 'react'
import { subscribe } from '@/lib/api/client'

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
      fetcher()
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
