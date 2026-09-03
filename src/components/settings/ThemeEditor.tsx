import { useRef, useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { themesApi } from '@/lib/api/client'
import { useSettingsStore, type AvatarShape, type ChatStyle, type ColorMode } from '@/lib/store/useSettingsStore'
import { THEME_PRESETS, type ThemePreset } from '@/lib/store/themePresets'
import { ColorField } from '@/components/ui/ColorField'
import { Slider } from '@/components/ui/Slider'
import { Toggle } from '@/components/ui/Toggle'
import { Button } from '@/components/ui/Button'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'

const COLOR_KEYS: { key: string; label: string }[] = [
  { key: '--c-bg', label: 'Background' },
  { key: '--c-bg-elevated', label: 'Elevated surface (panels, header)' },
  { key: '--c-bg-sunken', label: 'Sunken surface (inputs, wells)' },
  { key: '--c-border', label: 'Borders' },
  { key: '--c-text', label: 'Text' },
  { key: '--c-text-muted', label: 'Muted text' },
  { key: '--c-accent', label: 'Accent' },
  { key: '--c-accent-text', label: 'Text on accent' },
  { key: '--c-msg-user', label: 'Your message background' },
  { key: '--c-msg-char', label: "Character's message background" },
  { key: '--c-danger', label: 'Danger / destructive' },
  { key: '--c-success', label: 'Success / connected' },
  { key: '--c-warning', label: 'Warning / checking' },
  { key: '--c-romance', label: 'Romance / bond meter' },
  { key: '--c-romance-text', label: 'Text on romance' },
]

export function ThemeEditor() {
  const colorMode = useSettingsStore((s) => s.colorMode)
  const setColorMode = useSettingsStore((s) => s.setColorMode)
  const themeTokensLight = useSettingsStore((s) => s.themeTokensLight)
  const themeTokensDark = useSettingsStore((s) => s.themeTokensDark)
  const setThemeToken = useSettingsStore((s) => s.setThemeToken)
  const resetTheme = useSettingsStore((s) => s.resetTheme)

  const chatStyle = useSettingsStore((s) => s.chatStyle)
  const setChatStyle = useSettingsStore((s) => s.setChatStyle)
  const avatarShape = useSettingsStore((s) => s.avatarShape)
  const setAvatarShape = useSettingsStore((s) => s.setAvatarShape)
  const chatWidthRem = useSettingsStore((s) => s.chatWidthRem)
  const fontScale = useSettingsStore((s) => s.fontScale)
  const blurPx = useSettingsStore((s) => s.blurPx)
  const shadowStrength = useSettingsStore((s) => s.shadowStrength)
  const setLayout = useSettingsStore((s) => s.setLayout)

  const reducedMotion = useSettingsStore((s) => s.reducedMotion)
  const showTimestamps = useSettingsStore((s) => s.showTimestamps)
  const showTokenCounts = useSettingsStore((s) => s.showTokenCounts)
  const tagsAsFolders = useSettingsStore((s) => s.tagsAsFolders)
  const clickToEdit = useSettingsStore((s) => s.clickToEdit)
  const visualNovelMode = useSettingsStore((s) => s.visualNovelMode)
  const toggleFlag = useSettingsStore((s) => s.toggleFlag)

  const customCss = useSettingsStore((s) => s.customCss)
  const setCustomCss = useSettingsStore((s) => s.setCustomCss)

  const tokens = colorMode === 'light' ? themeTokensLight : themeTokensDark
  const savedThemes = useApiQuery('themes', () => themesApi.list(), []) ?? []
  const [themeName, setThemeName] = useState('My theme')
  const fileRef = useRef<HTMLInputElement>(null)

  const fullThemeExport = () => ({
    name: themeName,
    themeTokensLight,
    themeTokensDark,
    chatStyle,
    avatarShape,
    chatWidthRem,
    fontScale,
    blurPx,
    shadowStrength,
    customCss,
  })

  const applyImported = (data: Record<string, unknown>) => {
    const store = useSettingsStore.getState()
    if (data.themeTokensLight)
      Object.entries(data.themeTokensLight as Record<string, string>).forEach(([k, v]) =>
        store.setThemeToken(k, v, 'light'),
      )
    if (data.themeTokensDark)
      Object.entries(data.themeTokensDark as Record<string, string>).forEach(([k, v]) =>
        store.setThemeToken(k, v, 'dark'),
      )
    if (data.chatStyle) store.setChatStyle(data.chatStyle as ChatStyle)
    if (data.avatarShape) store.setAvatarShape(data.avatarShape as AvatarShape)
    store.setLayout({
      chatWidthRem: (data.chatWidthRem as number) ?? store.chatWidthRem,
      fontScale: (data.fontScale as number) ?? store.fontScale,
      blurPx: (data.blurPx as number) ?? store.blurPx,
      shadowStrength: (data.shadowStrength as number) ?? store.shadowStrength,
    })
    if (typeof data.customCss === 'string') store.setCustomCss(data.customCss)
  }

  const saveThemeToLibrary = async () => {
    await themesApi.create({
      name: themeName,
      tokens: fullThemeExport() as unknown as Record<string, string>,
    })
  }

  const exportTheme = () => {
    const blob = new Blob([JSON.stringify(fullThemeExport(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${themeName.replace(/[^a-z0-9-_ ]/gi, '') || 'theme'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importThemeFile = async (file: File) => {
    const data = JSON.parse(await file.text())
    applyImported(data)
    if (data.name) setThemeName(data.name)
  }

  // Only touches color tokens (both light and dark, regardless of which mode is active right now)
  // — deliberately leaves chatStyle/avatarShape/layout/customCss alone, unlike applying a full
  // saved theme, since a color-palette preset shouldn't reach into unrelated settings.
  const applyPreset = (preset: ThemePreset) => {
    const store = useSettingsStore.getState()
    Object.entries(preset.light).forEach(([k, v]) => store.setThemeToken(k, v, 'light'))
    Object.entries(preset.dark).forEach(([k, v]) => store.setThemeToken(k, v, 'dark'))
  }

  return (
    <SettingsPage>
      <Section title="Presets" surface="bare">
        <div className="flex flex-wrap gap-3">
          {THEME_PRESETS.map((preset) => {
            const swatch = colorMode === 'light' ? preset.light : preset.dark
            return (
              <button
                key={preset.id}
                onClick={() => applyPreset(preset)}
                className="flex items-center gap-2 rounded-xl border border-border bg-bg-elevated px-3 py-2 text-sm text-text transition-colors hover:border-accent"
                title={`Apply the ${preset.name} color palette`}
              >
                <span
                  className="h-5 w-5 shrink-0 rounded-full border border-border"
                  style={{ background: `rgb(${swatch['--c-accent']})` }}
                />
                {preset.name}
              </button>
            )
          })}
        </div>
      </Section>

      <Section
        title="Colors"
        action={
          <div className="flex rounded-lg border border-border p-0.5">
            {(['light', 'dark'] as ColorMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setColorMode(m)}
                className={`rounded px-3 py-1 text-xs capitalize ${
                  colorMode === m ? 'bg-accent text-accent-text' : 'text-text-muted'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        }
      >
        {COLOR_KEYS.map(({ key, label }) => (
          <ColorField
            key={key}
            label={label}
            value={tokens[key] ?? '0 0 0'}
            onChange={(v) => setThemeToken(key, v, colorMode)}
          />
        ))}
        <Button variant="ghost" onClick={resetTheme} className="mt-3">
          Reset to defaults
        </Button>
      </Section>

      <Section title="Chat style" surface="bare">
        <div className="flex gap-2">
          {(['flat', 'bubbles', 'document'] as ChatStyle[]).map((s) => (
            <button
              key={s}
              onClick={() => setChatStyle(s)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize ${
                chatStyle === s ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-muted'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="mb-2 mt-4 text-sm font-semibold text-text">Avatar style</div>
        <div className="flex gap-2">
          {(['circle', 'rounded', 'square', 'rectangle'] as AvatarShape[]).map((s) => (
            <button
              key={s}
              onClick={() => setAvatarShape(s)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize ${
                avatarShape === s ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-muted'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Layout">
        <Slider
          label="Chat width"
          min={32}
          max={80}
          value={chatWidthRem}
          onChange={(v) => setLayout({ chatWidthRem: v })}
          formatValue={(v) => `${v}rem`}
        />
        <Slider
          label="Font scale"
          min={0.8}
          max={1.4}
          step={0.05}
          value={fontScale}
          onChange={(v) => setLayout({ fontScale: v })}
          formatValue={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Background blur"
          min={0}
          max={20}
          value={blurPx}
          onChange={(v) => setLayout({ blurPx: v })}
          formatValue={(v) => `${v}px`}
        />
        <Slider
          label="Shadow strength"
          min={0}
          max={2}
          step={0.1}
          value={shadowStrength}
          onChange={(v) => setLayout({ shadowStrength: v })}
          formatValue={(v) => `${Math.round(v * 100)}%`}
        />
      </Section>

      <Section title="Behavior" contentClassName="divide-y divide-border">
        <Toggle checked={reducedMotion} onChange={() => toggleFlag('reducedMotion')} label="Reduced motion" />
        <Toggle checked={showTimestamps} onChange={() => toggleFlag('showTimestamps')} label="Show timestamps" />
        <Toggle checked={showTokenCounts} onChange={() => toggleFlag('showTokenCounts')} label="Show token counts" />
        <Toggle checked={tagsAsFolders} onChange={() => toggleFlag('tagsAsFolders')} label="Tags as folders" />
        <Toggle checked={clickToEdit} onChange={() => toggleFlag('clickToEdit')} label="Click message to edit" />
        <Toggle
          checked={visualNovelMode}
          onChange={() => toggleFlag('visualNovelMode')}
          label="Visual Novel mode"
          description="Full-bleed scene art with a docked dialogue box, in place of the ordinary scrolling chat log"
        />
      </Section>

      <Section title="Custom CSS" surface="bare">
        <TextAreaField
          label=""
          rows={6}
          value={customCss}
          onChange={(e) => setCustomCss(e.target.value)}
          placeholder=".prose-rp { font-family: 'Georgia', serif; }"
        />
      </Section>

      <Section title="Save / share theme" surface="bare">
        <TextField label="Theme name" value={themeName} onChange={(e) => setThemeName(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={saveThemeToLibrary}>
            Save to library
          </Button>
          <Button onClick={exportTheme}>Export JSON</Button>
          <Button onClick={() => fileRef.current?.click()}>Import JSON</Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importThemeFile(e.target.files[0])}
          />
        </div>
        {savedThemes.length > 0 && (
          <div className="mt-3 space-y-1">
            {savedThemes.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-xl bg-bg-sunken px-4 py-3 text-sm">
                <span className="text-text">{t.name}</span>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => applyImported(t.tokens as unknown as Record<string, unknown>)}>
                    Apply
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => themesApi.update(t.id, { name: themeName, tokens: fullThemeExport() as unknown as Record<string, string> })}
                    title="Overwrite this saved theme with the current editor state"
                  >
                    Update
                  </Button>
                  <Button variant="ghost" onClick={() => themesApi.remove(t.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </SettingsPage>
  )
}
