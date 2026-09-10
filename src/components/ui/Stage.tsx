import type { ReactNode } from 'react'

/**
 * The visual-novel HUD's own idiom, extracted so the rest of the app can speak it too: a glassy
 * translucent card, quiet uppercase micro-labels, and a thin pill meter.
 *
 * `variant` follows the convention `LiveRapport` already set. `'vn'` renders over the stage art, so
 * it is white-on-translucent-black and hardcoded on purpose (there is a photograph behind it, not a
 * theme surface). `'default'` renders inside a panel and is built entirely from theme tokens, since
 * the app ships a light theme *and* a live ThemeEditor that rewrites every colour at runtime, so
 * white-on-black would be unreadable half the time.
 *
 * What actually carries the VN feel across both is the shape rather than the colour: the same label
 * treatment, the same meter geometry, ring edges instead of solid borders, and `font-display` on
 * names. Sharing them here means the two can't drift the way two copies of a look always do.
 */

export type StageVariant = 'default' | 'vn'

/** A quiet, letter-spaced caption. The VN HUD labels every row this way ("Bond", "Date", "Event"). */
export function StageLabel({
  variant = 'default',
  className = '',
  children,
}: {
  variant?: StageVariant
  className?: string
  children: ReactNode
}) {
  const tone = variant === 'vn' ? 'text-white/60' : 'text-text-muted/70'
  return <span className={`shrink-0 text-[10px] uppercase tracking-[0.06em] ${tone} ${className}`}>{children}</span>
}

const METER_FILL: Record<string, string> = {
  romance: 'bg-romance',
  accent: 'bg-accent',
  warning: 'bg-warning',
  danger: 'bg-danger',
  success: 'bg-success',
  muted: 'bg-text-muted',
}

export type StageMeterTone = keyof typeof METER_FILL

/**
 * The VN warmth bar's exact geometry, reusable. Deliberately thin and unlabelled: the number, when
 * there is one worth showing, belongs on the row above it rather than inside the track.
 */
export function StageMeter({
  value,
  max = 100,
  tone = 'romance',
  variant = 'default',
  className = '',
}: {
  value: number
  max?: number
  tone?: StageMeterTone
  variant?: StageVariant
  className?: string
}) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  // An alpha of the muted foreground rather than a surface token: the surface behind a meter varies
  // (sunken card, elevated card, bare page) and a fixed surface colour disappears against one of
  // them, while this stays a visible track on every theme the ThemeEditor can produce.
  const track = variant === 'vn' ? 'bg-white/20' : 'bg-text-muted/25'
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full ${track} ${className}`}
      role="meter"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${METER_FILL[tone] ?? METER_FILL.romance}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/** The glassy panel the VN HUD is built from. Rows inside it separate themselves with `StageRow`. */
export function StageCard({
  variant = 'default',
  className = '',
  children,
}: {
  variant?: StageVariant
  className?: string
  children: ReactNode
}) {
  // `vn-glass` is the stage's own material (globals.css) — shared so a card rendered here and one
  // rendered by VNStage itself can't drift into two different translucencies.
  const surface = variant === 'vn' ? 'vn-glass text-white' : 'bg-bg-sunken/80 ring-1 ring-border/70 backdrop-blur-sm'
  return <div className={`min-w-0 overflow-hidden rounded-2xl ${surface} ${className}`}>{children}</div>
}

/**
 * One row of a `StageCard`, hairline-separated from the row above it. `label` gets the micro-label
 * treatment; everything else is the row's own content.
 */
export function StageRow({
  label,
  variant = 'default',
  first,
  wrap,
  className = '',
  children,
}: {
  label?: ReactNode
  variant?: StageVariant
  /** Skips the top hairline — for the first row in a card. */
  first?: boolean
  /** Lets a long value wrap onto more lines instead of truncating. Right for an inspector, wrong for a fixed-width HUD. */
  wrap?: boolean
  className?: string
  children?: ReactNode
}) {
  const divider = first ? '' : variant === 'vn' ? 'border-t border-white/10' : 'border-t border-border/60'
  const value = variant === 'vn' ? 'text-white/90' : 'text-text'
  return (
    <div className={`px-3 py-1.5 text-xs ${divider} ${className}`}>
      {label ? (
        <div className={`flex min-w-0 gap-1.5 ${wrap ? 'items-baseline' : 'items-center'}`}>
          <StageLabel variant={variant} className={wrap ? 'pt-px' : ''}>
            {label}
          </StageLabel>
          <span className={`min-w-0 ${wrap ? 'break-words' : 'truncate'} ${value}`}>{children}</span>
        </div>
      ) : (
        children
      )}
    </div>
  )
}
