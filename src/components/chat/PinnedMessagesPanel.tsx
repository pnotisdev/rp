import { Star, X } from 'lucide-react'
import type { StoredMessage } from '@/lib/types'
import { Modal } from '@/components/ui/Modal'

interface PinnedMessagesPanelProps {
  messages: StoredMessage[]
  onClose: () => void
  onJump: (id: string) => void
  onUnpin: (id: string) => void
}

export function PinnedMessagesPanel({ messages, onClose, onJump, onUnpin }: PinnedMessagesPanelProps) {
  const pinned = messages.filter((m) => m.pinned)

  return (
    <Modal onClose={onClose} title={`Pinned moments (${pinned.length})`} size="xl" scrollable>
        <div className="flex-1 space-y-2 overflow-y-auto">
          {pinned.map((m) => (
            <div
              key={m.id}
              onClick={() => onJump(m.id)}
              className="cursor-pointer rounded-xl bg-bg-sunken px-3.5 py-2.5 text-xs transition-colors hover:bg-bg-sunken/60"
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium text-text">{m.name}</span>
                <span className="flex items-center gap-2 text-text-muted">
                  <span>{new Date(m.createdAt).toLocaleString()}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onUnpin(m.id)
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded-md transition-colors hover:bg-bg-elevated hover:text-danger"
                    title="Unpin"
                    aria-label="Unpin message"
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </span>
              </div>
              <div className="text-text-muted">
                {m.text.length > 140 ? `${m.text.slice(0, 140)}…` : m.text}
              </div>
            </div>
          ))}
          {pinned.length === 0 && (
            <p className="flex items-center justify-center gap-1 py-8 text-center text-xs text-text-muted">
              No pinned moments yet — click the <Star size={12} strokeWidth={2} className="inline" /> on any message to save it here.
            </p>
          )}
        </div>
    </Modal>
  )
}
