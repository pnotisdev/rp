import type { ReactNode } from 'react'

type ChipTone = 'accent' | 'romance' | 'danger'

const TONE_ON: Record<ChipTone, string> = {
  accent: 'bg-accent/12 text-accent ring-1 ring-accent/30',
  romance: 'bg-romance/12 text-romance ring-1 ring-romance/30',
  danger: 'bg-danger/12 text-danger ring-1 ring-danger/30',
}

/**
 * A small toggleable pill — the pattern repeated ad hoc across the editors for weekday selectors,
 * weather likes/dislikes, scope pickers, tag toggles. `on` drives the selected styling; `tone`
 * picks the accent colour of the selected state.
 */
export function Chip({
  on,
  onClick,
  tone = 'accent',
  disabled,
  children,
}: {
  on?: boolean
  onClick?: () => void
  tone?: ChipTone
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`rounded-lg px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${
        on ? TONE_ON[tone] : 'border border-border text-text-muted hover:border-text-muted/40 hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}
