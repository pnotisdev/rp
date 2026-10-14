// Settings for the ComfyUI image backend: connection check, which graph to run, model files, LoRAs, or a workflow of your own.

import { useMemo, useState } from 'react'
import { BRAND } from '@/lib/brand'
import { Plus, X } from 'lucide-react'
import { ComfyUIClient, type ComfyCatalog, type ComfyStatus } from '@/lib/api/comfyuiImage'
import { analyzeWorkflow, parseApiWorkflow, type ComfyConfig, type ComfyPreset, type WorkflowReport } from '@/lib/api/comfyWorkflow'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { Button } from '@/components/ui/Button'
import { FileButton } from '@/components/ui/FileButton'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { GenerateImageButton } from '@/components/ui/GenerateImageButton'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import animaWorkflow from '../../../tools/comfy/anima-txt2img.api.json?raw'

const PRESETS: { value: ComfyPreset; label: string }[] = [
  { value: 'checkpoint', label: 'Checkpoint' },
  { value: 'dit', label: 'Separate models' },
  { value: 'custom', label: 'My workflow' },
]

const PRESET_HELP: Record<ComfyPreset, string> = {
  checkpoint: 'One checkpoint file that holds everything: Stable Diffusion 1.5, SDXL and similar.',
  dit: 'Newer models that ship as separate files: a diffusion model, a text encoder and a VAE (Anima, Qwen-Image, Flux style).',
  custom: 'Run a graph you built in ComfyUI. Export it with "Save (API Format)" and paste it below.',
}

