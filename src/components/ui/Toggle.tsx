interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  description?: string
}

export function Toggle({ checked, onChange, label, description }: ToggleProps) {
  return (
    <label className="flex items-center justify-between gap-4 py-2 cursor-pointer select-none">
      {(label || description) && (
        <span className="flex flex-col">
          {label && <span className="text-sm text-text">{label}</span>}
          {description && <span className="text-xs text-text-muted">{description}</span>}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
          checked ? 'border-accent bg-accent' : 'border-border bg-bg-sunken'
        }`}
      >
        {/* Knob colour is picked to stay visible in all four theme × state combinations — a plain
            white knob vanished against the near-white `bg-bg-sunken` of the off state in light mode. */}
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow-sm transition-transform ${
            checked ? 'translate-x-5 bg-accent-text' : 'translate-x-0 bg-text-muted'
          }`}
        />
      </button>
    </label>
  )
}
