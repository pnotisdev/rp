import { useState } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { TextField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'

const STATUS_DOT = { online: 'bg-success', offline: 'bg-danger', checking: 'bg-warning' } as const
const STATUS_LABEL = { online: 'Connected', offline: 'Not reachable', checking: 'Checking…' } as const

export function ConnectionSettings() {
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const setBaseUrl = useSettingsStore((s) => s.setBaseUrl)
  const [draft, setDraft] = useState(baseUrl)
  const { status, model, version, maxContext } = useConnectionStatus(baseUrl)

  return (
    <SettingsPage>
      <Section title="KoboldCpp connection" surface="bare">
        <TextField
          label="Server URL"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setBaseUrl(draft)}
          placeholder="http://localhost:5001"
        />
        <div className="mt-6 rounded-xl bg-bg-elevated p-5 text-xs">
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
            <span className="text-text">{STATUS_LABEL[status]}</span>
          </div>
          {model && <div className="mt-1 text-text-muted">Model: {model}</div>}
          {version && <div className="text-text-muted">KoboldCpp {version}</div>}
          {maxContext !== null && (
            <div className="text-text-muted">
              Max context: {maxContext.toLocaleString()} tokens — used automatically for judge/assist
              calls (relationship scoring, choices, objectives, lore suggestions) instead of a fixed
              guess.
            </div>
          )}
          {status === 'offline' && (
            <p className="mt-2 text-text-muted">
              Make sure KoboldCpp is running and reachable at this URL. If it's on another machine,
              launch it with <code>--host 0.0.0.0</code> or your usual CORS/tunnel setup.
            </p>
          )}
        </div>
      </Section>
    </SettingsPage>
  )
}
