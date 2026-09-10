import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { RARITY_TONE, type CatalogTone } from '@/lib/dating/catalogVisuals'

interface CatalogCardProps {
  icon: LucideIcon
  name: string
  /** Colour family — a gift/item rarity, or 'intimate' for the toy catalog. Defaults to `common`. */
  tone?: CatalogTone
  /** One short line under the name — an effect summary, an unlock requirement, a taste read. */
  meta?: ReactNode
  /** Highlighted second line, for a discovered gift taste. */
  note?: ReactNode
  /** Owned quantity; renders a corner badge only when above zero. */
  owned?: number
  /** Greyed out with a padlock on the icon tile — for something visible but not yet buyable. */
  locked?: boolean
  /** The card's single action, right-aligned and vertically centered. */
  action?: ReactNode
}

/**
 * One row in a shop or a bag. Replaces the three near-identical hand-rolled blocks the Shop tab
 * and the Bag panel each grew (a name, a "rarity • price • owned" run-on in muted grey, and a
 * full-width Buy button), which rendered every entry as the same grey rectangle regardless of what
 * it was. Rarity is carried by the icon tile's colour instead of a word in the metadata line, and
 * the action shrinks to a price pill so a grid of six reads as six items rather than six buttons.
 */
export function CatalogCard({ icon: Icon, name, tone = 'common', meta, note, owned = 0, locked, action }: CatalogCardProps) {
  const tones = RARITY_TONE[tone]
  return (
    <div
      className={`flex items-center gap-3 rounded-xl bg-bg-elevated p-3 ring-1 transition-colors ${
        locked ? 'opacity-55 ring-border/60' : `${tones.ring} hover:bg-bg-elevated/70`
      }`}
    >
      <div className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tones.tile}`}>
        <Icon size={18} strokeWidth={1.75} />
        {locked && (
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-bg-sunken text-text-muted ring-1 ring-border">
            <Lock size={9} strokeWidth={2.5} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {/* `first-letter:uppercase`, not `capitalize`: the toy catalog stores lowercase labels
              ("a feather tickler"), and CSS `capitalize` would Title Case Every Word of them. */}
          <span className="truncate text-sm text-text first-letter:uppercase">{name}</span>
          {owned > 0 && (
            <span className="shrink-0 rounded-full bg-bg-sunken px-1.5 text-[11px] tabular-nums text-text-muted">
              ×{owned}
            </span>
          )}
        </div>
        {meta && <div className="truncate text-xs text-text-muted">{meta}</div>}
        {note && <div className="truncate text-xs text-romance">{note}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/**
 * The buy/give/use action on a `CatalogCard` — compact enough that a grid of them stays calm,
 * and showing the price inline so "what does this cost" and "buy it" are the same control rather
 * than a number in the metadata line and a button somewhere below it.
 */
export function CatalogAction({
  label,
  price,
  onClick,
  disabled,
  tone = 'accent',
}: {
  label: string
  /** Rendered after the label with a coin glyph. Omit for a free action (Give, Use). */
  price?: number
  onClick: () => void
  disabled?: boolean
  tone?: 'accent' | 'romance'
}) {
  const toneClass =
    tone === 'romance'
      ? 'bg-romance/15 text-romance hover:bg-romance/25'
      : 'bg-accent/15 text-accent hover:bg-accent/25'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:bg-bg-sunken disabled:text-text-muted disabled:opacity-60 ${toneClass}`}
    >
      <span>{label}</span>
      {price !== undefined && (
        <span className="tabular-nums opacity-80">
          {price}
          <span className="ml-0.5 opacity-70">◆</span>
        </span>
      )}
    </button>
  )
}

/** The player's coin balance, for a shop panel's header — the one number a shop should never bury. */
export function CoinBalance({ coins }: { coins: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-warning/12 px-2.5 py-1 text-xs font-medium text-warning">
      <span className="text-sm leading-none">◆</span>
      <span className="tabular-nums">{coins}</span>
    </span>
  )
}
