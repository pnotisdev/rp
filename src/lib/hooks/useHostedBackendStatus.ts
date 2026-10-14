import { useEffect, useState } from 'react'
import { OpenAICompatibleClient } from '@/lib/api/openaiCompatible'
import { NovelAIClient } from '@/lib/api/novelai'
import type { ConnectionStatus } from './useConnectionStatus'

/** The hosted-backend equivalent of `useConnectionStatus` */
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
    // A missing key isn't a hard failure — a local OpenAI-compatible server (LM Studio, llama.cpp, Ollama, TabbyAPI) usually needs none.
    if (!apiKey.trim() && backend === 'novelai') {
      setStatus('offline')
      setDetail('NovelAI needs an API key.')
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
