import { useEffect, useState } from 'react'
import { KoboldClient } from '@/lib/api/kobold'

export type ConnectionStatus = 'checking' | 'online' | 'offline'

export function useConnectionStatus(baseUrl: string) {
  const [status, setStatus] = useState<ConnectionStatus>('checking')
  const [model, setModel] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [maxContext, setMaxContext] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const client = new KoboldClient(baseUrl)
    setStatus('checking')

    async function check() {
      try {
        const [v, m] = await Promise.all([client.getVersion(), client.getModel()])
        if (cancelled) return
        setStatus('online')
        setVersion(v.version)
        setModel(m)
        // Best-effort and separate from the required version/model check above — an older
        // KoboldCpp build without this extra endpoint shouldn't be reported as "offline".
        client
          .getTrueMaxContextLength()
          .then((c) => !cancelled && setMaxContext(c))
          .catch(() => !cancelled && setMaxContext(null))
      } catch {
        if (!cancelled) {
          setStatus('offline')
          setModel(null)
          setVersion(null)
          setMaxContext(null)
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

  return { status, model, version, maxContext }
}
