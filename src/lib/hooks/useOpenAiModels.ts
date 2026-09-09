import { useEffect, useState } from 'react'
import { listOpenAiModels } from '@/lib/api/detectBackend'
import { isOpenMayhem } from '@/lib/api/openMayhem'

/**
 * Model ids from an OpenAI-compatible provider's `/models`, for a real dropdown instead of a
 * free-text box. `null` while loading or if the endpoint didn't answer (private `/models`, a
 * provider that doesn't expose it) — the caller falls back to a text field. Refetched only when
 * the base URL or key changes, plus on demand via `reload()`. OpenMayhem's public availability
 * is refreshed every 30 seconds and on window focus while the picker is mounted.
 */
export function useOpenAiModels(baseUrl: string, apiKey: string, enabled: boolean) {
  const [models, setModels] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!enabled || !baseUrl.trim()) {
      setModels(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setModels(null)
    setLoading(true)
    let fetching = false
    const refresh = () => {
      if (fetching) return
      fetching = true
      listOpenAiModels(baseUrl, apiKey || undefined).then((ids) => {
        if (cancelled) return
        setModels(ids ? ids.slice().sort((a, b) => a.localeCompare(b)) : null)
        setLoading(false)
      }).finally(() => { fetching = false })
    }
    refresh()
    const live = isOpenMayhem(baseUrl)
    const interval = live ? setInterval(refresh, 30000) : undefined
    if (live) window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      if (interval !== undefined) clearInterval(interval)
      if (live) window.removeEventListener('focus', refresh)
    }
  }, [baseUrl, apiKey, enabled, nonce])

  return { models, loading, reload: () => setNonce((n) => n + 1) }
}
