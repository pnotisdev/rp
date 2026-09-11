import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface TabRailItem<T extends string> {
  id: T
  label: string
  icon: LucideIcon
  /** A small trailing accessory — a count, a coin balance. Hidden on narrow widths with the label. */
  badge?: ReactNode
}

/**
 * The icon-and-label tab rail a game menu uses, on a sunken track — for a panel whose tabs are
 * *places you go* (Overview / Unlocks / Shop) rather than a two-way toggle, which is what
 * `SegmentedControl` is for.
 *
 * Deliberately not the underlined text row it replaces in `RelationshipPanel`: an underline reads
 * as document navigation, and the icons do most of the work of telling four destinations apart at
 * a glance. Labels drop below `sm` so four tabs still fit a phone as icons alone.
 */
export function TabRail<T extends string>({
  items,
  value,
  onChange,
  className = '',
}: {
  items: TabRailItem<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={`flex gap-1 rounded-xl bg-bg-sunken p-1 ${className}`} role="tablist">
      {items.map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
              active ? 'bg-accent/15 text-accent' : 'text-text-muted hover:bg-bg-elevated/60 hover:text-text'
            }`}
          >
            <item.icon size={15} strokeWidth={1.75} className="shrink-0" />
            <span className="hidden sm:inline">{item.label}</span>
            {item.badge && <span className="hidden shrink-0 sm:inline">{item.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}
