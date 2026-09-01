interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  formatValue?: (v: number) => string
  description?: string
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue,
  description,
}: SliderProps) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-text">{label}</span>
        <span className="text-text-muted tabular-nums">{formatValue ? formatValue(value) : value}</span>
      </div>
      {description && <p className="text-xs text-text-muted mb-1">{description}</p>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[rgb(var(--c-accent))]"
      />
    </div>
  )
}
