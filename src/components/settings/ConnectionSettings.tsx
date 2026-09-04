import { useState } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { BUILTIN_INSTRUCT_TEMPLATES } from '@/lib/prompt/instructTemplates'
import { TextField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'
import { Button } from '@/components/ui/Button'
import { toastSuccess } from '@/lib/store/useToastStore'

const STATUS_DOT = { online: 'bg-success', offline: 'bg-danger', checking: 'bg-warning' } as const
const STATUS_LABEL = { online: 'Connected', offline: 'Not reachable', checking: 'Checking…' } as const
const BUILTIN_IDS = new Set(BUILTIN_INSTRUCT_TEMPLATES.map((t) => t.id))

export function ConnectionSettings() {
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const setBaseUrl = useSettingsStore((s) => s.setBaseUrl)
  const instructTemplateId = useSettingsStore((s) => s.instructTemplateId)
  const setInstructTemplateId = useSettingsStore((s) => s.setInstructTemplateId)
  const [draft, setDraft] = useState(baseUrl)
  const { status, model, version, maxContext, detectedTemplateId } = useConnectionStatus(baseUrl)

  // Only nudge when the model clearly implies a builtin format AND the active template is itself a
  // builtin we can compare against — a user on a hand-tuned custom template is assumed to know.
  const detected = detectedTemplateId ? BUILTIN_INSTRUCT_TEMPLATES.find((t) => t.id === detectedTemplateId) : undefined
  const templateMismatch =
    detected && BUILTIN_IDS.has(instructTemplateId) && detectedTemplateId !== instructTemplateId ? detected : undefined

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

        {templateMismatch && (
          <div className="mt-4 rounded-xl bg-warning/10 p-4 text-xs ring-1 ring-warning/30">
            <p className="text-text">
              This model's chat template looks like <strong>{templateMismatch.name}</strong>, but the
              active instruct template is{' '}
              <strong>
                {BUILTIN_INSTRUCT_TEMPLATES.find((t) => t.id === instructTemplateId)?.name ?? instructTemplateId}
              </strong>
              . A mismatch is the usual cause of a model that rambles, ignores its character, leaks
              instructions, or never stops.
            </p>
            <div className="mt-2.5">
              <Button
                variant="primary"
                onClick={() => {
                  setInstructTemplateId(templateMismatch.id)
                  toastSuccess(`Instruct template set to ${templateMismatch.name}`)
                }}
              >
                Switch to {templateMismatch.name}
              </Button>
            </div>
          </div>
        )}
      </Section>
    </SettingsPage>
  )
}
