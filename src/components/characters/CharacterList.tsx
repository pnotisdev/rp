import { useMemo, useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi } from '@/lib/api/client'
import type { Character } from '@/lib/characters/cardSpec'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { Button } from '@/components/ui/Button'
import { FileButton } from '@/components/ui/FileButton'
import { DropZone } from '@/components/ui/DropZone'
import { NewCharacterDialog, type NewCharacterStart } from './NewCharacterDialog'
import { importCharacterFiles } from '@/lib/characters/bulkImport'
import { toastError, toastSuccess } from '@/lib/store/useToastStore'
import { ViewShell } from '@/components/ui/ViewShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { tintStyle } from '@/lib/color.hue'

const UNTAGGED = 'Untagged'
const CHIP_LIMIT = 7

function Placeholder({ name }: { name: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-4xl font-semibold" style={tintStyle(name)}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

export function CharacterList({
  onSelect,
  onCreateNew,
}: {
  onSelect: (character: Character) => void
  onCreateNew: (start: NewCharacterStart) => void
}) {
  const [showNew, setShowNew] = useState(false)
  const [importing, setImporting] = useState(false)

  const importFiles = async (files: File[]) => {
    setImporting(true)
    const { created, failed } = await importCharacterFiles(files)
    setImporting(false)
    if (created.length) toastSuccess(`Imported ${created.length === 1 ? created[0].card.name : `${created.length} characters`}.`)
    if (failed.length) toastError(failed.map((f) => `${f.file}: ${f.error}`).join(' | '))
  }

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

  const needle = search.trim().toLowerCase()
  const inFolder = tagsAsFolders && activeFolder ? (groups.get(activeFolder) ?? []) : characters
  const visible = needle ? inFolder.filter((c) => c.card.name.toLowerCase().includes(needle)) : inFolder
  const tagNames = [...groups.keys()].sort((a, b) => a.localeCompare(b))
  const chip = (on: boolean) => `rounded-md px-3 py-1 text-xs transition-colors ${on ? 'bg-accent/10 font-medium text-accent' : 'bg-bg-sunken text-text-muted hover:text-text'}`

  return (
    <DropZone onFiles={importFiles} label="Drop cards to import">
    <ViewShell
      title="Characters"
      description="Your cast. Open one to edit it, or start a chat from the Chat tab."
      actions={
        <>
          <FileButton onPick={(f) => importFiles(Array.from(f))} accept=".png,.json" multiple title="Import PNG/JSON cards or rp packs">
            {importing ? 'Importing…' : 'Import'}
          </FileButton>
          <Button variant="primary" onClick={() => setShowNew(true)}>
            New character
          </Button>
        </>
      }
    >
      {showNew && (
        <NewCharacterDialog
          onClose={() => setShowNew(false)}
          onStart={(start) => onCreateNew(start)}
          onImport={(files) => {
            setShowNew(false)
            importFiles(files)
          }}
        />
      )}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search characters"
          aria-label="Search characters"
          className="w-full max-w-xs rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-base text-text outline-none focus:border-accent/70 placeholder:text-text-muted/55 sm:py-2 sm:text-sm"
        />
        {tagsAsFolders && tagNames.length > CHIP_LIMIT && (
          <select
            value={activeFolder ?? ''}
            onChange={(e) => setActiveFolder(e.target.value || null)}
            aria-label="Filter by tag"
            className="cursor-pointer rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-base text-text-muted outline-none focus:border-accent/70 sm:py-2 sm:text-sm"
          >
            <option value="">All tags</option>
            {tagNames.map((tag) => (
              <option key={tag} value={tag}>
                {tag} ({groups.get(tag)!.length})
              </option>
            ))}
          </select>
        )}
      </div>

      {tagsAsFolders && tagNames.length > 1 && tagNames.length <= CHIP_LIMIT && (
        <div className="mb-6 flex flex-wrap gap-2">
          <button onClick={() => setActiveFolder(null)} className={chip(!activeFolder)}>
            All
          </button>
          {tagNames.map((tag) => (
            <button key={tag} onClick={() => setActiveFolder(tag)} className={chip(activeFolder === tag)}>
              {tag} <span className="text-text-muted/70">{groups.get(tag)!.length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
        {visible.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            className="group rounded-lg border border-border bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-sunken"
          >
            <div className="portrait-frame mb-3 aspect-[3/4] w-full rounded-xl">
              {c.avatarDataUrl ? <img src={c.avatarDataUrl} alt="" className="h-full w-full object-cover" /> : <Placeholder name={c.card.name} />}
            </div>
            <div className="truncate px-1 text-sm font-medium text-text">{c.card.name}</div>
            <div className="truncate px-1 text-xs text-text-muted">{c.card.creator || ' '}</div>
          </button>
        ))}
        {visible.length === 0 && (
          <EmptyState
            className="col-span-full"
            action={
              <Button variant="primary" onClick={() => setShowNew(true)}>
                New character
              </Button>
            }
          >
            {search || activeFolder
              ? 'No characters match that filter.'
              : 'No characters yet. Create one from scratch, start from a template, generate one, or import a card.'}
          </EmptyState>
        )}
      </div>
    </ViewShell>
    </DropZone>
  )
}
