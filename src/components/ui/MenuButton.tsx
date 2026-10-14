import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export interface MenuItem {
  label: string
  hint?: string
  onClick: () => void
}

/** A button that opens a small list of actions. */
export function MenuButton({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-border px-3 py-1 text-[13px] font-medium text-text transition-colors hover:bg-bg-sunken"
      >
        {label}
        <ChevronDown size={13} strokeWidth={1.8} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-lg border border-border bg-bg-elevated py-1">
            {items.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-bg-sunken"
              >
                <span className="block text-[13px] text-text">{item.label}</span>
                {item.hint && <span className="block text-[11px] text-text-muted">{item.hint}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
