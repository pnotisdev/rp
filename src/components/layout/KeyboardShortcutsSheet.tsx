import { Modal } from '@/components/ui/Modal'

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
const mod = isMac ? '⌘' : 'Ctrl'

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: `${mod} K`, description: 'Search everywhere — jump to a chat, character, world, or persona' },
  { keys: '← →', description: "Swipe to the previous/next reply, when the last message is the character's" },
  { keys: 'Esc', description: 'Close the open panel or dialog' },
  { keys: '?', description: 'Show this shortcuts sheet' },
]

/** Section 15's "discoverable keyboard shortcuts" — a `?` overlay listing what exists, since none of it was documented anywhere in the app before this. */
export function KeyboardShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} title="Keyboard shortcuts" size="sm">
      <div className="space-y-2.5">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-text-muted">{s.description}</span>
            <kbd className="shrink-0 rounded-md border border-border bg-bg-sunken px-2 py-1 font-mono text-xs text-text">
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </Modal>
  )
}
