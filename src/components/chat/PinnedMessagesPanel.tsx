import type { StoredMessage } from '@/lib/types'
import { Button } from '@/components/ui/Button'

interface PinnedMessagesPanelProps {
  messages: StoredMessage[]
  onClose: () => void
  onJump: (id: string) => void
  onUnpin: (id: string) => void
}

export function PinnedMessagesPanel({ messages, onClose, onJump, onUnpin }: PinnedMessagesPanelProps) {
  const pinned = messages.filter((m) => m.pinned)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-2xl border border-border bg-bg-elevated p-7 themed-shadow">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Pinned moments ({pinned.length})</h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
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
                    className="hover:text-danger"
                    title="Unpin"
                    aria-label="Unpin message"
                  >
                    ✕
                  </button>
                </span>
              </div>
              <div className="text-text-muted">
                {m.text.length > 140 ? `${m.text.slice(0, 140)}…` : m.text}
              </div>
            </div>
          ))}
          {pinned.length === 0 && (
            <p className="py-8 text-center text-xs text-text-muted">
              No pinned moments yet — click the ☆ on any message to save it here.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
