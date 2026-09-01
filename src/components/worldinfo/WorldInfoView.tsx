import { useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { worldInfoBooksApi } from '@/lib/api/client'
import { LorebookEditor } from './LorebookEditor'
import { Button } from '@/components/ui/Button'

export function WorldInfoView() {
  const books = useApiQuery('world-info-books', () => worldInfoBooksApi.list(), []) ?? []
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = books.find((b) => b.id === activeId)

  const createBook = async () => {
    const created = await worldInfoBooksApi.create({
      name: 'New World Info',
      book: { name: 'New World Info', entries: [], token_budget: 512, scan_depth: 8 },
      boundChatIds: [],
    })
    setActiveId(created.id)
  }

  const removeBook = async (id: string) => {
    if (!confirm('Delete this world info book?')) return
    await worldInfoBooksApi.remove(id)
    if (activeId === id) setActiveId(null)
  }

  if (active) {
    return (
      <div className="mx-auto max-w-2xl flex-1 overflow-y-auto p-8">
        <Button variant="ghost" onClick={() => setActiveId(null)} className="mb-6">
          ← Back to World Info
        </Button>
        <LorebookEditor
          book={active.book}
          onChange={(book) => worldInfoBooksApi.update(active.id, { book, name: book.name || active.name })}
        />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">World Info</h2>
        <Button variant="primary" onClick={createBook}>
          + New book
        </Button>
      </div>
      <p className="mb-8 text-xs text-text-muted max-w-lg">
        Global lorebooks are available to every chat. Character-specific lore lives inside each
        character's card — edit it from the character's Advanced section.
      </p>
      <div className="space-y-3">
        {books.map((b) => (
          <div
            key={b.id}
            className="flex items-center justify-between rounded-2xl bg-bg-elevated px-6 py-5"
          >
            <button className="text-left" onClick={() => setActiveId(b.id)}>
              <div className="text-sm font-medium text-text">{b.book.name || 'Untitled'}</div>
              <div className="text-xs text-text-muted">{b.book.entries.length} entries</div>
            </button>
            <Button variant="ghost" onClick={() => removeBook(b.id)}>
              Delete
            </Button>
          </div>
        ))}
        {books.length === 0 && (
          <p className="py-8 text-center text-sm text-text-muted">
            No global world info yet — character relationships, locations, events, and world rules
            you add here are available across chats.
          </p>
        )}
      </div>
    </div>
  )
}
