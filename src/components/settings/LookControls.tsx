// Fine controls behind the Looks: typefaces, roundness, text size, atmosphere, and a one-hue palette generator.

import { useState } from 'react'
import { Shuffle } from 'lucide-react'
import { FONT_OPTIONS, FONT_STACKS, type FontId } from '@/lib/store/fonts'
import { BACKDROPS, type Backdrop } from '@/lib/store/looks'
import { paletteFromHue } from '@/lib/store/paletteGen'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { Button } from '@/components/ui/Button'
import { SelectField } from '@/components/ui/Field'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Section } from '@/components/ui/Section'
import { Slider } from '@/components/ui/Slider'
import { Toggle } from '@/components/ui/Toggle'

function FontPicker({ label, value, onChange, sample }: { label: string; value: FontId; onChange: (v: FontId) => void; sample: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <SelectField label={label} value={value} onChange={(e) => onChange(e.target.value as FontId)}>
        {FONT_OPTIONS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </SelectField>
      <p className="-mt-1 truncate text-[15px] text-text-muted" style={{ fontFamily: FONT_STACKS[value] }}>
        {sample}
      </p>
    </div>
  )
}

export function TypeSection() {
  const uiFont = useSettingsStore((s) => s.uiFont)
  const readFont = useSettingsStore((s) => s.readFont)
  const displayFont = useSettingsStore((s) => s.displayFont)
  const readScale = useSettingsStore((s) => s.readScale)
  const setLook = useSettingsStore((s) => s.setLook)
  return (
    <Section title="Type" description="Only bundled and system fonts, so it all works offline.">
      <FontPicker label="Interface" value={uiFont} onChange={(v) => setLook({ uiFont: v })} sample="Characters, Worlds, Lorebooks" />
      <FontPicker label="Story text" value={readFont} onChange={(v) => setLook({ readFont: v })} sample="“The library closes at nine, so choose your words wisely.”" />
      <FontPicker label="Names and titles" value={displayFont} onChange={(v) => setLook({ displayFont: v })} sample="Sumire Takanashi" />
      <Slider
        label="Story text size"
        min={0.85}
        max={1.4}
        step={0.05}
        value={readScale}
        onChange={(v) => setLook({ readScale: v })}
        formatValue={(v) => `${Math.round(v * 100)}%`}
      />
    </Section>
  )
}

export function ShapeSection() {
  const radiusPx = useSettingsStore((s) => s.radiusPx)
  const backdrop = useSettingsStore((s) => s.backdrop)
  const glass = useSettingsStore((s) => s.glass)
  const setLook = useSettingsStore((s) => s.setLook)
  return (
    <Section title="Shape and atmosphere">
      <Slider
        label="Roundness"
        min={0}
        max={20}
        value={radiusPx}
        onChange={(v) => setLook({ radiusPx: v })}
        formatValue={(v) => (v === 0 ? 'Sharp' : `${v}px`)}
      />
      <div className="mb-2 mt-3 text-sm text-text">Backdrop</div>
      <SegmentedControl fill options={BACKDROPS.map((b) => ({ value: b.id, label: b.label }))} value={backdrop} onChange={(v) => setLook({ backdrop: v as Backdrop })} />
      <div className="mt-2">
        <Toggle checked={glass} onChange={(v) => setLook({ glass: v })} label="Glass panels" description="Panels turn translucent so the backdrop shows through. Best with Aurora." />
      </div>
    </Section>
  )
}

const HUES = Array.from({ length: 12 }, (_, i) => i * 30)

/** Pick one hue and get a whole light and dark palette, or roll the dice. */
export function ColourFromHue() {
  const applyThemePreset = useSettingsStore((s) => s.applyThemePreset)
  const [hue, setHue] = useState<number | null>(null)
  const [vivid, setVivid] = useState(0.6)

  const apply = (h: number, v: number) => {
    setHue(h)
    setVivid(v)
    const { light, dark } = paletteFromHue(h, v)
    applyThemePreset(light, dark)
  }

  return (
    <div className="mt-5 rounded-lg border border-border bg-bg-elevated p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-text">Make your own from one colour</span>
        <Button onClick={() => apply(Math.floor(Math.random() * 360), 0.35 + Math.random() * 0.5)} className="inline-flex items-center gap-1.5">
          <Shuffle size={13} strokeWidth={1.8} /> Surprise me
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {HUES.map((h) => (
          <button
            key={h}
            onClick={() => apply(h, vivid)}
            aria-label={`Hue ${h}`}
            aria-pressed={hue === h}
            className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${hue === h ? 'border-text' : 'border-transparent'}`}
            style={{ background: `hsl(${h} 72% 56%)` }}
          />
        ))}
      </div>
      <Slider
        label="How colourful"
        min={0}
        max={1}
        step={0.05}
        value={vivid}
        onChange={(v) => apply(hue ?? 20, v)}
        formatValue={(v) => `${Math.round(v * 100)}%`}
      />
    </div>
  )
}
