import { useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { personasApi } from '@/lib/api/client'
import type { Persona } from '@/lib/types'
import { fileToDataUrl } from '@/lib/characters/importExport'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { EditorShell } from '@/components/ui/EditorShell'
import { errorMessage, toastError } from '@/lib/store/useToastStore'

export function PersonasView() {
  const personas = useApiQuery('personas', () => personasApi.list(), []) ?? []
  const [editing, setEditing] = useState<Persona | 'new' | null>(null)

  if (editing) {
    return <PersonaEditor persona={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
  }

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-lg text-text">Personas</h2>
        <Button variant="primary" onClick={() => setEditing('new')}>
          New persona
        </Button>
      </div>
      <p className="mb-8 max-w-lg text-sm text-text-muted">
        A persona is who you play as in a chat — your name and a short description, used as{' '}
        {'{{user}}'} context. Pick one when starting a chat.
      </p>
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
        {personas.map((p) => (
          <button
            key={p.id}
            onClick={() => setEditing(p)}
            className="themed-shadow rounded-2xl bg-bg-elevated p-4 text-left transition-transform hover:-translate-y-0.5"
          >
            {p.avatarDataUrl ? (
              <img src={p.avatarDataUrl} alt="" className="mx-auto mb-2 h-20 w-20 rounded-full object-cover" />
            ) : (
              <div className="mx-auto mb-2 flex h-20 w-20 items-center justify-center rounded-full bg-bg-sunken text-xl text-text-muted">
                {p.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="truncate text-center text-sm font-medium text-text">{p.name}</div>
          </button>
        ))}
        {personas.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-border px-6 py-14 text-center">
            <p className="mb-4 text-sm text-text-muted">No personas yet.</p>
            <Button variant="primary" onClick={() => setEditing('new')}>
              Create your first persona
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function PersonaEditor({ persona, onDone }: { persona: Persona | null; onDone: () => void }) {
  const [name, setName] = useState(persona?.name ?? '')
  const [description, setDescription] = useState(persona?.description ?? '')
  const [avatarDataUrl, setAvatarDataUrl] = useState(persona?.avatarDataUrl)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      if (persona) await personasApi.update(persona.id, { name, description, avatarDataUrl })
      else await personasApi.create({ name, description, avatarDataUrl })
    } catch (e) {
      toastError(errorMessage(e))
      return
    } finally {
      setSaving(false)
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
    <EditorShell
      onBack={onDone}
      backLabel="Personas"
      eyebrow={persona ? 'Persona' : 'New persona'}
      title={name || 'Unnamed persona'}
      footer={
        <>
          {persona ? (
            <Button variant="danger" onClick={remove}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" onClick={save} disabled={!name.trim() || saving}>
            {saving ? 'Saving…' : persona ? 'Save changes' : 'Create persona'}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-4">
        <label
          className="portrait-frame group relative flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center rounded-full border border-dashed border-border bg-bg-sunken"
          aria-label="Change persona avatar"
        >
          {avatarDataUrl ? (
            <img src={avatarDataUrl} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-[11px] text-text-muted">
              <ImagePlus size={18} strokeWidth={1.5} />
              Avatar
            </span>
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
        hint={`Who you are in this chat — appearance, background, traits. Used as {{user}} context.`}
        rows={6}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
    </EditorShell>
  )
}
