import { useRef, useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { presetsApi } from '@/lib/api/client'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import type { GenerationParams } from '@/lib/api/types'
import { BUILTIN_INSTRUCT_TEMPLATES } from '@/lib/prompt/instructTemplates'
import { BUILTIN_PRESETS } from '@/lib/prompt/builtinPresets'
import { Slider } from '@/components/ui/Slider'
import { Toggle } from '@/components/ui/Toggle'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'

// Simple-mode sliders derive several raw params from one intuitive 0-100 value each.
function creativityToParams(v: number) {
  return { temperature: Number((0.2 + (v / 100) * 1.6).toFixed(2)) }
}
function focusToParams(v: number) {
  return { top_p: Number((1 - (v / 100) * 0.5).toFixed(2)) }
}
function repetitionToParams(v: number) {
  return { rep_pen: Number((1.0 + (v / 100) * 0.3).toFixed(3)) }
}
function paramsToCreativity(t: number) {
  return Math.round(((t - 0.2) / 1.6) * 100)
}
function paramsToFocus(p: number) {
  return Math.round(((1 - p) / 0.5) * 100)
}
function paramsToRepetition(r: number) {
  return Math.round(((r - 1.0) / 0.3) * 100)
}

const ADVANCED_FIELDS: { key: string; label: string; step?: number; min?: number; max?: number }[] = [
  { key: 'temperature', label: 'Temperature', step: 0.01, min: 0 },
  { key: 'top_p', label: 'Top P', step: 0.01, min: 0, max: 1 },
  { key: 'top_k', label: 'Top K', step: 1, min: 0 },
  { key: 'min_p', label: 'Min P', step: 0.01, min: 0, max: 1 },
  { key: 'typical', label: 'Typical', step: 0.01, min: 0, max: 1 },
  { key: 'tfs', label: 'TFS', step: 0.01, min: 0, max: 1 },
  { key: 'rep_pen', label: 'Rep. Penalty', step: 0.01, min: 1 },
  { key: 'rep_pen_range', label: 'Rep. Penalty Range', step: 16, min: 0 },
  { key: 'rep_pen_slope', label: 'Rep. Penalty Slope', step: 0.1, min: 0 },
  { key: 'presence_penalty', label: 'Presence Penalty', step: 0.01 },
  { key: 'dry_multiplier', label: 'DRY Multiplier', step: 0.05, min: 0 },
  { key: 'dry_base', label: 'DRY Base', step: 0.05, min: 0 },
  { key: 'dry_allowed_length', label: 'DRY Allowed Length', step: 1, min: 0 },
  { key: 'mirostat', label: 'Mirostat Mode', step: 1, min: 0, max: 2 },
  { key: 'mirostat_tau', label: 'Mirostat Tau', step: 0.1, min: 0 },
  { key: 'mirostat_eta', label: 'Mirostat Eta', step: 0.01, min: 0 },
]

export function SamplingControls() {
  const advancedSamplerMode = useSettingsStore((s) => s.advancedSamplerMode)
  const setAdvancedSamplerMode = useSettingsStore((s) => s.setAdvancedSamplerMode)
  const sampler = useSettingsStore((s) => s.sampler)
  const setSampler = useSettingsStore((s) => s.setSampler)
  const instructTemplateId = useSettingsStore((s) => s.instructTemplateId)
  const setInstructTemplateId = useSettingsStore((s) => s.setInstructTemplateId)
  const autoSummarize = useSettingsStore((s) => s.autoSummarize)
  const setAutoSummarize = useSettingsStore((s) => s.setAutoSummarize)
  const keepRecentMessages = useSettingsStore((s) => s.keepRecentMessages)
  const setKeepRecentMessages = useSettingsStore((s) => s.setKeepRecentMessages)
  const summaryDetail = useSettingsStore((s) => s.summaryDetail)
  const setSummaryDetail = useSettingsStore((s) => s.setSummaryDetail)
  const autoDetectTasks = useSettingsStore((s) => s.autoDetectTasks)
  const setAutoDetectTasks = useSettingsStore((s) => s.setAutoDetectTasks)

  const presets = useApiQuery('presets', () => presetsApi.list(), []) ?? []
  const [presetName, setPresetName] = useState('My preset')
  const fileRef = useRef<HTMLInputElement>(null)

  const savePreset = async () => {
    await presetsApi.create({ name: presetName, params: sampler as unknown as Record<string, unknown> })
  }
  const exportPreset = () => {
    const blob = new Blob([JSON.stringify(sampler, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${presetName.replace(/[^a-z0-9-_ ]/gi, '') || 'preset'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const importPreset = async (file: File) => {
    const data = JSON.parse(await file.text())
    setSampler(data)
  }

  return (
    <div className="max-w-2xl space-y-14">
      <section>
        <h3 className="mb-3 text-sm font-semibold text-text">Context & length</h3>
        <div className="rounded-2xl bg-bg-elevated p-6">
          <Slider
            label="Max context length"
            min={512}
            max={131072}
            step={512}
            value={sampler.max_context_length}
            onChange={(v) => setSampler({ max_context_length: v })}
            formatValue={(v) => `${v.toLocaleString()} tok`}
          />
          <Slider
            label="Max response length"
            min={16}
            max={4096}
            step={16}
            value={sampler.max_length}
            onChange={(v) => setSampler({ max_length: v })}
            formatValue={(v) => `${v} tok`}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-text">Long-term memory</h3>
        <p className="mb-3 text-xs text-text-muted">
          Once a chat outgrows the context window, older turns are folded into a running summary by
          the connected model instead of being silently dropped.
        </p>
        <div className="rounded-2xl bg-bg-elevated p-6">
          <Toggle
            checked={autoSummarize}
            onChange={setAutoSummarize}
            label="Auto-summarize older history"
            description="Runs after each reply, and proactively if a turn is about to hit the context limit"
          />
          <Slider
            label="Keep verbatim"
            min={4}
            max={40}
            step={2}
            value={keepRecentMessages}
            onChange={setKeepRecentMessages}
            formatValue={(v) => `${v} messages`}
            description="Recent messages kept word-for-word; anything older gets summarized"
          />
          <div className="pt-3">
            <div className="mb-1.5 text-sm text-text">Summary detail</div>
            <div className="flex gap-2">
              {(['concise', 'detailed'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setSummaryDetail(d)}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm capitalize transition-colors ${
                    summaryDetail === d ? 'bg-accent/10 text-accent' : 'bg-bg-sunken text-text-muted'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              Concise trades detail for fewer tokens spent on memory; detailed keeps more texture at a
              higher ongoing cost.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-text">Objectives</h3>
        <p className="mb-3 text-xs text-text-muted">
          Set a goal from a chat's → button and the character's replies steer toward it. Tasks can be
          checked off by hand, or detected automatically as they happen in the scene.
        </p>
        <div className="rounded-2xl bg-bg-elevated p-6">
          <Toggle
            checked={autoDetectTasks}
            onChange={setAutoDetectTasks}
            label="Auto-detect completed tasks"
            description="A quick check after each reply — conservative by design, so it only ever checks things off, never invents progress"
          />
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-text">Instruct template</h3>
        <p className="mb-2 text-xs text-text-muted">
          How turns are formatted for the model. Match this to your model's training format.
        </p>
        <select
          value={instructTemplateId}
          onChange={(e) => setInstructTemplateId(e.target.value)}
          className="w-full rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none"
        >
          {BUILTIN_INSTRUCT_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">Generation</h3>
          <Toggle checked={advancedSamplerMode} onChange={setAdvancedSamplerMode} label="Advanced mode" />
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {BUILTIN_PRESETS.map((p) => (
            <Button key={p.name} onClick={() => setSampler(p.params)}>
              {p.name}
            </Button>
          ))}
        </div>

        {!advancedSamplerMode ? (
          <div className="rounded-2xl bg-bg-elevated p-6">
            <Slider
              label="Creativity"
              min={0}
              max={100}
              value={paramsToCreativity(sampler.temperature)}
              onChange={(v) => setSampler(creativityToParams(v))}
              description="Lower = safer and more predictable. Higher = more surprising and varied."
            />
            <Slider
              label="Focus"
              min={0}
              max={100}
              value={paramsToFocus(sampler.top_p)}
              onChange={(v) => setSampler(focusToParams(v))}
              description="How narrowly the model sticks to its most likely next words."
            />
            <Slider
              label="Avoid repetition"
              min={0}
              max={100}
              value={paramsToRepetition(sampler.rep_pen)}
              onChange={(v) => setSampler(repetitionToParams(v))}
              description="Discourages repeating the same words and phrases."
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-2xl bg-bg-elevated p-6 sm:grid-cols-3">
            {ADVANCED_FIELDS.map((f) => (
              <TextField
                key={f.key}
                label={f.label}
                type="number"
                step={f.step}
                min={f.min}
                max={f.max}
                value={String((sampler as unknown as Record<string, number>)[f.key] ?? 0)}
                onChange={(e) => setSampler({ [f.key]: Number(e.target.value) } as Partial<GenerationParams>)}
              />
            ))}
            <TextField
              label="Stop sequences (comma separated)"
              className="col-span-full"
              value={(sampler.stop_sequence ?? []).join(', ')}
              onChange={(e) =>
                setSampler({ stop_sequence: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
              }
            />
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-text">Presets</h3>
        <TextField label="Preset name" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={savePreset}>
            Save current
          </Button>
          <Button onClick={exportPreset}>Export JSON</Button>
          <Button onClick={() => fileRef.current?.click()}>Import JSON</Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importPreset(e.target.files[0])}
          />
        </div>
        {presets.length > 0 && (
          <div className="mt-3 space-y-1">
            {presets.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl bg-bg-sunken px-4 py-3 text-sm">
                <span className="text-text">{p.name}</span>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setSampler(p.params)}>
                    Apply
                  </Button>
                  <Button variant="ghost" onClick={() => presetsApi.remove(p.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
