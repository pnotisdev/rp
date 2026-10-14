import type { ReactNode } from 'react'

type ChipTone = 'accent' | 'romance' | 'danger'

const TONE_ON: Record<ChipTone, string> = {
  accent: 'border border-accent/40 bg-accent/10 text-accent',
  romance: 'border border-romance/40 bg-romance/10 text-romance',
  danger: 'border border-danger/40 bg-danger/10 text-danger',
}

/** A small toggleable pill — the pattern repeated ad hoc across the editors for weekday selectors, weather likes/dislikes, scope pickers, tag toggles. */
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
      className={`rounded-md px-2 py-0.5 text-xs transition-colors disabled:opacity-40 ${
        on ? TONE_ON[tone] : 'border border-border text-text-muted hover:border-text-muted/40 hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}
