import { useState } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { profileMatches } from '@/lib/connectionProfiles'
import { CHAT_BACKEND_LABELS } from '@/lib/api/chatBackend'
import { TextField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { toastSuccess } from '@/lib/store/useToastStore'

/** Named bundles of backend, model, instruct template and sampler: one click to move between, say, a local model and a hosted one. */
export function ConnectionProfilesSection() {
  const state = useSettingsStore()
  const { connectionProfiles, saveConnectionProfile, applyConnectionProfile, removeConnectionProfile } = state
  const [name, setName] = useState('')

  const save = () => {
    if (!name.trim()) return
    saveConnectionProfile(name)
    toastSuccess(`Saved "${name.trim()}"`)
    setName('')
  }

  return (
    <Section
      title="Profiles"
      description="Save the current connection (backend, address, model, key, instruct template and sampler) under a name, and switch back to it in one click. Saved keys stay in this browser, like the live one."
    >
      {connectionProfiles.length > 0 && (
        <div className="mb-3 space-y-1">
          {connectionProfiles.map((p) => {
            const active = profileMatches(p, state)
            return (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-bg-sunken px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate text-text">{p.name}</div>
                  <div className="truncate text-xs text-text-muted">
                    {CHAT_BACKEND_LABELS[p.chatBackend]}
                    {p.chatBackendModel ? `, ${p.chatBackendModel}` : ''}, {p.instructTemplateId}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {active ? (
                    <span className="text-xs text-accent">In use</span>
                  ) : (
                    <Button variant="ghost" onClick={() => applyConnectionProfile(p.id)}>
                      Use
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => removeConnectionProfile(p.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div className="flex items-end gap-2">
        <TextField
          className="flex-1"
          label="Save the current connection as"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="Local Gemma"
        />
        <Button variant="primary" onClick={save} disabled={!name.trim()} className="mb-3">
          Save
        </Button>
      </div>
    </Section>
  )
}
