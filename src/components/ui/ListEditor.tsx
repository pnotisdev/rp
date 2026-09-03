import type { ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from './Button'

/**
 * A titled list of removable cards plus an "Add" button — the pattern repeated by hand across the
 * editors for gallery entries, relationship starters, social connections, schedule slots, gift and
 * item catalogs, and custom scene flags. `renderItem` fills each card's body; the card surface,
 * the remove control, and the empty state are handled here so they stay identical everywhere.
 */
export function ListEditor<T>({
  items,
  getKey,
  renderItem,
  onRemove,
  onAdd,
  addLabel,
  emptyHint,
}: {
  items: T[]
  getKey: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ReactNode
  onRemove: (item: T, index: number) => void
  onAdd: () => void
  addLabel: string
  emptyHint?: ReactNode
}) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={getKey(item, i)} className="relative rounded-xl bg-bg-sunken p-4 pr-11">
          <button
            type="button"
            onClick={() => onRemove(item, i)}
            aria-label="Remove"
            className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <X size={15} strokeWidth={2} />
          </button>
          {renderItem(item, i)}
        </div>
      ))}
      {items.length === 0 && emptyHint && (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-text-muted">
          {emptyHint}
        </p>
      )}
      <Button onClick={onAdd} className="flex items-center gap-1.5">
        <Plus size={15} strokeWidth={2} />
        {addLabel}
      </Button>
    </div>
  )
}
