// Creates a new extension from a starter template and hands it to the Studio.

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { extensionsApi } from '@/lib/api/client'
import { suggestId } from '@/lib/extensions/manifest'
import { STARTER_KINDS, starterBundle, type StarterKind } from '@/lib/extensions/starter'
import { errorMessage, toastError } from '@/lib/store/useToastStore'

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; n < 100; n++) {
    const candidate = `${base.slice(0, 36)}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base.slice(0, 30)}-${Date.now() % 100000}`
}

export function NewExtensionDialog({ takenIds, onCreated, onClose }: { takenIds: string[]; onCreated: (id: string) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<StarterKind>('panel')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    const title = name.trim()
    if (!title) return
    setBusy(true)
    try {
      const id = uniqueId(suggestId(title), new Set(takenIds))
      await extensionsApi.install(starterBundle({ id, name: title, kind, description }), 'local')
      onCreated(id)
    } catch (e) {
      toastError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} title="New extension" description="Start from a working template, then edit it live in the Studio." size="md">
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Potion Brewer" autoFocus maxLength={60} />
      <div className="mb-3">
        <span className="mb-1 block text-xs font-medium text-text-muted">Template</span>
        <div className="grid grid-cols-2 gap-2">
          {STARTER_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              className={`rounded-xl px-3 py-2.5 text-left transition-colors ${kind === k.id ? 'bg-accent/10 ring-1 ring-accent/40' : 'bg-bg-sunken hover:bg-bg-sunken/70'}`}
            >
              <span className={`block text-sm font-medium ${kind === k.id ? 'text-accent' : 'text-text'}`}>{k.label}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">{k.blurb}</span>
            </button>
          ))}
        </div>
      </div>
      <TextField label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!name.trim() || busy} onClick={create}>
          Create
        </Button>
      </div>
    </Modal>
  )
}
