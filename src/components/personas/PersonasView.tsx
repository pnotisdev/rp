import { useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { personasApi } from '@/lib/api/client'
import type { Persona } from '@/lib/types'
import { fileToDataUrl } from '@/lib/characters/importExport'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'

export function PersonasView() {
  const personas = useApiQuery('personas', () => personasApi.list(), []) ?? []
  const [editing, setEditing] = useState<Persona | 'new' | null>(null)

  if (editing) {
    return <PersonaEditor persona={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="mb-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Personas</h2>
        <Button variant="primary" onClick={() => setEditing('new')}>
          + New persona
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4">
        {personas.map((p) => (
          <button
            key={p.id}
            onClick={() => setEditing(p)}
            className="themed-shadow rounded-2xl bg-bg-elevated p-4 text-left transition-transform hover:-translate-y-0.5"
          >
            {p.avatarDataUrl ? (
              <img src={p.avatarDataUrl} className="mb-2 h-20 w-20 rounded-full object-cover mx-auto" />
            ) : (
              <div className="mx-auto mb-2 flex h-20 w-20 items-center justify-center rounded-full bg-bg-sunken text-xl text-text-muted">
                {p.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="truncate text-center text-sm font-medium text-text">{p.name}</div>
          </button>
        ))}
        {personas.length === 0 && (
          <p className="col-span-full py-12 text-center text-sm text-text-muted">
            No personas yet — a persona is who you play as in chat.
          </p>
        )}
      </div>
    </div>
  )
}

function PersonaEditor({ persona, onDone }: { persona: Persona | null; onDone: () => void }) {
  const [name, setName] = useState(persona?.name ?? '')
  const [description, setDescription] = useState(persona?.description ?? '')
  const [avatarDataUrl, setAvatarDataUrl] = useState(persona?.avatarDataUrl)

  const save = async () => {
    if (persona) {
      await personasApi.update(persona.id, { name, description, avatarDataUrl })
    } else {
      await personasApi.create({ name, description, avatarDataUrl })
    }
    onDone()
  }

  const remove = async () => {
    if (!persona) return
    if (!confirm(`Delete persona ${persona.name}?`)) return
    await personasApi.remove(persona.id)
    onDone()
  }

  return (
    <div className="mx-auto max-w-xl p-8">
      <Button variant="ghost" onClick={onDone} className="mb-6">
        ← Back
      </Button>
      <div className="mb-6 flex items-center gap-4">
        <label className="cursor-pointer">
          {avatarDataUrl ? (
            <img src={avatarDataUrl} className="h-20 w-20 rounded-full object-cover border border-border" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full border border-dashed border-border text-xs text-text-muted">
              Avatar
            </div>
          )}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => e.target.files?.[0] && setAvatarDataUrl(await fileToDataUrl(e.target.files[0]))}
          />
        </label>
        <div className="flex-1">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <TextAreaField
        label="Description"
        hint="Who you are in this chat — appearance, background, traits. Used as {{user}} context."
        rows={5}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="flex items-center justify-between border-t border-border pt-4">
        {persona ? (
          <Button variant="danger" onClick={remove}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" onClick={save} disabled={!name.trim()}>
          Save
        </Button>
      </div>
    </div>
  )
}
