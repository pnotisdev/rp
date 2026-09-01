import { useMemo, useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi } from '@/lib/api/client'
import type { Character } from '@/lib/characters/cardSpec'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { Button } from '@/components/ui/Button'

const UNTAGGED = 'Untagged'

export function CharacterList({
  onSelect,
  onCreateNew,
}: {
  onSelect: (character: Character) => void
  onCreateNew: () => void
}) {
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const tagsAsFolders = useSettingsStore((s) => s.tagsAsFolders)
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const groups = useMemo(() => {
    const map = new Map<string, Character[]>()
    for (const c of characters) {
      const tags = c.card.tags && c.card.tags.length > 0 ? c.card.tags : [UNTAGGED]
      for (const tag of tags) {
        if (!map.has(tag)) map.set(tag, [])
        map.get(tag)!.push(c)
      }
    }
    return map
  }, [characters])

  const filtered = characters.filter((c) => c.card.name.toLowerCase().includes(search.toLowerCase()))
  const visible = tagsAsFolders && activeFolder ? groups.get(activeFolder) ?? [] : filtered

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="mb-8 flex items-center justify-between gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search characters…"
          className="max-w-xs flex-1 rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
        />
        <Button variant="primary" onClick={onCreateNew}>
          + New character
        </Button>
      </div>

      {tagsAsFolders && groups.size > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveFolder(null)}
            className={`rounded-full px-3 py-1 text-xs ${!activeFolder ? 'bg-accent/10 text-accent' : 'bg-bg-sunken text-text-muted'}`}
          >
            All
          </button>
          {[...groups.keys()].sort().map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveFolder(tag)}
              className={`rounded-full px-3 py-1 text-xs ${activeFolder === tag ? 'bg-accent/10 text-accent' : 'bg-bg-sunken text-text-muted'}`}
            >
              <span className="font-mono text-text-muted">/</span> {tag} ({groups.get(tag)!.length})
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {visible.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            className="themed-shadow group rounded-2xl bg-bg-elevated p-4 text-left transition-transform hover:-translate-y-0.5"
          >
            {c.avatarDataUrl ? (
              <img src={c.avatarDataUrl} className="mb-3 aspect-[3/4] w-full rounded-xl object-cover" />
            ) : (
              <div className="mb-3 flex aspect-[3/4] w-full items-center justify-center rounded-xl bg-bg-sunken text-2xl text-text-muted">
                {c.card.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="truncate text-sm font-medium text-text">{c.card.name}</div>
            <div className="truncate text-xs text-text-muted">{c.card.creator || ' '}</div>
          </button>
        ))}
        {visible.length === 0 && (
          <div className="col-span-full py-16 text-center text-sm text-text-muted">
            <p className="mb-3">
              No characters yet. Click <b className="text-text">+ New character</b> to get started — from
              there you can write one from scratch, start from a bundled template, generate one with AI,
              or import a SillyTavern card.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
