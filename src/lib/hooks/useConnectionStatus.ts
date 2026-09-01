import { useEffect, useState } from 'react'
import { KoboldClient } from '@/lib/api/kobold'

export type ConnectionStatus = 'checking' | 'online' | 'offline'

export function useConnectionStatus(baseUrl: string) {
  const [status, setStatus] = useState<ConnectionStatus>('checking')
  const [model, setModel] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)

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
      } catch {
        if (!cancelled) {
          setStatus('offline')
          setModel(null)
          setVersion(null)
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

  return { status, model, version }
}
