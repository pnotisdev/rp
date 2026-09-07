import type { ConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { Button } from '@/components/ui/Button'

export const STATUS_DOT = { online: 'bg-success', offline: 'bg-danger', checking: 'bg-warning' } as const
export const STATUS_LABEL = { online: 'Connected', offline: 'Not reachable', checking: 'Checking…' } as const

/**
 * The hosted-backend (OpenAI-compatible / NovelAI) equivalent of KoboldCpp's always-polling status
 * block — a "Test connection" button rather than a running poll, since `useHostedBackendStatus`
 * only checks once per distinct config plus on demand (see that hook's own doc comment for why).
 * Shared between Settings → Connection and `WelcomeView`'s inline hosted-key form so the two
 * surfaces can never show conflicting status chrome for the same backend.
 */
export function HostedConnectionStatus({
  status,
  detail,
  recheck,
}: {
  status: ConnectionStatus
  detail: string | null
  recheck: () => void
}) {
  return (
    <div className="mt-2 rounded-xl bg-bg-elevated p-5 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
          <span className="text-text">{STATUS_LABEL[status]}</span>
        </div>
        <Button onClick={recheck}>{status === 'checking' ? 'Testing…' : 'Test connection'}</Button>
      </div>
      {detail && <div className="mt-1 text-text-muted">{detail}</div>}
    </div>
  )
}
