import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'

export interface ChatToolbarAction {
  key: string
  icon: LucideIcon
  /** Full label — shown in the overflow menu, and used as the tooltip/aria-label for a primary icon. */
  label: string
  onClick: () => void
  /** Toggled-on / has-content state — tints the icon and shows a dot on the overflow trigger. */
  active?: boolean
  disabled?: boolean
  /** Not rendered at all (e.g. an author opted a whole feature out) — distinct from `disabled`. */
  hidden?: boolean
  /** 'primary' actions stay as icons in the bar; everything else collapses into the overflow menu. */
  priority?: 'primary' | 'secondary'
}

/**
 * The chat header's action row. Built once in `ChatWindow` and rendered in two places — the
 * ordinary header (`tone="chrome"`) and VN mode's floating glass pill (`tone="glass"`) — so the
 * two modes can never drift into different feature sets.
 *
 * Only the handful of `priority: 'primary'` actions render as bare icons; the rest fold into a
 * single "•••" overflow menu with real text labels, which is both calmer at rest and *more*
 * discoverable than the old ten-icon wall of tooltips-only glyphs.
 */
export function ChatToolbar({ tone, actions }: { tone: 'chrome' | 'glass'; actions: ChatToolbarAction[] }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const visible = actions.filter((a) => !a.hidden)
  const primary = visible.filter((a) => a.priority === 'primary')
  const overflow = visible.filter((a) => a.priority !== 'primary')
  const overflowActive = overflow.some((a) => a.active)

  const glass = tone === 'glass'
  const menuClass = glass
    ? 'border-white/10 bg-black/80 text-white backdrop-blur-md'
    : 'border-border bg-bg-elevated text-text themed-shadow'
  const itemHover = glass ? 'hover:bg-white/10' : 'hover:bg-bg-sunken'

  return (
    <div className="flex items-center gap-1">
      {primary.map((a) => (
        <IconButton
          key={a.key}
          tone={tone}
          icon={a.icon}
          title={a.label}
          active={a.active}
          disabled={a.disabled}
          onClick={a.onClick}
        />
      ))}
      {overflow.length > 0 && (
        <div ref={menuRef} className="relative">
          <IconButton
            tone={tone}
            icon={MoreHorizontal}
            title="More actions"
            active={open || overflowActive}
            onClick={() => setOpen((v) => !v)}
          />
          {open && (
            <div
              className={`absolute right-0 top-full z-50 mt-1.5 min-w-[15rem] overflow-hidden rounded-xl border py-1 ${menuClass}`}
            >
              {overflow.map((a) => (
                <button
                  key={a.key}
                  onClick={() => {
                    setOpen(false)
                    a.onClick()
                  }}
                  disabled={a.disabled}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors disabled:opacity-40 ${itemHover}`}
                >
                  <a.icon
                    size={15}
                    strokeWidth={1.75}
                    className={`shrink-0 ${a.active ? 'text-accent' : glass ? 'text-white/60' : 'text-text-muted'}`}
                  />
                  <span className="flex-1 truncate">{a.label}</span>
                  {a.active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
