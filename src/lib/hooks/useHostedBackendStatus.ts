import { useEffect, useState } from 'react'
import { OpenAICompatibleClient } from '@/lib/api/openaiCompatible'
import { NovelAIClient } from '@/lib/api/novelai'
import type { ConnectionStatus } from './useConnectionStatus'

/**
 * The hosted-backend equivalent of `useConnectionStatus` — deliberately a separate hook, not a
 * branch inside that one, because the right *cadence* is different, not just the right client.
 * KoboldCpp is local and free, so polling it every 15s (that hook's own behavior) costs nothing;
 * OpenRouter/NovelAI/etc. are metered external services, so this only checks once per distinct
 * config (backend/baseUrl/apiKey/model) instead of on a timer, plus an explicit `recheck()` for a
 * "Test connection" button — Settings → Connection and the header status dot both read this same
 * hook so they can never disagree.
 *
 * `enabled: false` (the backend this instance covers isn't the one actually selected right now)
 * skips the network call entirely rather than running it in the background just to discard the
 * result — the whole reason this isn't on the same always-polling timer as KoboldCpp's check.
 */
export function useHostedBackendStatus(
  enabled: boolean,
  backend: 'openai-compatible' | 'novelai',
  baseUrl: string,
  apiKey: string,
  model: string,
): { status: ConnectionStatus; detail: string | null; recheck: () => void } {
  const [status, setStatus] = useState<ConnectionStatus>('checking')
  const [detail, setDetail] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!enabled) return
    if (!apiKey.trim()) {
      setStatus('offline')
      setDetail('No API key set.')
      return
    }
    let cancelled = false
    setStatus('checking')
    setDetail(null)
    const client = backend === 'novelai' ? new NovelAIClient(apiKey, model) : new OpenAICompatibleClient(baseUrl, apiKey, model)
    client.checkConnection().then((result) => {
      if (cancelled) return
      setStatus(result.ok ? 'online' : 'offline')
      setDetail(result.detail ?? null)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, backend, baseUrl, apiKey, model, nonce])

  return { status, detail, recheck: () => setNonce((n) => n + 1) }
}
