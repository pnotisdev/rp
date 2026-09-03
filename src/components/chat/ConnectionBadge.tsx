import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

export function ConnectionBadge() {
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const { status, model, maxContext } = useConnectionStatus(baseUrl)

  const color = status === 'online' ? 'bg-success' : status === 'offline' ? 'bg-danger' : 'bg-warning'
  const tooltip =
    status === 'online'
      ? `Connected — ${model || baseUrl}${maxContext !== null ? ` (${maxContext.toLocaleString()} ctx)` : ''}`
      : status === 'offline'
        ? `Not reachable — ${baseUrl}`
        : `Checking ${baseUrl}…`

  return (
    <div className="flex h-2.5 w-2.5 items-center justify-center" title={tooltip}>
      <span className={`h-2 w-2 rounded-full ${color}`} />
    </div>
  )
}
