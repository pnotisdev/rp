import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface TabRailItem<T extends string> {
  id: T
  label: string
  icon: LucideIcon
  /** A small trailing accessory — a count, a coin balance. Hidden on narrow widths with the label. */
  badge?: ReactNode
}

/** The icon-and-label tab rail a game menu uses, on a sunken track */
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
    <div className={`flex gap-0.5 rounded-lg border border-border p-0.5 ${className}`} role="tablist">
      {items.map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-colors ${
              active ? 'bg-bg-sunken text-text' : 'text-text-muted hover:text-text'
            }`}
          >
            <item.icon size={14} strokeWidth={1.6} className="shrink-0" />
            <span className="hidden sm:inline">{item.label}</span>
            {item.badge && <span className="hidden shrink-0 sm:inline">{item.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}
