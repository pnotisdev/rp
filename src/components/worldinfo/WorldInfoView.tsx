import { useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, worldInfoBooksApi, worldsApi } from '@/lib/api/client'
import { isGlobalBook } from '@/lib/worldinfo/scope'
import type { WorldInfoBook } from '@/lib/types'
import { LorebookEditor } from './LorebookEditor'
import { BookScopePicker } from './BookScopePicker'
import { Button } from '@/components/ui/Button'
import { FileButton } from '@/components/ui/FileButton'
import { DropZone } from '@/components/ui/DropZone'
import { EditorShell } from '@/components/ui/EditorShell'
import { importLorebookFile } from '@/lib/worldinfo/lorebookIo'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { Section } from '@/components/ui/Section'
import { ViewShell } from '@/components/ui/ViewShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { confirmDialog } from '@/lib/store/useConfirmStore'

function scopeSummary(
  book: WorldInfoBook,
  names: { characters: Map<string, string>; worlds: Map<string, string> },
): string {
  if (isGlobalBook(book)) return 'Every chat'
  const labels = [
    ...(book.boundWorldIds ?? []).map((id) => names.worlds.get(id) ?? 'a world'),
    ...(book.boundCharacterIds ?? []).map((id) => names.characters.get(id) ?? 'a character'),
  ]
  if (labels.length === 0) return 'Every chat'
  if (labels.length <= 2) return labels.join(', ')
  return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`
}

export function WorldInfoView() {
  const books = useApiQuery('world-info-books', () => worldInfoBooksApi.list(), []) ?? []
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = books.find((b) => b.id === activeId)

  const names = {
    characters: new Map(characters.map((c) => [c.id, c.card.name])),
    worlds: new Map(worlds.map((w) => [w.id, w.name])),
  }

  const createBook = async () => {
    const created = await worldInfoBooksApi.create({
      name: 'New lorebook',
      book: { name: 'New lorebook', entries: [], token_budget: 512, scan_depth: 8 },
      boundChatIds: [],
      boundCharacterIds: [],
      boundWorldIds: [],
    })
    setActiveId(created.id)
  }

  const removeBook = async (id: string) => {
    const book = books.find((b) => b.id === id)
    const ok = await confirmDialog({
      title: `Delete "${book?.book.name || 'this book'}"?`,
      body: 'Its entries are removed from every chat they were active in. This cannot be undone.',
      confirmLabel: 'Delete book',
      tone: 'danger',
    })
    if (!ok) return
    await worldInfoBooksApi.remove(id)
    if (activeId === id) setActiveId(null)
  }

  const importBooks = async (files: File[]) => {
    let added = 0
    for (const file of files) {
      try {
        const book = await importLorebookFile(file)
        await worldInfoBooksApi.create({ name: book.name, book, boundChatIds: [], boundCharacterIds: [], boundWorldIds: [] })
        added++
      } catch (e) {
        toastError(errorMessage(e))
      }
    }
    if (added) toastSuccess(`Imported ${added} lorebook${added === 1 ? '' : 's'}.`)
  }

  if (active) {
    return (
      <EditorShell
        onBack={() => setActiveId(null)}
        backLabel="Lorebooks"
        eyebrow="Lorebook"
        title={active.book.name || 'Untitled'}
      >
        <Section title="Scope" description="Where this book's entries are eligible to activate." className="mb-8">
          <BookScopePicker scope={active} onChange={(patch) => worldInfoBooksApi.update(active.id, patch)} />
        </Section>

        <Section title="Entries" surface="bare">
          <LorebookEditor
            book={active.book}
            onChange={(book) => worldInfoBooksApi.update(active.id, { book, name: book.name || active.name })}
          />
        </Section>
      </EditorShell>
    )
  }

  return (
    <DropZone onFiles={importBooks} label="Drop lorebooks to import">
    <ViewShell
      title="Lorebooks"
      description="Reusable lore (SillyTavern's World Info): places, factions, history. A book with no scope applies to every chat; scope it to a character or world to keep unrelated lore out. Lore for one character lives on its card, and a world has its own lorebook too. Use a book here when several of them share it."
      actions={
        <>
          <FileButton onPick={(f) => importBooks(Array.from(f))} accept=".json,.png" multiple title="SillyTavern World Info files, lorebook JSON, or card PNGs">
            Import
          </FileButton>
          <Button variant="primary" onClick={createBook}>
            New book
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {books.map((b) => (
          <div
            key={b.id}
            className="group flex items-center justify-between rounded-xl border border-border bg-bg-elevated px-5 py-4 transition-colors hover:border-accent/40"
          >
            <button className="min-w-0 flex-1 text-left" onClick={() => setActiveId(b.id)}>
              <div className="truncate text-sm font-medium text-text">{b.book.name || 'Untitled'}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                <span>{b.book.entries.length} {b.book.entries.length === 1 ? 'entry' : 'entries'}</span>
                <span className="text-border">·</span>
                <span className={isGlobalBook(b) ? '' : 'text-accent'}>{scopeSummary(b, names)}</span>
              </div>
            </button>
            <Button
              variant="ghost"
              onClick={() => removeBook(b.id)}
              className="opacity-0 transition-opacity group-hover:opacity-100"
            >
              Delete
            </Button>
          </div>
        ))}
        {books.length === 0 && (
          <EmptyState
            action={
              <Button variant="primary" onClick={createBook}>
                Create your first book
              </Button>
            }
          >
            No lorebooks yet. Most lore can live on a character or world instead. Reach for a book when the same lore spans several of them, or import one.
          </EmptyState>
        )}
      </div>
    </ViewShell>
    </DropZone>
  )
}
