// ComfyUI workflows in API format: two built-in graphs (checkpoint and split-loader DiT models), and filling in or patching a workflow the user brings.

import type { ImageGenerateParams } from './imageBackend'

export type ComfyNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }
export type ComfyWorkflow = Record<string, ComfyNode>

export type ComfyPreset = 'checkpoint' | 'dit' | 'custom'

export interface ComfyConfig {
  preset: ComfyPreset
  /** Split-loader models (Anima, Qwen-Image, Flux style): diffusion model, text encoder, VAE. */
  unet: string
  clip: string
  /** The CLIPLoader `type`, which tells ComfyUI how to read the text encoder (cosmos, qwen_image, flux, ...). */
  clipType: string
  vae: string
  scheduler: string
  loras: { name: string; strength: number }[]
  /** A workflow exported with "Save (API Format)". Placeholders like {{prompt}} are optional. */
  workflow: string
}

export const DEFAULT_COMFY_CONFIG: ComfyConfig = {
  preset: 'checkpoint',
  unet: '',
  clip: '',
  clipType: 'cosmos',
  vae: '',
  scheduler: '',
  loras: [],
  workflow: '',
}

export class ComfyWorkflowError extends Error {}

type Link = [string, number]

/** Chains LoRA loaders after `model` (and `clip` when given), returning the final links. */
function addLoras(wf: ComfyWorkflow, loras: ComfyConfig['loras'], model: Link, clip: Link | undefined): { model: Link; clip: Link | undefined } {
  let nextId = 100
  for (const lora of loras.filter((l) => l.name)) {
    const id = String(nextId++)
    wf[id] = clip
      ? { class_type: 'LoraLoader', inputs: { model, clip, lora_name: lora.name, strength_model: lora.strength, strength_clip: lora.strength } }
      : { class_type: 'LoraLoaderModelOnly', inputs: { model, lora_name: lora.name, strength_model: lora.strength } }
    model = [id, 0]
    if (clip) clip = [id, 1]
  }
  return { model, clip }
}

function sampler(params: ImageGenerateParams, seed: number, cfg: ComfyConfig, fallbackSampler: string, fallbackScheduler: string): ComfyNode {
  return {
    class_type: 'KSampler',
    inputs: {
      seed,
      steps: params.steps,
      cfg: params.cfgScale,
      sampler_name: params.sampler ?? fallbackSampler,
      scheduler: cfg.scheduler || fallbackScheduler,
      denoise: 1,
    },
  }
}

/** The classic graph: one checkpoint file that holds the model, text encoder and VAE. */
export function buildCheckpointWorkflow(params: ImageGenerateParams, seed: number, cfg: ComfyConfig = DEFAULT_COMFY_CONFIG): ComfyWorkflow {
  const wf: ComfyWorkflow = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: params.model ?? '' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: params.width, height: params.height, batch_size: 1 } },
  }
  const { model, clip } = addLoras(wf, cfg.loras, ['4', 0], ['4', 1])
  wf['6'] = { class_type: 'CLIPTextEncode', inputs: { text: params.prompt, clip } }
  wf['7'] = { class_type: 'CLIPTextEncode', inputs: { text: params.negativePrompt ?? '', clip } }
  const s = sampler(params, seed, cfg, 'euler', 'normal')
  wf['3'] = { class_type: 'KSampler', inputs: { ...s.inputs, model, positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } }
  wf['8'] = { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } }
  wf['9'] = { class_type: 'SaveImage', inputs: { filename_prefix: 'rp', images: ['8', 0] } }
  return wf
}

