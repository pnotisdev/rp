import { useEffect } from 'react'
import { useReactionFeedStore, type Reaction } from '@/lib/store/useReactionFeedStore'

const LABELS: Record<string, string> = {
  affection: 'Affection',
  trust: 'Trust',
  chemistry: 'Chemistry',
  comfort: 'Comfort',
  respect: 'Respect',
  curiosity: 'Curiosity',
  tension: 'Tension',
}

const SHOW_MS = 5200

function ReactionChip({ reaction, variant }: { reaction: Reaction; variant: 'default' | 'vn' }) {
  const dismiss = useReactionFeedStore((s) => s.dismiss)
  useEffect(() => {
    const t = setTimeout(() => dismiss(reaction.id), SHOW_MS)
    return () => clearTimeout(t)
  }, [reaction.id, dismiss])

  const entries = Object.entries(reaction.deltas).filter(([, d]) => d)
  const net = entries.reduce((sum, [k, d]) => sum + (k === 'tension' ? -d : d), 0)
  const tone = net > 0 ? 'text-romance' : net < 0 ? 'text-danger' : 'text-text-muted'
  const surface = variant === 'vn' ? 'vn-glass text-white/90' : 'bg-bg-elevated text-text'
  return (
    <div className={`animate-toast-in max-w-[18rem] rounded-2xl px-3.5 py-2 text-xs ${surface}`} role="status">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-medium">
        <span className={tone} aria-hidden>{net >= 0 ? '▲' : '▼'}</span>
        {entries.map(([key, d]) => (
          <span key={key} className="tabular-nums">
            {LABELS[key] ?? key} <span className={(key === 'tension' ? d < 0 : d > 0) ? 'text-romance' : 'text-danger'}>{d > 0 ? `+${d}` : d}</span>
          </span>
        ))}
      </div>
      {reaction.reason && <div className="mt-0.5 text-[11px] opacity-70">{reaction.reason}</div>}
    </div>
  )
}

/** Floating "what that did" chips for the open chat, so each reply has an immediate, readable consequence. */
export function ReactionFeed({ chatId, variant = 'default' }: { chatId: string; variant?: 'default' | 'vn' }) {
  const items = useReactionFeedStore((s) => s.items).filter((i) => i.chatId === chatId)
  if (items.length === 0) return null
  return (
    <div className={`pointer-events-none absolute right-4 z-30 flex flex-col items-end gap-2 ${variant === 'vn' ? 'top-16' : 'top-24'}`}>
      {items.map((r) => (
        <ReactionChip key={r.id} reaction={r} variant={variant} />
      ))}
    </div>
  )
}
