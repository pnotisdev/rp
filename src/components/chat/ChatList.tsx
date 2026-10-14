import { useRef, useState } from 'react'
import { Copy, GitFork, MessageSquarePlus, MoreHorizontal, Pencil, Pin, PinOff, Star, Trash2 } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi, worldsApi } from '@/lib/api/client'
import { useChatBackendClient } from '@/lib/hooks/useChatBackendClient'
import { createChat } from '@/lib/chat/createChat'
import { getCurrentActivity, presenceLabel } from '@/lib/world/calendar'
import { getWorldTemplate } from '@/lib/world/worldTemplates'
import type { Character } from '@/lib/characters/cardSpec'
import type { Chat } from '@/lib/types'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { TrashPanel } from './TrashPanel'

const MENU_ITEM = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-text hover:bg-bg-sunken'

/** The chat history list: pinned first, inline rename, and a per-row action menu. Rendered in the sidebar and on the mobile chat screen. */
export function ChatList({ activeChatId, onSelect }: { activeChatId: string | null; onSelect: (id: string | null) => void }) {
  const unsortedChats = useApiQuery('chats', () => chatsApi.list(), []) ?? []
  // Stable sort: pinning a chat doesn't reshuffle the rest.
  const chats = [...unsortedChats].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const trashCount = useApiQuery('chats', () => chatsApi.trash(), [])?.length ?? 0
  const client = useChatBackendClient()
  const [showTrash, setShowTrash] = useState(false)
  const [menuForId, setMenuForId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const charFor = (id: string) => characters.find((c) => c.id === id)

  // Only world-bound characters with a schedule have presence; everyone else shows no dot.
  const presenceFor = (character: Character | undefined) => {
    if (!character?.worldId || !character.schedule?.length) return undefined
    const world = worlds.find((w) => w.id === character.worldId)
    if (!world) return undefined
    return getCurrentActivity(character.schedule, world.currentDay ?? 0, world.currentPhaseIndex ?? 0)
  }

  // Runs a row action with the menu closed, the row marked busy, and errors toasted.
  const act = async (chat: Chat, fn: () => Promise<void>) => {
    setMenuForId(null)
    setBusyId(chat.id)
    try {
      await fn()
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const startRename = (chat: Chat) => {
    setMenuForId(null)
    setRenamingId(chat.id)
    setRenameDraft(chat.title)
    requestAnimationFrame(() => renameInputRef.current?.select())
  }

  const commitRename = async (chat: Chat) => {
    const next = renameDraft.trim()
    setRenamingId(null)
    if (!next || next === chat.title) return
    try {
      await chatsApi.update(chat.id, { title: next })
    } catch (e) {
      toastError(errorMessage(e))
    }
  }

  const togglePin = (chat: Chat) => act(chat, async () => void (await chatsApi.update(chat.id, { pinned: !chat.pinned })))

  // Forking with no cutoff clones the whole chat, and links it back via `parentChatId`.
  const duplicateChat = (chat: Chat) => act(chat, async () => onSelect((await chatsApi.fork(chat.id)).id))

  const quickNewSameCharacter = (chat: Chat) =>
    act(chat, async () => {
      const character = charFor(chat.characterId)
      if (!character) return
      const world = worlds.find((w) => w.id === character.worldId)
      onSelect((await createChat({ character, world, personaId: chat.personaId, mode: chat.mode, client })).id)
    })

  const deleteChat = async (chat: Chat) => {
    setMenuForId(null)
    const ok = await confirmDialog({
      title: `Delete "${chat.title}"?`,
      body: 'Moves it to the trash. Recoverable there for 30 days, or you can delete it for good right away.',
      confirmLabel: 'Delete chat',
      tone: 'danger',
    })
    if (!ok) return
    await act(chat, async () => {
      await chatsApi.remove(chat.id)
      if (activeChatId === chat.id) onSelect(null)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {chats.map((chat) => {
          const character = charFor(chat.characterId)
          const presence = presenceFor(character)
          const isRenaming = renamingId === chat.id
          const isMenuOpen = menuForId === chat.id
          const isActive = activeChatId === chat.id
          const subtitle = [new Date(chat.updatedAt).toLocaleString(), chat.mode && getWorldTemplate(chat.mode).label].filter(Boolean).join(' · ')
          return (
            <div key={chat.id} className="group/row relative">
              <button
                onClick={() => !isRenaming && onSelect(chat.id)}
                disabled={busyId === chat.id}
                title={presence ? `${subtitle}\n${presenceLabel(presence.status)}${presence.activity ? `. ${presence.activity}` : ''}` : subtitle}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors disabled:opacity-50 ${
                  isActive ? 'bg-bg-sunken text-text' : 'text-text-muted hover:bg-bg-sunken/60 hover:text-text'
                }`}
              >
                <span className="relative shrink-0">
                  {character?.avatarDataUrl ? (
                    <img src={character.avatarDataUrl} className="h-5 w-5 rounded object-cover" />
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-bg-sunken text-[9px] text-text-muted">
                      {(character?.card.name ?? '?').slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  {presence?.status === 'available' && <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-bg bg-success" />}
                </span>
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(chat)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onBlur={() => commitRename(chat)}
                    className="min-w-0 flex-1 rounded border border-accent/60 bg-bg px-1 py-px text-[13px] text-text outline-none"
                  />
                ) : (
                  <>
                    {chat.pinned && <Star size={11} strokeWidth={2} className="shrink-0 text-accent" fill="currentColor" />}
                    {chat.parentChatId && <GitFork size={11} strokeWidth={2} className="shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{character ? chat.title : `${chat.title} (character deleted)`}</span>
                    {chat.hasUnreadOutreach && (
                      <span title={`${character?.card.name ?? 'They'} texted you first`} className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    )}
                  </>
                )}
              </button>
              {!isRenaming && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuForId(isMenuOpen ? null : chat.id)
                  }}
                  title="Chat actions"
                  aria-label="Chat actions"
                  className={`absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-text-muted transition-opacity hover:text-text focus:opacity-100 group-hover/row:opacity-100 ${
                    isMenuOpen ? 'bg-bg text-text opacity-100' : 'bg-bg-sunken opacity-0 max-md:opacity-100'
                  }`}
                >
                  <MoreHorizontal size={14} strokeWidth={2} />
                </button>
              )}
              {isMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuForId(null)} />
                  <div className="absolute right-1 top-8 z-50 w-52 overflow-hidden rounded-lg border border-border bg-bg-elevated py-1">
                    <button onClick={() => togglePin(chat)} className={MENU_ITEM}>
                      {chat.pinned ? <PinOff size={13} className="shrink-0 text-text-muted" /> : <Pin size={13} className="shrink-0 text-text-muted" />}
                      {chat.pinned ? 'Unpin' : 'Pin to top'}
                    </button>
                    <button onClick={() => startRename(chat)} className={MENU_ITEM}>
                      <Pencil size={13} className="shrink-0 text-text-muted" />
                      Rename
                    </button>
                    <button onClick={() => duplicateChat(chat)} className={MENU_ITEM}>
                      <Copy size={13} className="shrink-0 text-text-muted" />
                      Duplicate (full copy)
                    </button>
                    {character && (
                      <button onClick={() => quickNewSameCharacter(chat)} className={MENU_ITEM}>
                        <MessageSquarePlus size={13} className="shrink-0 text-text-muted" />
                        New chat, same character
                      </button>
                    )}
                    <div className="my-1 h-px bg-border" />
                    <button onClick={() => deleteChat(chat)} className={`${MENU_ITEM} !text-danger hover:!bg-danger/10`}>
                      <Trash2 size={13} className="shrink-0" />
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
        {chats.length === 0 && <p className="px-2 py-3 text-xs text-text-muted">No chats yet.</p>}
      </div>
      <button
        onClick={() => setShowTrash(true)}
        className="mx-2 mb-1 mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-bg-sunken/60 hover:text-text"
      >
        <Trash2 size={13} className="shrink-0" />
        Trash
        {trashCount > 0 && <span className="ml-auto tabular-nums">{trashCount}</span>}
      </button>
      {showTrash && (
        <TrashPanel
          onClose={() => setShowTrash(false)}
          onRestored={(id) => {
            setShowTrash(false)
            onSelect(id)
          }}
        />
      )}
    </div>
  )
}
