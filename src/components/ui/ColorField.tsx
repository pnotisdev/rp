import { hexToTriplet, tripletToHex } from '@/lib/color'

interface ColorFieldProps {
  label: string
  value: string // "R G B"
  onChange: (triplet: string) => void
  alpha?: number // 0-100, optional transparency control
  onAlphaChange?: (a: number) => void
}

export function ColorField({ label, value, onChange, alpha, onAlphaChange }: ColorFieldProps) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <input
        type="color"
        value={tripletToHex(value)}
        onChange={(e) => onChange(hexToTriplet(e.target.value))}
        className="h-8 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
      />
      <span className="text-sm text-text flex-1">{label}</span>
      {onAlphaChange && (
        <input
          type="range"
          min={0}
          max={100}
          value={alpha ?? 100}
          onChange={(e) => onAlphaChange(Number(e.target.value))}
          className="w-20 accent-[rgb(var(--c-accent))]"
          title="Opacity"
        />
      )}
    </div>
  )
}