/** Split-loader graph for newer diffusion transformers: separate model, text encoder and VAE files. */
export function buildDitWorkflow(params: ImageGenerateParams, seed: number, cfg: ComfyConfig): ComfyWorkflow {
  if (!cfg.unet || !cfg.clip || !cfg.vae) throw new ComfyWorkflowError('Choose the diffusion model, text encoder and VAE in Settings, Images.')
  const wf: ComfyWorkflow = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: cfg.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: cfg.clip, type: cfg.clipType || 'cosmos', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: cfg.vae } },
    '5': { class_type: 'EmptySD3LatentImage', inputs: { width: params.width, height: params.height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: params.prompt, clip: ['2', 0] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: params.negativePrompt ?? '', clip: ['2', 0] } },
  }
  const { model } = addLoras(wf, cfg.loras, ['1', 0], undefined)
  const s = sampler(params, seed, cfg, 'dpmpp_2m', 'simple')
  wf['4'] = { class_type: 'KSampler', inputs: { ...s.inputs, model, positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } }
  wf['8'] = { class_type: 'VAEDecode', inputs: { samples: ['4', 0], vae: ['3', 0] } }
  wf['9'] = { class_type: 'SaveImage', inputs: { filename_prefix: 'rp', images: ['8', 0] } }
  return wf
}

// ---- A workflow the user brings ----

const TOKEN_RE = /\{\{\s*(prompt|negative|seed|width|height|steps|cfg|sampler|model)\s*\}\}/g
const LEGACY_SLOTS: Record<string, string> = { SLOT_POSITIVE: 'prompt', SLOT_NEGATIVE: 'negative' }
const NUMERIC = new Set(['seed', 'width', 'height', 'steps', 'cfg'])
const SAMPLER_CLASSES = /KSampler|SamplerCustom|SamplerAdvanced/i

/** Reads pasted JSON: API format only, with a clear message for the UI format that cannot be run directly. */
export function parseApiWorkflow(text: string): ComfyWorkflow {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ComfyWorkflowError('The workflow is not valid JSON.')
  }
  const root = raw && typeof raw === 'object' && 'prompt' in raw && typeof (raw as { prompt: unknown }).prompt === 'object' ? (raw as { prompt: unknown }).prompt : raw
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new ComfyWorkflowError('The workflow should be a JSON object of nodes.')
  if ('nodes' in root && Array.isArray((root as { nodes: unknown }).nodes)) {
    throw new ComfyWorkflowError('This is a UI-format workflow. In ComfyUI choose Workflow, Export (API) and paste that file instead.')
  }
  const wf = root as Record<string, unknown>
  for (const [id, node] of Object.entries(wf)) {
    const n = node as { class_type?: unknown; inputs?: unknown }
    if (!n || typeof n.class_type !== 'string' || !n.inputs || typeof n.inputs !== 'object') {
      throw new ComfyWorkflowError(`Node "${id}" is not in API format (it needs class_type and inputs).`)
    }
  }
  return wf as ComfyWorkflow
}

function isLink(v: unknown): v is Link {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number'
}

function tokenValues(params: ImageGenerateParams, seed: number): Record<string, string | number | undefined> {
  return { prompt: params.prompt, negative: params.negativePrompt ?? '', seed, width: params.width, height: params.height, steps: params.steps, cfg: params.cfgScale, sampler: params.sampler, model: params.model }
}

/** Replaces {{tokens}} in every string input. A value that is only a numeric token becomes a number. Returns how many were replaced, by token. */
function substituteTokens(wf: ComfyWorkflow, values: Record<string, string | number | undefined>): Set<string> {
  const used = new Set<string>()
  for (const node of Object.values(wf)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (typeof value !== 'string') continue
      if (LEGACY_SLOTS[value]) {
        node.inputs[key] = values[LEGACY_SLOTS[value]] ?? ''
        used.add(LEGACY_SLOTS[value])
        continue
      }
      const whole = /^\s*\{\{\s*(\w+)\s*\}\}\s*$/.exec(value)
      if (whole && NUMERIC.has(whole[1]) && values[whole[1]] !== undefined) {
        node.inputs[key] = Number(values[whole[1]])
        used.add(whole[1])
        continue
      }
      node.inputs[key] = value.replace(TOKEN_RE, (_m, name: string) => {
        used.add(name)
        return String(values[name] ?? '')
      })
    }
  }
  return used
}

