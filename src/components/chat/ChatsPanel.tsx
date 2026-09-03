import { useState } from 'react'
import { GitFork, Plus, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi, worldsApi } from '@/lib/api/client'
import { getCurrentActivity, presenceLabel } from '@/lib/world/calendar'
import type { Character } from '@/lib/characters/cardSpec'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
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
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const [showNew, setShowNew] = useState(false)
  const collapsed = useSettingsStore((s) => s.chatsPanelCollapsed)
  const setCollapsed = useSettingsStore((s) => s.setChatsPanelCollapsed)

  const charFor = (id: string) => characters.find((c) => c.id === id)

  // Only computable for a world-bound character that actually has a schedule authored — most
  // characters have neither, and the chat row just shows no dot at all.
  const presenceFor = (character: Character | undefined) => {
    if (!character?.worldId || !character.schedule?.length) return undefined
    const world = worlds.find((w) => w.id === character.worldId)
    if (!world) return undefined
    return getCurrentActivity(character.schedule, world.currentDay ?? 0, world.currentPhaseIndex ?? 0)
  }

  if (collapsed) {
    return (
      <div className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-elevated py-4">
        <button
          onClick={() => setCollapsed(false)}
          title="Expand chats"
          aria-label="Expand chats"
          className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-bg-sunken hover:text-text"
        >
          <PanelLeftOpen size={17} strokeWidth={1.75} />
        </button>
        <button
          onClick={() => setShowNew(true)}
          title="New chat"
          aria-label="New chat"
          className="mb-1 flex h-9 w-9 items-center justify-center rounded-xl text-accent transition-colors hover:bg-accent/10"
        >
          <Plus size={18} strokeWidth={1.75} />
        </button>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {chats.map((chat) => {
            const character = charFor(chat.characterId)
            return (
              <button
                key={chat.id}
                onClick={() => onSelect(chat.id)}
                title={character ? chat.title : `${chat.title} (character deleted)`}
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                  activeChatId === chat.id ? 'ring-2 ring-accent/60' : 'hover:bg-bg-sunken'
                }`}
              >
                {character?.avatarDataUrl ? (
                  <img src={character.avatarDataUrl} className="h-9 w-9 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-bg-sunken text-[10px] text-text-muted">
                    {(character?.card.name ?? '?').slice(0, 2).toUpperCase()}
                  </div>
                )}
              </button>
            )
          })}
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

  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-border bg-bg-elevated">
      <div className="flex items-center justify-between gap-2 p-4">
        <button
          onClick={() => setCollapsed(true)}
          title="Collapse chats"
          aria-label="Collapse chats"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-sunken hover:text-text"
        >
          <PanelLeftClose size={16} strokeWidth={1.75} />
        </button>
        <h2 className="mr-auto text-sm font-semibold text-text">Chats</h2>
        <Button variant="primary" onClick={() => setShowNew(true)} className="flex items-center gap-1">
          <Plus size={14} strokeWidth={2} />
          New
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {chats.map((chat) => {
          const character = charFor(chat.characterId)
          const presence = presenceFor(character)
          return (
            <button
              key={chat.id}
              onClick={() => onSelect(chat.id)}
              className={`mb-1 flex w-full items-center gap-2 rounded-2xl px-2.5 py-2 text-left transition-colors ${
                activeChatId === chat.id ? 'bg-accent/10' : 'hover:bg-bg-sunken'
              }`}
            >
              <div className="relative shrink-0">
                {character?.avatarDataUrl ? (
                  <img src={character.avatarDataUrl} className="h-9 w-9 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-bg-sunken text-xs text-text-muted">
                    {(character?.card.name ?? '?').slice(0, 2).toUpperCase()}
                  </div>
                )}
                {presence && (
                  <span
                    title={`${presenceLabel(presence.status)}${presence.activity ? ` — ${presence.activity}` : ''}`}
                    className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-elevated ${
                      presence.status === 'available' ? 'bg-accent' : 'bg-text-muted'
                    }`}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-sm text-text">
                  {chat.parentChatId && <GitFork size={12} strokeWidth={2} className="shrink-0 text-text-muted" />}
                  <span className="truncate">{character ? chat.title : `${chat.title} (character deleted)`}</span>
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
