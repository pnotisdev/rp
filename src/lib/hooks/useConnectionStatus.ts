import { useEffect, useState } from 'react'
import { KoboldClient } from '@/lib/api/kobold'
import { detectInstructTemplateId } from '@/lib/prompt/instructTemplates'
import { invalidateTokenCache } from '@/lib/tokenCache'

export type ConnectionStatus = 'checking' | 'online' | 'offline'

export function useConnectionStatus(baseUrl: string) {
  const [status, setStatus] = useState<ConnectionStatus>('checking')
  const [model, setModel] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [maxContext, setMaxContext] = useState<number | null>(null)
  /** The builtin instruct-template id the loaded model's own chat template implies, or null when it can't be told. */
  const [detectedTemplateId, setDetectedTemplateId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const client = new KoboldClient(baseUrl)
    // Tracked separately from the `model` state so the comparison below sees the previous poll's
    // value rather than whatever React has re-rendered with.
    let lastModel: string | null = null
    setStatus('checking')

    async function check() {
      try {
        const [v, m] = await Promise.all([client.getVersion(), client.getModel()])
        if (cancelled) return
        setStatus('online')
        setVersion(v.version)
        setModel(m)
        // Someone swapped the loaded GGUF without touching this app's settings: the tokenizer is a
        // different one now, so memoized token counts from the old model no longer apply.
        if (lastModel !== null && lastModel !== m) invalidateTokenCache()
        lastModel = m
        // Best-effort and separate from the required version/model check above — an older
        // KoboldCpp build without this extra endpoint shouldn't be reported as "offline".
        client
          .getTrueMaxContextLength()
          .then((c) => !cancelled && setMaxContext(c))
          .catch(() => !cancelled && setMaxContext(null))
        client
          .getChatTemplate()
          .then((tpl) => !cancelled && setDetectedTemplateId(detectInstructTemplateId(tpl)))
          .catch(() => !cancelled && setDetectedTemplateId(null))
      } catch {
        if (!cancelled) {
          setStatus('offline')
          setModel(null)
          setVersion(null)
          setMaxContext(null)
          setDetectedTemplateId(null)
        }
      }
    }

    check()
    const interval = setInterval(check, 15000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [baseUrl])

  return { status, model, version, maxContext, detectedTemplateId }
}
