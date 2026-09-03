import type { LucideIcon } from 'lucide-react'

interface IconButtonProps {
  icon: LucideIcon
  title: string
  onClick?: () => void
  /** Tints the icon accent and gives it a subtle filled background — for a toggled-on/has-content state. */
  active?: boolean
  disabled?: boolean
  size?: number
  /** Icon-button box size in pixels — defaults to 34 (header/toolbar scale). */
  boxSize?: number
  /** 'chrome' (default) reads against the app's own surface tokens; 'glass' is white-on-photo, for VN mode's floating overlay toolbar. */
  tone?: 'chrome' | 'glass'
  className?: string
}

const TONE_CLASSES: Record<NonNullable<IconButtonProps['tone']>, { base: string; active: string }> = {
  chrome: { base: 'text-text-muted hover:bg-bg-sunken hover:text-text', active: 'bg-accent/10 text-accent' },
  glass: { base: 'text-white/75 hover:bg-white/15 hover:text-white', active: 'bg-white/15 text-accent' },
}

/** A consistently-sized, consistently-spaced icon-only button — the header/toolbar row unit shared by ChatWindow, VNStage, and MessageBubble. */
export function IconButton({
  icon: Icon,
  title,
  onClick,
  active,
  disabled,
  size = 17,
  boxSize = 34,
  tone = 'chrome',
  className = '',
}: IconButtonProps) {
  const tones = TONE_CLASSES[tone]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{ height: boxSize, width: boxSize }}
      className={`flex shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? tones.active : tones.base
      } ${className}`}
    >
      <Icon size={size} strokeWidth={1.75} />
    </button>
  )
}
