import { useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { worldsApi } from '@/lib/api/client'
import type { WorldCard } from '@/lib/types'
import { fileToDataUrl } from '@/lib/characters/importExport'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { LorebookEditor } from '@/components/worldinfo/LorebookEditor'

function blankWorld(): Omit<WorldCard, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'New World',
    description: '',
    rules: '',
    lorebook: { name: '', entries: [], token_budget: 512, scan_depth: 8 },
  }
}

export function WorldsView() {
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const [selected, setSelected] = useState<WorldCard | 'new' | null>(null)

  if (selected) {
    return (
      <WorldEditor
        world={selected === 'new' ? null : selected}
        onDone={() => setSelected(null)}
      />
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="mb-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Worlds</h2>
        <Button variant="primary" onClick={() => setSelected('new')}>
          + New world
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {worlds.map((w) => (
          <button
            key={w.id}
            onClick={() => setSelected(w)}
            className="themed-shadow group rounded-2xl bg-bg-elevated p-4 text-left transition-transform hover:-translate-y-0.5"
          >
            {w.avatarDataUrl ? (
              <img src={w.avatarDataUrl} className="mb-3 aspect-[3/4] w-full rounded-xl object-cover" />
            ) : (
              <div className="mb-3 flex aspect-[3/4] w-full items-center justify-center rounded-xl bg-bg-sunken text-2xl text-text-muted">
                <span className="font-mono">~</span>
              </div>
            )}
            <div className="truncate text-sm font-medium text-text">{w.name}</div>
            <div className="truncate text-xs text-text-muted">{w.lorebook.entries.length} lore entries</div>
          </button>
        ))}
        {worlds.length === 0 && (
          <p className="col-span-full py-16 text-center text-sm text-text-muted">
            No worlds yet. A world holds the setting and shared lore that any number of characters can
            live in — create one, then assign it to a character from that character's editor.
          </p>
        )}
      </div>
    </div>
  )
}

function WorldEditor({ world, onDone }: { world: WorldCard | null; onDone: () => void }) {
  const base = world ?? { id: '', createdAt: 0, updatedAt: 0, ...blankWorld() }
  const [name, setName] = useState(base.name)
  const [description, setDescription] = useState(base.description)
  const [rules, setRules] = useState(base.rules ?? '')
  const [lorebook, setLorebook] = useState(base.lorebook)
  const [avatarDataUrl, setAvatarDataUrl] = useState(base.avatarDataUrl)

  const save = async () => {
    if (world) {
      await worldsApi.update(world.id, { name, description, rules, lorebook, avatarDataUrl })
    } else {
      await worldsApi.create({ name, description, rules, lorebook, avatarDataUrl })
    }
    onDone()
  }

  const remove = async () => {
    if (!world) return
    if (!confirm(`Delete ${world.name}? Characters living here will be un-assigned, not deleted.`)) return
    await worldsApi.remove(world.id)
    onDone()
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <Button variant="ghost" onClick={onDone} className="mb-6">
        ← Back to worlds
      </Button>

      <div className="mb-6 flex items-center gap-4">
        <label className="cursor-pointer">
          {avatarDataUrl ? (
            <img src={avatarDataUrl} className="h-20 w-20 rounded-xl object-cover" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-border text-xs text-text-muted">
              Cover
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
        hint="Setting, tone, atmosphere — always included for any character living here."
        rows={4}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <TextAreaField
        label="Rules"
        hint="Hard constraints the model should never contradict — magic system, tech level, taboos."
        rows={3}
        value={rules}
        onChange={(e) => setRules(e.target.value)}
      />

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6" open>
        <summary className="cursor-pointer text-sm font-medium text-text">
          World lore ({lorebook.entries.length} entries)
        </summary>
        <div className="mt-3">
          <LorebookEditor
            book={lorebook}
            onChange={setLorebook}
            aiContext={{ name, description, extra: rules ? `World rules: ${rules}` : undefined }}
          />
        </div>
      </details>

      <div className="flex items-center justify-between border-t border-border pt-4">
        {world ? (
          <Button variant="danger" onClick={remove}>
            Delete world
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" onClick={save} disabled={!name.trim()}>
          {world ? 'Save changes' : 'Create world'}
        </Button>
      </div>
    </div>
  )
}