/** A dropdown fed by the running ComfyUI, falling back to a plain text box when nothing was loaded. */
function Pick({ label, value, options, onChange, hint, allowEmpty }: { label: string; value: string; options: string[]; onChange: (v: string) => void; hint?: string; allowEmpty?: boolean }) {
  if (!options.length) return <TextField label={label} value={value} onChange={(e) => onChange(e.target.value)} hint={hint ?? 'Check the connection to pick from a list.'} />
  const list = value && !options.includes(value) ? [value, ...options] : options
  return (
    <SelectField label={label} value={value} onChange={(e) => onChange(e.target.value)} hint={hint}>
      {allowEmpty && <option value="">Default</option>}
      {!allowEmpty && !value && <option value="">Choose…</option>}
      {list.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </SelectField>
  )
}

export function ComfySettings() {
  const baseUrl = useSettingsStore((s) => s.imageBackendBaseUrl)
  const model = useSettingsStore((s) => s.imageBackendModel)
  const comfy = useSettingsStore((s) => s.comfy)
  const setComfy = useSettingsStore((s) => s.setComfyConfig)
  const setImageBackendConfig = useSettingsStore((s) => s.setImageBackendConfig)
  const [status, setStatus] = useState<ComfyStatus | null>(null)
  const [catalog, setCatalog] = useState<ComfyCatalog | null>(null)
  const [checking, setChecking] = useState(false)
  const [preview, setPreview] = useState('')

  const check = async () => {
    setChecking(true)
    const client = new ComfyUIClient(baseUrl)
    const result = await client.check()
    setStatus(result)
    setCatalog(result.ok ? await client.catalog() : null)
    setChecking(false)
  }

  const report = useMemo<{ analysis: WorkflowReport } | { error: string } | null>(() => {
    if (comfy.preset !== 'custom' || !comfy.workflow.trim()) return null
    try {
      return { analysis: analyzeWorkflow(parseApiWorkflow(comfy.workflow)) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [comfy.preset, comfy.workflow])

  const c = catalog
  const patchLora = (i: number, patch: Partial<ComfyConfig['loras'][number]>) => setComfy({ loras: comfy.loras.map((l, j) => (j === i ? { ...l, ...patch } : l)) })

  return (
    <div className="mt-3 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={check} disabled={checking || !baseUrl.trim()}>
          {checking ? 'Checking…' : 'Check connection'}
        </Button>
        {status && <span className={`text-xs ${status.ok ? 'text-success' : 'text-danger'}`}>{status.detail}</span>}
      </div>
      <p className="text-xs text-text-muted">Requests go through {BRAND.name}'s own server, so ComfyUI needs no special launch flags. If {BRAND.name} runs in Docker, use an address the container can reach.</p>

      <div>
        <div className="mb-1.5 text-xs font-medium text-text-muted">Workflow</div>
        <SegmentedControl options={PRESETS} value={comfy.preset} onChange={(preset) => setComfy({ preset })} size="sm" />
        <p className="mt-1.5 text-xs text-text-muted">{PRESET_HELP[comfy.preset]}</p>
      </div>

      {comfy.preset === 'checkpoint' && (
        <Pick label="Checkpoint" value={model} options={c?.checkpoints ?? []} onChange={(v) => setImageBackendConfig({ imageBackendModel: v })} hint="Default uses the first checkpoint ComfyUI has." allowEmpty />
      )}

      {comfy.preset === 'dit' && (
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <Pick label="Diffusion model" value={comfy.unet} options={c?.unets ?? []} onChange={(unet) => setComfy({ unet })} />
          <Pick label="Text encoder" value={comfy.clip} options={c?.clips ?? []} onChange={(clip) => setComfy({ clip })} />
          <Pick label="Text encoder type" value={comfy.clipType} options={c?.clipTypes ?? []} onChange={(clipType) => setComfy({ clipType })} hint="How ComfyUI reads the encoder. Anima uses cosmos." />
          <Pick label="VAE" value={comfy.vae} options={c?.vaes ?? []} onChange={(vae) => setComfy({ vae })} />
        </div>
      )}

      {comfy.preset !== 'custom' && (
        <>
          <Pick label="Scheduler" value={comfy.scheduler} options={c?.schedulers ?? []} onChange={(scheduler) => setComfy({ scheduler })} hint="Blank uses a sensible default for the workflow." allowEmpty />
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-text-muted">LoRAs</span>
              <Button variant="ghost" onClick={() => setComfy({ loras: [...comfy.loras, { name: c?.loras[0] ?? '', strength: 0.8 }] })} className="flex items-center gap-1">
                <Plus size={13} />
                Add
              </Button>
            </div>
            {comfy.loras.length === 0 && <p className="text-xs text-text-muted">None. LoRAs are applied to every picture.</p>}
            {comfy.loras.map((l, i) => (
              <div key={i} className="mb-2 flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Pick label={`LoRA ${i + 1}`} value={l.name} options={c?.loras ?? []} onChange={(name) => patchLora(i, { name })} />
                </div>
                <label className="mb-3 w-20 text-xs text-text-muted">
                  Strength
                  <input type="number" step="0.05" min="-2" max="2" value={l.strength} onChange={(e) => patchLora(i, { strength: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent/70" />
                </label>
                <button onClick={() => setComfy({ loras: comfy.loras.filter((_, j) => j !== i) })} aria-label="Remove LoRA" className="mb-3 flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-danger/10 hover:text-danger">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {comfy.preset === 'custom' && (
        <div>
          <TextAreaField
            label="Workflow (API format)"
            rows={10}
            value={comfy.workflow}
            onChange={(e) => setComfy({ workflow: e.target.value })}
            placeholder='{"3": {"class_type": "KSampler", "inputs": { ... }}}'
            hint="Put {{prompt}} and {{negative}} in text inputs, or leave them out and the app finds the prompt nodes itself. Also available: {{seed}} {{width}} {{height}} {{steps}} {{cfg}} {{sampler}} {{model}}."
            className="[&_textarea]:font-mono [&_textarea]:text-[11px]"
          />
          <div className="mb-3 flex flex-wrap gap-2">
            <FileButton accept=".json" onPick={async (files) => setComfy({ workflow: await files[0].text() })}>
              Import file
            </FileButton>
            <Button onClick={() => setComfy({ workflow: animaWorkflow })} title="The workflow used by tools/comfy: Anima with separate loaders">
              Load the Anima example
            </Button>
          </div>
          {report && 'error' in report && <p className="text-xs text-danger">{report.error}</p>}
          {report && 'analysis' in report && (
            <div className="rounded-lg border border-border p-3 text-xs">
              <div className="mb-1 font-medium text-text">What the app will fill in</div>
              <ul className="space-y-0.5 text-text-muted">
                <li>Prompt: {report.analysis.tokens.includes('prompt') ? '{{prompt}} placeholder' : report.analysis.positive ? `text of node ${report.analysis.positive}` : 'not found'}</li>
                <li>Negative prompt: {report.analysis.tokens.includes('negative') ? '{{negative}} placeholder' : report.analysis.negative ? `text of node ${report.analysis.negative}` : 'none'}</li>
                <li>Seed: {report.analysis.tokens.includes('seed') ? '{{seed}} placeholder' : report.analysis.samplers.length ? `sampler ${report.analysis.samplers.join(', ')}` : 'not found'}</li>
                <li>Picture size: {report.analysis.tokens.includes('width') ? '{{width}} / {{height}}' : report.analysis.latents.length ? `latent node ${report.analysis.latents.join(', ')}` : 'left as in the workflow'}</li>
                <li>Steps and CFG stay as saved in your workflow unless you use {'{{steps}}'} / {'{{cfg}}'}.</li>
              </ul>
              {report.analysis.problems.map((p) => (
                <p key={p} className="mt-1.5 text-danger">
                  {p}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="relative flex items-center gap-2">
        <span className="text-sm">Test image generation</span>
        <GenerateImageButton label="Test image generation" width={832} height={1216} initialPrompt="1girl, silver hair, library, soft window light" onGenerated={setPreview} />
      </div>
      {preview && <img src={preview} alt="ComfyUI test generation" className="max-h-72 rounded-lg" />}
    </div>
  )
}

