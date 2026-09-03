interface SegmentedControlOption<T extends string> {
  value: T
  label: string
}

/**
 * A "pick exactly one" pill row on a sunken track — the pattern hand-rolled several times across
 * the app (Theme editor light/dark + chat/avatar style, the search scope toggle, the prompt
 * inspector's processed/raw toggle), each with slightly different padding, radius, and active
 * styling. `fill` stretches the segments to share the full width (a small set of long labels);
 * the default hugs its content (a compact inline toggle). `size="sm"` is for a toggle tucked
 * into a panel header. Pass display-ready `label`s (already capitalised).
 */
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
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
  return (
    <div className={`${fill ? 'flex' : 'inline-flex'} gap-1 rounded-xl bg-bg-sunken p-1 ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-lg font-medium transition-colors ${pad} ${fill ? 'flex-1' : ''} ${
            value === o.value ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
