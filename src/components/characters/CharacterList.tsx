import { useMemo, useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi } from '@/lib/api/client'
import type { Character } from '@/lib/characters/cardSpec'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { Button } from '@/components/ui/Button'
import { ViewShell } from '@/components/ui/ViewShell'
import { EmptyState } from '@/components/ui/EmptyState'

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
    <ViewShell
      title="Characters"
      width="wide"
      actions={
        <Button variant="primary" onClick={onCreateNew}>
          New character
        </Button>
      }
    >
      <div className="mb-6">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search characters…"
          className="w-full max-w-xs rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 placeholder:text-text-muted/55 sm:py-2 sm:text-sm"
        />
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
        {visible.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            className="themed-shadow group rounded-2xl bg-bg-elevated p-3 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="portrait-frame mb-3 aspect-[3/4] w-full rounded-xl">
              {c.avatarDataUrl ? (
                <img src={c.avatarDataUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-bg-sunken text-2xl text-text-muted">
                  {c.card.name.slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div className="truncate px-1 text-sm font-medium text-text">{c.card.name}</div>
            <div className="truncate text-xs text-text-muted">{c.card.creator || ' '}</div>
          </button>
        ))}
        {visible.length === 0 && (
          <EmptyState
            className="col-span-full"
            action={
              <Button variant="primary" onClick={onCreateNew}>
                New character
              </Button>
            }
          >
            {search || activeFolder
              ? 'No characters match that filter.'
              : 'No characters yet. Create one from scratch, start from a bundled template, generate one with AI, or import a SillyTavern card.'}
          </EmptyState>
        )}
      </div>
    </ViewShell>
  )
}
