import { useEffect, useState } from 'react'
import type { StoredMessage } from '@/lib/types'
import { charactersApi, chatsApi, messagesApi } from '@/lib/api/client'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { Modal } from '@/components/ui/Modal'
import { SegmentedControl } from '@/components/ui/SegmentedControl'

interface SearchPanelProps {
  /** The currently open chat — its own matches jump in-place instead of "switching" to it. */
  chatId: string
  messages: StoredMessage[]
  onClose: () => void
  onJumpToMessage: (id: string) => void
  onJumpToChat: (chatId: string) => void
}

function snippet(text: string): string {
  return text.length > 140 ? `${text.slice(0, 140)}…` : text
}

export function SearchPanel({ chatId, messages, onClose, onJumpToMessage, onJumpToChat }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'chat' | 'all'>('chat')
  const [allResults, setAllResults] = useState<StoredMessage[]>([])
  const [searching, setSearching] = useState(false)

  const chats = useApiQuery('chats', () => chatsApi.list(), []) ?? []
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []

  const chatLabel = (id: string): string => {
    const c = chats.find((c) => c.id === id)
    if (!c) return 'Unknown chat'
    const char = characters.find((ch) => ch.id === c.characterId)
    return `${char?.card.name ?? '?'} — ${c.title}`
  }

  const q = query.trim()

  // Cross-chat search hits the server (other chats' messages aren't loaded client-side) —
  // debounced so it doesn't fire on every keystroke.
  useEffect(() => {
    if (scope !== 'all' || !q) {
      setAllResults([])
      return
    }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(() => {
      messagesApi
        .search(q)
        .then((r) => !cancelled && setAllResults(r))
        .finally(() => !cancelled && setSearching(false))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [scope, q])

  const inChatResults = q ? messages.filter((m) => m.text.toLowerCase().includes(q.toLowerCase())) : []

  return (
    <Modal onClose={onClose} title="Search messages" size="xl" scrollable>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a word or phrase…"
          className="mb-3 w-full rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 placeholder:text-text-muted/55"
        />
        <div className="mb-3">
          <SegmentedControl
            size="sm"
            options={[
              { value: 'chat', label: 'This chat' },
              { value: 'all', label: 'All chats' },
            ]}
            value={scope}
            onChange={setScope}
          />
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto">
          {!q && <p className="py-8 text-center text-xs text-text-muted">Start typing to search.</p>}

          {q && scope === 'chat' && inChatResults.length === 0 && (
            <p className="py-8 text-center text-xs text-text-muted">No matches in this chat.</p>
          )}
          {q &&
            scope === 'chat' &&
            inChatResults.map((m) => (
              <button
                key={m.id}
                onClick={() => onJumpToMessage(m.id)}
                className="block w-full rounded-xl bg-bg-sunken px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-bg-sunken/60"
              >
                <div className="mb-0.5 flex items-center justify-between text-text-muted">
                  <span className="font-medium text-text">{m.name}</span>
                  <span>{new Date(m.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-text-muted">{snippet(m.text)}</div>
              </button>
            ))}

          {q && scope === 'all' && searching && <p className="py-8 text-center text-xs text-text-muted">Searching…</p>}
          {q && scope === 'all' && !searching && allResults.length === 0 && (
            <p className="py-8 text-center text-xs text-text-muted">No matches anywhere.</p>
          )}
          {q &&
            scope === 'all' &&
            !searching &&
            allResults.map((m) => (
              <button
                key={m.id}
                onClick={() => (m.chatId === chatId ? onJumpToMessage(m.id) : onJumpToChat(m.chatId))}
                className="block w-full rounded-xl bg-bg-sunken px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-bg-sunken/60"
              >
                <div className="mb-0.5 flex items-center justify-between text-text-muted">
                  <span className="font-medium text-text">{chatLabel(m.chatId)}</span>
                  <span>{new Date(m.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-text-muted">{snippet(m.text)}</div>
              </button>
            ))}
        </div>
    </Modal>
  )
}
