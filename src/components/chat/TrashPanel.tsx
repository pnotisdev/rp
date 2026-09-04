import { useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi } from '@/lib/api/client'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

/**
 * Deleted chats aren't actually gone — `DELETE /api/chats/:id` soft-deletes (sets `Chat.deletedAt`)
 * rather than cascading immediately, so a mistaken delete stays recoverable here until it's either
 * restored, purged by hand, or swept up by the server's own 30-day retention window
 * (`purgeExpiredTrash` in `server/app.ts`). This panel is the only UI for the other two: restore,
 * or purge right now instead of waiting out the window.
 */
export function TrashPanel({ onClose, onRestored }: { onClose: () => void; onRestored: (chatId: string) => void }) {
  const trashed = useApiQuery('chats', () => chatsApi.trash(), []) ?? []
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const [busyId, setBusyId] = useState<string | null>(null)

  const restore = async (id: string) => {
    setBusyId(id)
    try {
      await chatsApi.restore(id)
      onRestored(id)
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const purge = async (id: string, title: string) => {
    const ok = await confirmDialog({
      title: `Delete "${title}" forever?`,
      body: 'This permanently removes the conversation and everything tied to it. There is no trash to recover it from after this.',
      confirmLabel: 'Delete forever',
      tone: 'danger',
    })
    if (!ok) return
    setBusyId(id)
    try {
      await chatsApi.purge(id)
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Trash"
      description="Deleted chats sit here for 30 days before they're purged automatically — restore one, or delete it for good right away."
      size="lg"
    >
      {trashed.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">Nothing in the trash.</p>
      ) : (
        <div className="space-y-1">
          {trashed.map((chat) => {
            const character = characters.find((c) => c.id === chat.characterId)
            const isBusy = busyId === chat.id
            return (
              <div
                key={chat.id}
                className="flex items-center gap-2.5 rounded-2xl px-2.5 py-2 transition-colors hover:bg-bg-sunken"
              >
                <div className="shrink-0">
                  {character?.avatarDataUrl ? (
                    <img src={character.avatarDataUrl} className="h-9 w-9 rounded-xl object-cover" />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-bg-sunken text-xs text-text-muted">
                      {(character?.card.name ?? chat.title ?? '?').slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text">
                    {character ? chat.title : `${chat.title} (character deleted)`}
                  </div>
                  <div className="truncate text-xs text-text-muted">
                    Deleted {chat.deletedAt ? new Date(chat.deletedAt).toLocaleString() : 'recently'}
                  </div>
                </div>
                <button
                  onClick={() => restore(chat.id)}
                  disabled={isBusy}
                  title="Restore"
                  aria-label="Restore"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-elevated hover:text-accent disabled:opacity-50"
                >
                  <RotateCcw size={15} strokeWidth={2} />
                </button>
                <button
                  onClick={() => purge(chat.id, chat.title)}
                  disabled={isBusy}
                  title="Delete forever"
                  aria-label="Delete forever"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                >
                  <Trash2 size={15} strokeWidth={2} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}