/** The text node feeding a sampler's `positive` or `negative` input, following links through conditioning nodes. */
function promptNodeFor(wf: ComfyWorkflow, samplerId: string, input: 'positive' | 'negative', depth = 0): string | undefined {
  const link = wf[samplerId]?.inputs[input]
  if (!isLink(link) || depth > 4) return undefined
  let id = link[0]
  for (let hop = 0; hop < 6; hop++) {
    const node = wf[id]
    if (!node) return undefined
    if (typeof node.inputs.text === 'string') return id
    // Conditioning passes through nodes like ControlNetApply or FluxGuidance: follow their own conditioning input.
    const next = Object.values(node.inputs).find((v, i) => isLink(v) && /condition|positive|negative/i.test(Object.keys(node.inputs)[i]))
    if (!isLink(next)) return undefined
    id = next[0]
  }
  return undefined
}

export interface WorkflowReport {
  samplers: string[]
  positive?: string
  negative?: string
  latents: string[]
  outputs: string[]
  tokens: string[]
  problems: string[]
}

/** What the app will fill in for this workflow. Used by Settings to show the user what was recognised. */
export function analyzeWorkflow(wf: ComfyWorkflow): WorkflowReport {
  const samplers = Object.keys(wf).filter((id) => SAMPLER_CLASSES.test(wf[id].class_type))
  const tokens = new Set<string>()
  for (const node of Object.values(wf)) {
    for (const v of Object.values(node.inputs)) {
      if (typeof v !== 'string') continue
      for (const m of v.matchAll(TOKEN_RE)) tokens.add(m[1])
      if (LEGACY_SLOTS[v]) tokens.add(LEGACY_SLOTS[v])
    }
  }
  const positive = samplers.length ? promptNodeFor(wf, samplers[0], 'positive') : undefined
  const negative = samplers.length ? promptNodeFor(wf, samplers[0], 'negative') : undefined
  const latents = Object.keys(wf).filter((id) => /Latent/i.test(wf[id].class_type) && typeof wf[id].inputs.width === 'number' && typeof wf[id].inputs.height === 'number')
  const outputs = Object.keys(wf).filter((id) => /^(SaveImage|PreviewImage|SaveAnimated)/i.test(wf[id].class_type))
  const problems: string[] = []
  if (!tokens.has('prompt') && !positive) problems.push('No prompt input was found. Add {{prompt}} to a text input.')
  if (!outputs.length) problems.push('There is no SaveImage or PreviewImage node, so no picture can be read back.')
  return { samplers, positive, negative, latents, outputs, tokens: [...tokens], problems }
}

/** Fills a user workflow with this request: {{tokens}} where present, otherwise the prompt, seed and picture size are found and set automatically. */
export function fillCustomWorkflow(text: string, params: ImageGenerateParams, seed: number): ComfyWorkflow {
  const wf = parseApiWorkflow(text)
  const used = substituteTokens(wf, tokenValues(params, seed))
  const report = analyzeWorkflow(wf)
  if (!used.has('prompt')) {
    if (!report.positive) throw new ComfyWorkflowError('Could not find where the prompt goes. Add {{prompt}} to the positive text input of your workflow.')
    wf[report.positive].inputs.text = params.prompt
    if (report.negative && !used.has('negative') && params.negativePrompt) wf[report.negative].inputs.text = params.negativePrompt
  }
  if (!used.has('seed')) {
    for (const id of report.samplers) {
      for (const key of ['seed', 'noise_seed']) if (typeof wf[id].inputs[key] === 'number') wf[id].inputs[key] = seed
    }
    for (const node of Object.values(wf)) if (/RandomNoise/i.test(node.class_type) && typeof node.inputs.noise_seed === 'number') node.inputs.noise_seed = seed
  }
  if (!used.has('width') && !used.has('height')) {
    for (const id of report.latents) {
      wf[id].inputs.width = params.width
      wf[id].inputs.height = params.height
    }
  }
  return wf
}

/** The workflow for a request under the chosen preset. */
export function buildWorkflow(params: ImageGenerateParams, seed: number, cfg: ComfyConfig): ComfyWorkflow {
  if (cfg.preset === 'custom') return fillCustomWorkflow(cfg.workflow, params, seed)
  if (cfg.preset === 'dit') return buildDitWorkflow(params, seed, cfg)
  return buildCheckpointWorkflow(params, seed, cfg)
}
