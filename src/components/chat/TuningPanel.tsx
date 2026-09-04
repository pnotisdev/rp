import { useEffect } from 'react'
import { ArrowUpRight, SlidersHorizontal, X } from 'lucide-react'
import type { Character } from '@/lib/characters/cardSpec'
import type { GenerationParams } from '@/lib/api/types'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { instructTemplatesApi, presetsApi } from '@/lib/api/client'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { BUILTIN_PRESETS } from '@/lib/prompt/builtinPresets'
import { BUILTIN_INSTRUCT_TEMPLATES } from '@/lib/prompt/instructTemplates'
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/prompt/systemPrompts'
import {
  creativityToParams,
  focusToParams,
  paramsToCreativity,
  paramsToFocus,
  paramsToRepetition,
  repetitionToParams,
} from '@/lib/prompt/samplerSimpleMode'
import { IconButton } from '@/components/ui/IconButton'
import { Slider } from '@/components/ui/Slider'
import { TextAreaField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'

const SELECT_CLASS =
  'w-full cursor-pointer rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40'

/**
 * The image-gen-style "tweak it from a side panel, not a settings maze" pattern. Deliberately NOT
 * a `<Modal>` — it docks to the right edge over whatever's behind it (chat log or VNStage) without
 * a backdrop, so you can still read the scene and keep composing while you nudge a slider, the way
 * Anima's panel sits beside the canvas rather than covering it. Every value here is the same
 * global Settings state (`useSettingsStore`) — a deliberately simple v1: this changes generation
 * everywhere, not just the open chat. Kept mounted at all times and slid off-screen when closed
 * (rather than conditionally rendered) so the open/close transition actually animates.
 *
 * Quick-select only, not quick-author: picking a sampler/instruct preset here is instant, matching
 * Settings → Generation's own "Starting point"/"Active template" selects (same store fields, same
 * resolution rules) — but authoring one (raw fields, saving a new preset, importing a SillyTavern
 * file) stays behind "Open full Generation settings" rather than being duplicated here.
 */
export function TuningPanel({
  open,
  onClose,
  character,
  onOpenSettings,
}: {
  open: boolean
  onClose: () => void
  /** Only used to warn when this character's own system-prompt override shadows the field below. */
  character?: Character
  /** Optional deep link to the full Settings → Generation tab, for presets/advanced fields/import-export. */
  onOpenSettings?: () => void
}) {
  const sampler = useSettingsStore((s) => s.sampler)
  const setSampler = useSettingsStore((s) => s.setSampler)
  const instructTemplateId = useSettingsStore((s) => s.instructTemplateId)
  const setInstructTemplateId = useSettingsStore((s) => s.setInstructTemplateId)
  const systemPrompt = useSettingsStore((s) => s.systemPrompt)
  const setSystemPrompt = useSettingsStore((s) => s.setSystemPrompt)
  const postHistoryInstructions = useSettingsStore((s) => s.postHistoryInstructions)
  const setPostHistoryInstructions = useSettingsStore((s) => s.setPostHistoryInstructions)

  const savedPresets = useApiQuery('presets', () => presetsApi.list(), []) ?? []
  const customTemplates = useApiQuery('instruct-templates', () => instructTemplatesApi.list(), []) ?? []

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // Same "which preset does the live sampler exactly match" resolution as Settings → Generation,
  // extended to also check saved presets (a saved preset stores the *entire* sampler snapshot, so
  // the same "every field it opinionates about matches" check that works for a builtin's partial
  // params works here too). One merged select rather than two separate widgets, same shape as the
  // System prompt section's builtin+user-preset dropdown.
  const current = sampler as unknown as Record<string, number>
  const activeBuiltinPreset = BUILTIN_PRESETS.find((p) => Object.entries(p.params).every(([k, v]) => current[k] === v))
  const activeSavedPreset = !activeBuiltinPreset
    ? savedPresets.find((p) => Object.entries(p.params as Record<string, unknown>).every(([k, v]) => current[k] === v))
    : undefined
  const samplerSelectValue = activeBuiltinPreset
    ? `builtin:${activeBuiltinPreset.id}`
    : activeSavedPreset
      ? `saved:${activeSavedPreset.id}`
      : 'custom'

  const onSelectSamplerPreset = (value: string) => {
    if (value === 'custom') return
    const [kind, id] = value.split(':')
    if (kind === 'builtin') {
      const preset = BUILTIN_PRESETS.find((p) => p.id === id)
      if (preset) setSampler(preset.params)
    } else {
      const preset = savedPresets.find((p) => p.id === id)
      if (preset) setSampler(preset.params as Partial<GenerationParams>)
    }
  }

  const characterOverride = character?.card.system_prompt?.trim()

  return (
    <aside
      aria-hidden={!open}
      aria-label="Quick tuning"
      className={`absolute inset-y-0 right-0 z-40 flex w-full flex-col border-l border-border bg-bg-elevated shadow-2xl transition-transform duration-300 ease-out sm:w-96 ${
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full'
      }`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <SlidersHorizontal size={15} strokeWidth={2} className="text-accent" />
          Quick tuning
        </div>
        <IconButton icon={X} title="Close" onClick={onClose} size={15} boxSize={30} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <div className="mb-5">
          <span className="mb-1.5 block text-sm font-semibold text-text">Sampler</span>
          <div className="mb-3">
            <div className="mb-1.5 text-xs font-medium text-text-muted">Starting point</div>
            <select
              value={samplerSelectValue}
              onChange={(e) => onSelectSamplerPreset(e.target.value)}
              className={SELECT_CLASS}
            >
              <optgroup label="Built-in">
                {BUILTIN_PRESETS.map((p) => (
                  <option key={p.id} value={`builtin:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
              {savedPresets.length > 0 && (
                <optgroup label="Your presets">
                  {savedPresets.map((p) => (
                    <option key={p.id} value={`saved:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {samplerSelectValue === 'custom' && <option value="custom">Custom (edited)</option>}
            </select>
          </div>
          <div className="rounded-xl bg-bg-sunken p-4">
            <Slider
              label="Creativity"
              min={0}
              max={100}
              value={paramsToCreativity(sampler.temperature)}
              onChange={(v) => setSampler(creativityToParams(v))}
            />
            <Slider
              label="Focus"
              min={0}
              max={100}
              value={paramsToFocus(sampler.top_p)}
              onChange={(v) => setSampler(focusToParams(v))}
            />
            <Slider
              label="Avoid repetition"
              min={0}
              max={100}
              value={paramsToRepetition(sampler.rep_pen)}
              onChange={(v) => setSampler(repetitionToParams(v))}
            />
            <Slider
              label="Reply length"
              min={16}
              max={4096}
              step={16}
              value={sampler.max_length}
              onChange={(v) => setSampler({ max_length: v })}
              formatValue={(v) => `${v} tok`}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-text-muted">Applies to every chat. For raw sampler fields, saving a new preset, and advanced mode, see full Settings.</p>
        </div>

        <div className="mb-5">
          <span className="mb-1.5 block text-sm font-semibold text-text">Instruct template</span>
          <select
            value={instructTemplateId}
            onChange={(e) => setInstructTemplateId(e.target.value)}
            className={SELECT_CLASS}
          >
            <optgroup label="Built-in">
              {BUILTIN_INSTRUCT_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
            {customTemplates.length > 0 && (
              <optgroup label="Custom">
                {customTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <p className="mt-1.5 text-[11px] text-text-muted">
            How turns are formatted for the model — match this to your model's training format.
          </p>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-semibold text-text">System prompt</span>
          {characterOverride && (
            <p className="mb-2 rounded-lg bg-warning/10 px-3 py-2 text-[11px] text-warning">
              {character!.card.name || 'This character'} has their own system-prompt override, which wins over the
              field below for this chat. Edit it from the Character editor → Advanced tab instead.
            </p>
          )}
          <TextAreaField
            label=""
            rows={5}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder={DEFAULT_SYSTEM_PROMPT}
            hint="Blank uses the built-in default. Supports {{char}} / {{user}}."
          />
          <TextAreaField
            label="Post-history steering"
            rows={2}
            value={postHistoryInstructions}
            onChange={(e) => setPostHistoryInstructions(e.target.value)}
            placeholder="e.g. Keep replies to two or three paragraphs."
            hint="Injected right before the model's turn — a reliable slot for a rule it keeps forgetting."
          />
        </div>
      </div>

      {onOpenSettings && (
        <div className="shrink-0 border-t border-border p-3">
          <Button variant="ghost" onClick={onOpenSettings} className="flex w-full items-center justify-center gap-1.5">
            Open full Generation settings
            <ArrowUpRight size={13} strokeWidth={2} />
          </Button>
        </div>
      )}
    </aside>
  )
}
