import { useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi } from '@/lib/api/client'
import { NewChatDialog } from './NewChatDialog'
import { Button } from '@/components/ui/Button'

export function ChatsPanel({
  activeChatId,
  onSelect,
}: {
  activeChatId: string | null
  onSelect: (id: string) => void
}) {
  const chats = useApiQuery('chats', () => chatsApi.list(), []) ?? []
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const [showNew, setShowNew] = useState(false)

  const charFor = (id: string) => characters.find((c) => c.id === id)

  return (
    <div className="flex w-64 shrink-0 flex-col bg-bg-elevated">
      <div className="flex items-center justify-between p-4">
        <h2 className="text-sm font-semibold text-text">Chats</h2>
        <Button variant="primary" onClick={() => setShowNew(true)}>
          + New
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {chats.map((chat) => {
          const character = charFor(chat.characterId)
          return (
            <button
              key={chat.id}
              onClick={() => onSelect(chat.id)}
              className={`mb-1 flex w-full items-center gap-2 rounded-2xl px-2.5 py-2 text-left transition-colors ${
                activeChatId === chat.id ? 'bg-accent/10' : 'hover:bg-bg-sunken'
              }`}
            >
              {character?.avatarDataUrl ? (
                <img src={character.avatarDataUrl} className="h-9 w-9 rounded-xl object-cover" />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-bg-sunken text-xs text-text-muted">
                  {(character?.card.name ?? '?').slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-text">
                  {character ? chat.title : `${chat.title} (character deleted)`}
                </div>
                <div className="truncate text-xs text-text-muted">
                  {new Date(chat.updatedAt).toLocaleString()}
                </div>
              </div>
            </button>
          )
        })}
        {chats.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-text-muted">No chats yet.</p>
        )}
      </div>
      {showNew && (
        <NewChatDialog
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false)
            onSelect(id)
          }}
        />
      )}
    </div>
  )
}
