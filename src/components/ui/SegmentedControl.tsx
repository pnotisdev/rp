interface SegmentedControlOption<T extends string> {
  value: T
  label: string
}

/** A "pick exactly one" pill row on a sunken track */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  fill = false,
  size = 'md',
  className = '',
}: {
  options: SegmentedControlOption<T>[]
  value: T
  onChange: (value: T) => void
  fill?: boolean
  size?: 'sm' | 'md'
  className?: string
}) {
  const pad = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-[13px]'
  return (
    <div className={`${fill ? 'flex' : 'inline-flex'} gap-0.5 rounded-lg border border-border p-0.5 ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-md font-medium transition-colors ${pad} ${fill ? 'flex-1' : ''} ${
            value === o.value ? 'bg-bg-sunken text-text' : 'text-text-muted hover:text-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
