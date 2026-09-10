import { useEffect, useState } from 'react'
import { hasAvailableOpenMayhemProvider, loadOpenMayhemModels, type OpenMayhemEndpoint, type OpenMayhemModel } from '@/lib/api/openMayhem'

export function useOpenMayhemModels(endpoint: OpenMayhemEndpoint, enabled: boolean) {
  const [models, setModels] = useState<OpenMayhemModel[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    setModels(null)
    setLoading(enabled)
    if (!enabled) return
    let disposed = false
    let fetching = false
    const refresh = async () => {
      if (fetching) return
      fetching = true
      try {
        const catalog = await loadOpenMayhemModels(true, endpoint)
        if (!disposed) setModels(catalog.filter(hasAvailableOpenMayhemProvider).sort((a, b) => a.id.localeCompare(b.id)))
      } catch { if (!disposed) setModels(null) }
      finally { fetching = false; if (!disposed) setLoading(false) }
    }
    void refresh()
    const timer = setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [endpoint, enabled, nonce])
  return { models, loading, reload: () => setNonce((n) => n + 1) }
}
