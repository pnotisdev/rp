import { useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { themesApi } from '@/lib/api/client'
import {
  DEFAULT_THEME_TOKENS,
  DEFAULT_THEME_TOKENS_DARK,
  useSettingsStore,
  type AvatarShape,
  type ChatStyle,
  type ColorMode,
} from '@/lib/store/useSettingsStore'
import { THEME_PRESETS, type ThemePreset } from '@/lib/store/themePresets'
import { ColorField } from '@/components/ui/ColorField'
import { Slider } from '@/components/ui/Slider'
import { Toggle } from '@/components/ui/Toggle'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Button } from '@/components/ui/Button'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// "Default" sits in the same Presets row as the built-in palettes so reverting is exactly as
// discoverable as applying — a user who picked Sakura from this row looks for the way back here,
// not for a faint ghost button far below the swatch list.
const DEFAULT_PRESET: ThemePreset = {
  id: 'default',
  name: 'Default',
  light: DEFAULT_THEME_TOKENS,
  dark: DEFAULT_THEME_TOKENS_DARK,
}

/** Which preset in `presets` the current tokens exactly match (defaults + that preset's overrides), or null if hand-edited. */
function matchingPresetId(
  presets: ThemePreset[],
  light: Record<string, string>,
  dark: Record<string, string>,
): string | null {
  const eq = (a: Record<string, string>, b: Record<string, string>) =>
    Object.keys(b).every((k) => a[k] === b[k])
  for (const p of presets) {
    if (
      eq(light, { ...DEFAULT_THEME_TOKENS, ...p.light }) &&
      eq(dark, { ...DEFAULT_THEME_TOKENS_DARK, ...p.dark })
    ) {
      return p.id
    }
  }
  return null
}

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
  const applyThemePreset = useSettingsStore((s) => s.applyThemePreset)
  const resetTheme = useSettingsStore((s) => s.resetTheme)
  const customThemePresets = useSettingsStore((s) => s.customThemePresets)
  const addCustomThemePreset = useSettingsStore((s) => s.addCustomThemePreset)
  const removeCustomThemePreset = useSettingsStore((s) => s.removeCustomThemePreset)

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
  const reducedAudio = useSettingsStore((s) => s.reducedAudio)
  const sfxBursts = useSettingsStore((s) => s.sfxBursts)
  const sfxWords = useSettingsStore((s) => s.sfxWords)
  const setSfxWords = useSettingsStore((s) => s.setSfxWords)
  const bgmVolume = useSettingsStore((s) => s.bgmVolume)
  const setBgmVolume = useSettingsStore((s) => s.setBgmVolume)
  const showTimestamps = useSettingsStore((s) => s.showTimestamps)
  const showTokenCounts = useSettingsStore((s) => s.showTokenCounts)
  const showGenerationHud = useSettingsStore((s) => s.showGenerationHud)
  const tagsAsFolders = useSettingsStore((s) => s.tagsAsFolders)
  const clickToEdit = useSettingsStore((s) => s.clickToEdit)
  const visualNovelMode = useSettingsStore((s) => s.visualNovelMode)
  const visionSceneDetection = useSettingsStore((s) => s.visionSceneDetection)
  const toggleFlag = useSettingsStore((s) => s.toggleFlag)

  const customCss = useSettingsStore((s) => s.customCss)
  const setCustomCss = useSettingsStore((s) => s.setCustomCss)

  const tokens = colorMode === 'light' ? themeTokensLight : themeTokensDark
  const savedThemes = useApiQuery('themes', () => themesApi.list(), []) ?? []
  const [themeName, setThemeName] = useState('My theme')
  const [savingPreset, setSavingPreset] = useState(false)
  const [presetName, setPresetName] = useState('')
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
  // saved theme, since a color-palette preset shouldn't reach into unrelated settings. "Default"
  // is just the preset whose overrides are the built-in palette, so it goes through the same path.
  const applyPreset = (preset: ThemePreset) => {
    if (preset.id === 'default') resetTheme()
    else applyThemePreset(preset.light, preset.dark)
  }

  const allPresets = [DEFAULT_PRESET, ...THEME_PRESETS, ...customThemePresets]
  const activePreset = matchingPresetId(allPresets, themeTokensLight, themeTokensDark)

  const saveCurrentAsPreset = () => {
    addCustomThemePreset(presetName)
    setPresetName('')
    setSavingPreset(false)
  }

  return (
    <SettingsPage>
      <Section
        title="Presets"
        description="A starting palette — every swatch below stays editable afterward. Pick Default to undo one, or save the colours you've tuned as a preset of your own."
        surface="bare"
      >
        <div className="flex flex-wrap items-center gap-3">
          {allPresets.map((preset) => {
            const swatch = colorMode === 'light' ? preset.light : preset.dark
            const isActive = activePreset === preset.id
            const isCustom = customThemePresets.some((p) => p.id === preset.id)
            return (
              <div key={preset.id} className="group relative">
                <button
                  onClick={() => applyPreset(preset)}
                  aria-pressed={isActive}
                  className={`flex items-center gap-2 rounded-xl border py-2 pl-3 text-sm transition-colors ${
                    isCustom ? 'pr-8' : 'pr-3'
                  } ${
                    isActive
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-bg-elevated text-text hover:border-accent'
                  }`}
                  title={
                    preset.id === 'default' ? 'Restore the built-in palette' : `Apply the ${preset.name} palette`
                  }
                >
                  <span
                    className="h-5 w-5 shrink-0 rounded-full border border-border"
                    style={{ background: `rgb(${swatch['--c-accent'] ?? DEFAULT_THEME_TOKENS['--c-accent']})` }}
                  />
                  {preset.name}
                </button>
                {isCustom && (
                  <button
                    onClick={() => removeCustomThemePreset(preset.id)}
                    title={`Delete the "${preset.name}" preset`}
                    aria-label={`Delete the ${preset.name} preset`}
                    className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-text-muted opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                )}
              </div>
            )
          })}

          {savingPreset ? (
            <span className="flex items-center gap-1.5">
              <input
                autoFocus
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveCurrentAsPreset()
                  if (e.key === 'Escape') setSavingPreset(false)
                }}
                placeholder="Preset name"
                className="w-36 rounded-xl bg-bg-sunken px-3 py-1.5 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 placeholder:text-text-muted/55"
              />
              <Button variant="primary" onClick={saveCurrentAsPreset}>
                Save
              </Button>
              <Button variant="ghost" onClick={() => setSavingPreset(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <button
              onClick={() => setSavingPreset(true)}
              className="flex items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-text-muted transition-colors hover:border-accent hover:text-text"
            >
              <Plus size={14} strokeWidth={2} />
              Save current colours
            </button>
          )}
        </div>
      </Section>

      <Section
        title="Colors"
        action={
          <SegmentedControl
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={colorMode}
            onChange={(m) => setColorMode(m as ColorMode)}
          />
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
        <SegmentedControl
          fill
          options={(['flat', 'bubbles', 'document'] as ChatStyle[]).map((s) => ({ value: s, label: cap(s) }))}
          value={chatStyle}
          onChange={(s) => setChatStyle(s as ChatStyle)}
        />
        <div className="mb-2 mt-4 text-sm font-semibold text-text">Avatar style</div>
        <SegmentedControl
          fill
          options={(['circle', 'rounded', 'square', 'rectangle'] as AvatarShape[]).map((s) => ({ value: s, label: cap(s) }))}
          value={avatarShape}
          onChange={(s) => setAvatarShape(s as AvatarShape)}
        />
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
        <Toggle
          checked={reducedAudio}
          onChange={() => toggleFlag('reducedAudio')}
          label="Reduced audio"
          description="Mutes the message-send blip and the reward chime on relationship milestones/unlocks"
        />
        <Toggle checked={showTimestamps} onChange={() => toggleFlag('showTimestamps')} label="Show timestamps" />
        <Toggle checked={showTokenCounts} onChange={() => toggleFlag('showTokenCounts')} label="Show token counts" />
        <Toggle
          checked={showGenerationHud}
          onChange={() => toggleFlag('showGenerationHud')}
          label="Generation HUD"
          description="Tokens/sec, time to first token, and context fill, shown live while a reply streams in and left up until the next one starts"
        />
        <Toggle checked={tagsAsFolders} onChange={() => toggleFlag('tagsAsFolders')} label="Tags as folders" />
        <Toggle checked={clickToEdit} onChange={() => toggleFlag('clickToEdit')} label="Click message to edit" />
        <Toggle
          checked={visualNovelMode}
          onChange={() => toggleFlag('visualNovelMode')}
          label="Visual Novel mode"
          description="Full-bleed scene art with a docked dialogue box, in place of the ordinary scrolling chat log"
        />
        <Toggle
          checked={visionSceneDetection}
          onChange={() => toggleFlag('visionSceneDetection')}
          label="Vision scene detection"
          description="After each reply, a vision-capable model looks at the character's actual expression sprites (and any photo you attached) to correct the expression, background and mood. Needs a loaded mmproj and adds a slow image pass per turn — leave off if your model has no vision support."
        />
      </Section>

      <Section
        title="Sound-effect bursts"
        description="Styles a standalone comic sound word in a message — “BOOM!”, “knock knock”, “KA-CHUNK” — as a manga-style burst. Never touches sound words inside spoken dialogue."
        surface="bare"
      >
        <Toggle
          checked={sfxBursts}
          onChange={() => toggleFlag('sfxBursts')}
          label="Style sound effects"
        />
        {sfxBursts && (
          <div className="mt-3">
            <TextAreaField
              label="Extra sound words"
              rows={2}
              value={sfxWords}
              onChange={(e) => setSfxWords(e.target.value)}
              placeholder="thwip, glomp, fwump"
              hint="Applied to every character, on top of the built-in list. Comma or space separated. For a single character's own vocalisations (a catgirl's “nya”, an imouto's tics), use the field in that character's Visual novel tab instead."
            />
          </div>
        )}
      </Section>

      <Section
        title="Background music"
        description="Plays a world's uploaded scene tracks (World editor → Scenes → Background music) in Visual Novel and Companion mode, crossfading as the scene's mood changes. Ducks while a spoken line plays. Off at zero."
        surface="bare"
      >
        <Slider
          label="Music volume"
          min={0}
          max={1}
          step={0.05}
          value={bgmVolume}
          onChange={setBgmVolume}
          formatValue={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
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
