import type { QuickReply } from '@/lib/types'

interface QuickReplyBarProps {
  replies: QuickReply[]
  onPick: (reply: QuickReply) => void
  /** 'vn' drops the chip's own surface/border so it reads as part of the glass dialogue box it's nested in, matching ChoiceList's own variant. */
  variant?: 'default' | 'vn'
}

const CHIP_CLASSES = {
  default: 'themed-shadow border-border bg-bg-elevated text-text-muted hover:border-accent hover:text-text',
  vn: 'border-white/15 bg-white/10 text-white/80 hover:border-white/30 hover:text-white',
}

/**
 * Section 14's Quick Replies bar — a fixed, user-authored row (Settings → Generation), unlike
 * `ChoiceList`'s AI-suggested one: always the same buttons, always available, never regenerated.
 * Deliberately shown only when `ChoiceList` isn't (see `ChatWindow.tsx`) so at most one chip row
 * ever competes for the same strip of space above the composer.
 */
export function QuickReplyBar({ replies, onPick, variant = 'default' }: QuickReplyBarProps) {
  if (replies.length === 0) return null
  return (
    <div className={`flex w-full flex-wrap items-center gap-2 ${variant === 'default' ? 'mx-auto max-w-chat px-4 pb-2.5' : ''}`}>
      {replies.map((reply) => (
        <button
          key={reply.id}
          onClick={() => onPick(reply)}
          title={reply.message}
          className={`rounded-full border py-1.5 px-3.5 text-left text-sm transition-colors ${CHIP_CLASSES[variant]}`}
        >
          {reply.label}
        </button>
      ))}
    </div>
  )
}
