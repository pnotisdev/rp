import { useRef, useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { presetsApi } from '@/lib/api/client'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import type { GenerationParams } from '@/lib/api/types'
import { BUILTIN_PRESETS } from '@/lib/prompt/builtinPresets'
import { Slider } from '@/components/ui/Slider'
import { Toggle } from '@/components/ui/Toggle'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'
import { RegexScriptsSection } from './RegexScriptsSection'
import { InstructTemplateSection } from './InstructTemplateSection'
import { WritingStyleSection } from './WritingStyleSection'

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
  const autoSummarize = useSettingsStore((s) => s.autoSummarize)
  const setAutoSummarize = useSettingsStore((s) => s.setAutoSummarize)
  const keepRecentMessages = useSettingsStore((s) => s.keepRecentMessages)
  const setKeepRecentMessages = useSettingsStore((s) => s.setKeepRecentMessages)
  const summaryDetail = useSettingsStore((s) => s.summaryDetail)
  const setSummaryDetail = useSettingsStore((s) => s.setSummaryDetail)
  const autoDetectTasks = useSettingsStore((s) => s.autoDetectTasks)
  const setAutoDetectTasks = useSettingsStore((s) => s.setAutoDetectTasks)
  const autoTrackRelationship = useSettingsStore((s) => s.autoTrackRelationship)
  const setAutoTrackRelationship = useSettingsStore((s) => s.setAutoTrackRelationship)
  const relationshipDifficulty = useSettingsStore((s) => s.relationshipDifficulty)
  const setRelationshipDifficulty = useSettingsStore((s) => s.setRelationshipDifficulty)
  const autoSuggestChoices = useSettingsStore((s) => s.autoSuggestChoices)
  const setAutoSuggestChoices = useSettingsStore((s) => s.setAutoSuggestChoices)

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
    <SettingsPage>
      <Section title="Context & length">
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
      </Section>

      <Section
        title="Long-term memory"
        description="Once a chat outgrows the context window, older turns are folded into a running summary by the connected model instead of being silently dropped."
      >
        <Toggle
          checked={autoSummarize}
          onChange={setAutoSummarize}
          label="Auto-summarize older history"
          description="One model call, but only once enough new history has built up (not every reply), plus immediately if a turn is about to overflow the context limit"
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
      </Section>

      <Section
        title="Objectives"
        description="Set a goal from a chat's Target button and the character's replies steer toward it. Tasks can be checked off by hand, or detected automatically as they happen in the scene."
      >
        <Toggle
          checked={autoDetectTasks}
          onChange={setAutoDetectTasks}
          label="Auto-detect completed tasks"
          description="One model call after a reply, only while an objective is active — conservative, so it only ticks things off, never invents progress"
        />
      </Section>

      <Section
        title="Relationship tracking"
        description="Scores affection and six relationship dimensions after each reply, gating gift/sprite/background/gallery unlocks — turn off for a chat you don't want dating-sim mechanics in."
      >
        <Toggle
          checked={autoTrackRelationship}
          onChange={setAutoTrackRelationship}
          label="Auto-track relationship"
          description="A model call after each reply. It won't hold up the reply you just got, but on a local single-GPU server it queues with the other post-reply assists ahead of your next message — the chat shows a strip while it runs."
        />
        <div className="pt-3">
          <div className="mb-1.5 text-sm text-text">Difficulty</div>
          <div className="flex gap-2">
            {(['gentle', 'normal', 'harsh'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setRelationshipDifficulty(d)}
                className={`flex-1 rounded-xl px-3 py-2 text-sm capitalize transition-colors ${
                  relationshipDifficulty === d ? 'bg-accent/10 text-accent' : 'bg-bg-sunken text-text-muted'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-text-muted">
            How far affection and relationship stats swing on any given moment or date — never what
            a character says or how a scene plays out. Gentle softens the swings, harsh sharpens them.
          </p>
        </div>
      </Section>

      <Section
        title="Roleplay choices"
        description="A few suggested next lines/actions appear above the composer after each reply — pick one to steer the scene forward, or ignore them and write your own."
      >
        <Toggle
          checked={autoSuggestChoices}
          onChange={setAutoSuggestChoices}
          label="Suggest choices after each reply"
          description="One model call after each reply. Same as relationship tracking, it shares the GPU with your next message — turn it off for pure freeform writing."
        />
      </Section>

      <WritingStyleSection />

      <InstructTemplateSection />

      <Section
        title="Generation"
        surface="bare"
        action={<Toggle checked={advancedSamplerMode} onChange={setAdvancedSamplerMode} label="Advanced mode" />}
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {BUILTIN_PRESETS.map((p) => (
            <Button key={p.name} onClick={() => setSampler(p.params)}>
              {p.name}
            </Button>
          ))}
        </div>

        {!advancedSamplerMode ? (
          <div className="rounded-xl bg-bg-elevated p-5">
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
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-bg-elevated p-5 sm:grid-cols-3">
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
      </Section>

      <Section title="Presets" surface="bare">
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
      </Section>

      <RegexScriptsSection />
    </SettingsPage>
  )
}
