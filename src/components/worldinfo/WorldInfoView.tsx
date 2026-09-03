import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, worldInfoBooksApi, worldsApi } from '@/lib/api/client'
import { isGlobalBook } from '@/lib/worldinfo/scope'
import type { WorldInfoBook } from '@/lib/types'
import { LorebookEditor } from './LorebookEditor'
import { BookScopePicker } from './BookScopePicker'
import { Button } from '@/components/ui/Button'
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
      name: 'New World Info',
      book: { name: 'New World Info', entries: [], token_budget: 512, scan_depth: 8 },
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

  if (active) {
    return (
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-6 sm:p-8">
        <Button variant="ghost" onClick={() => setActiveId(null)} className="mb-6 -ml-2 flex items-center gap-1">
          <ChevronLeft size={15} strokeWidth={2} />
          All books
        </Button>

        <Section title="Scope" description="Where this book's entries are eligible to activate." className="mb-8">
          <BookScopePicker
            scope={active}
            onChange={(patch) => worldInfoBooksApi.update(active.id, patch)}
          />
        </Section>

        <Section title="Entries" surface="bare">
          <LorebookEditor
            book={active.book}
            onChange={(book) => worldInfoBooksApi.update(active.id, { book, name: book.name || active.name })}
          />
        </Section>
      </div>
    )
  }

  return (
    <ViewShell
      title="World Info"
      description="Standalone lorebooks — locations, factions, history, world rules. A book with no scope is available to every chat; scope it to a character or world to keep unrelated lore out. Lore that belongs to one character lives on the character card instead."
      actions={
        <Button variant="primary" onClick={createBook}>
          New book
        </Button>
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
            No standalone world info books yet. Most lore can live on a character or world instead —
            reach for a book when the same lore spans several of them.
          </EmptyState>
        )}
      </div>
    </ViewShell>
  )
}
