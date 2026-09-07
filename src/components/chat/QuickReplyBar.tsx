import type { QuickReply } from '@/lib/types'

interface QuickReplyBarProps {
  replies: QuickReply[]
  onPick: (reply: QuickReply) => void
  /** 'vn' drops the chip's own surface/border so it reads as part of the glass dialogue box it's nested in, matching ChoiceList's own variant. */
  variant?: 'default' | 'vn'
}

const CHIP_CLASSES = {
  default: 'bg-bg-elevated text-text-muted hover:bg-accent/10 hover:text-accent',
  vn: 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white',
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
    <div
      className={`flex w-full items-center gap-2 ${
        variant === 'default'
          ? 'mx-auto max-w-chat flex-wrap px-4 pb-2.5'
          // VN, mobile: a horizontal scroller instead of wrapping to several lines — same reasoning
          // as ChoiceList's own 'vn' variant. Wraps normally again at sm+.
          : 'flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-visible'
      }`}
    >
      {replies.map((reply) => (
        <button
          key={reply.id}
          onClick={() => onPick(reply)}
          title={reply.message}
          className={`shrink-0 rounded-full py-1.5 px-3.5 text-left text-sm transition-colors ${CHIP_CLASSES[variant]}`}
        >
          {reply.label}
        </button>
      ))}
    </div>
  )
}
