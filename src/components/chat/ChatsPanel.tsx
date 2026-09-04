import { useRef, useState } from 'react'
import { Copy, GitFork, MessageSquarePlus, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi, worldsApi } from '@/lib/api/client'
import { createChat } from '@/lib/chat/createChat'
import { getCurrentActivity, presenceLabel } from '@/lib/world/calendar'
import type { Character } from '@/lib/characters/cardSpec'
import type { Chat } from '@/lib/types'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { NewChatDialog } from './NewChatDialog'
import { Button } from '@/components/ui/Button'

export function ChatsPanel({
  activeChatId,
  onSelect,
}: {
  activeChatId: string | null
  onSelect: (id: string | null) => void
}) {
  const chats = useApiQuery('chats', () => chatsApi.list(), []) ?? []
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const [showNew, setShowNew] = useState(false)
  const collapsed = useSettingsStore((s) => s.chatsPanelCollapsed)
  const setCollapsed = useSettingsStore((s) => s.setChatsPanelCollapsed)

  // Section 14's "chat management basics" — rename, duplicate, one-click "new chat, same
  // character & persona," and delete, none of which had any UI before this. One row menu at a
  // time; renaming is inline (the row's title becomes the input, no separate dialog).
  const [menuForId, setMenuForId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const charFor = (id: string) => characters.find((c) => c.id === id)

  // Only computable for a world-bound character that actually has a schedule authored — most
  // characters have neither, and the chat row just shows no dot at all.
  const presenceFor = (character: Character | undefined) => {
    if (!character?.worldId || !character.schedule?.length) return undefined
    const world = worlds.find((w) => w.id === character.worldId)
    if (!world) return undefined
    return getCurrentActivity(character.schedule, world.currentDay ?? 0, world.currentPhaseIndex ?? 0)
  }

  const startRename = (chat: Chat) => {
    setMenuForId(null)
    setRenamingId(chat.id)
    setRenameDraft(chat.title)
    // The input doesn't exist yet on this same tick — focus once it's actually mounted.
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

  const duplicateChat = async (chat: Chat) => {
    setMenuForId(null)
    setBusyId(chat.id)
    try {
      // Forking with no cutoff message clones the entire chat — history, relationship state,
      // events, facts — which is exactly what "duplicate" means here; a real independent copy,
      // not a fresh start. It lands linked via `parentChatId` the same as any other fork, which
      // doubles as a free "jump back to the original" affordance.
      const copy = await chatsApi.fork(chat.id)
      onSelect(copy.id)
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const quickNewSameCharacter = async (chat: Chat) => {
    setMenuForId(null)
    const character = charFor(chat.characterId)
    if (!character) return
    setBusyId(chat.id)
    try {
      const world = worlds.find((w) => w.id === character.worldId)
      const fresh = await createChat({ character, world, personaId: chat.personaId })
      onSelect(fresh.id)
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const deleteChat = async (chat: Chat) => {
    setMenuForId(null)
    const ok = await confirmDialog({
      title: `Delete "${chat.title}"?`,
      body: "This removes the whole conversation and can't be undone.",
      confirmLabel: 'Delete chat',
      tone: 'danger',
    })
    if (!ok) return
    setBusyId(chat.id)
    try {
      await chatsApi.remove(chat.id)
      // Otherwise the app would keep pointing at a now-nonexistent chat id — ChatWindow falls
      // back to its empty state gracefully, but the sidebar would show nothing selected forever.
      if (activeChatId === chat.id) onSelect(null)
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  // The collapsed mini-rail exists to save desktop width while keeping some panel visible
  // alongside a wide ChatWindow — a trade that doesn't make sense on a phone, where there's no
  // width to spare in the first place. So below `md` it's always the full list, `collapsed` or
  // not; the two variants below just get responsive visibility instead of an early return.
  const newChatDialog = showNew && (
    <NewChatDialog
      onClose={() => setShowNew(false)}
      onCreated={(id) => {
        setShowNew(false)
        onSelect(id)
      }}
    />
  )

  if (collapsed) {
    return (
      <>
      <div className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-elevated py-4 md:flex">
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
      </div>
      {fullChatList(true)}
      {/* Mounted here, a sibling of both variants — not inside the `hidden md:flex` rail above,
          which is `display:none` on a phone and would take the dialog down with it. */}
      {newChatDialog}
      </>
    )
  }

  return fullChatList(false)

  function fullChatList(mobileOnly: boolean) {
    return (
    <div className={`${mobileOnly ? 'flex md:hidden' : 'flex'} w-full shrink-0 flex-col border-r border-border bg-bg-elevated md:w-64`}>
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
          const isRenaming = renamingId === chat.id
          const isMenuOpen = menuForId === chat.id
          const isBusy = busyId === chat.id
          return (
            <div key={chat.id} className="relative mb-1">
              <button
                onClick={() => !isRenaming && onSelect(chat.id)}
                disabled={isBusy}
                className={`flex w-full items-center gap-2 rounded-2xl px-2.5 py-2 text-left transition-colors disabled:opacity-50 ${
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
                      className="w-full rounded-lg bg-bg-elevated px-1.5 py-0.5 text-sm text-text outline-none ring-1 ring-accent/40"
                    />
                  ) : (
                    <div className="flex items-center gap-1.5 truncate text-sm text-text">
                      {chat.parentChatId && <GitFork size={12} strokeWidth={2} className="shrink-0 text-text-muted" />}
                      <span className="truncate">{character ? chat.title : `${chat.title} (character deleted)`}</span>
                    </div>
                  )}
                  <div className="truncate text-xs text-text-muted">
                    {isBusy ? 'Working…' : new Date(chat.updatedAt).toLocaleString()}
                  </div>
                </div>
              </button>
              {!isRenaming && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuForId(isMenuOpen ? null : chat.id)
                  }}
                  title="Chat actions"
                  aria-label="Chat actions"
                  className={`absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-elevated hover:text-text ${
                    isMenuOpen ? 'bg-bg-elevated text-text' : ''
                  }`}
                >
                  <MoreHorizontal size={15} strokeWidth={2} />
                </button>
              )}
              {isMenuOpen && (
                <>
                  {/* Click-outside-to-close backdrop, same technique as Modal/CommandPalette's own. */}
                  <div className="fixed inset-0 z-40" onClick={() => setMenuForId(null)} />
                  <div className="absolute right-1.5 top-10 z-50 w-52 overflow-hidden rounded-xl border border-border bg-bg-elevated py-1 themed-shadow">
                    <button
                      onClick={() => startRename(chat)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-bg-sunken"
                    >
                      <Pencil size={13} strokeWidth={2} className="shrink-0 text-text-muted" />
                      Rename
                    </button>
                    <button
                      onClick={() => duplicateChat(chat)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-bg-sunken"
                    >
                      <Copy size={13} strokeWidth={2} className="shrink-0 text-text-muted" />
                      Duplicate (full copy)
                    </button>
                    {character && (
                      <button
                        onClick={() => quickNewSameCharacter(chat)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-bg-sunken"
                      >
                        <MessageSquarePlus size={13} strokeWidth={2} className="shrink-0 text-text-muted" />
                        New chat, same character &amp; persona
                      </button>
                    )}
                    <div className="my-1 h-px bg-border" />
                    <button
                      onClick={() => deleteChat(chat)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger/10"
                    >
                      <Trash2 size={13} strokeWidth={2} className="shrink-0" />
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
        {chats.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-text-muted">No chats yet.</p>
        )}
      </div>
      {/* In collapsed mode the fragment above renders this once as a sibling of both variants —
          don't also mount it here in the `mobileOnly` copy. */}
      {!mobileOnly && newChatDialog}
    </div>
    )
  }
}
