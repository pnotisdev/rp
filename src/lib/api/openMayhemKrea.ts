import type { OpenMayhemModel } from './openMayhem'
import type { ImageGenerateParams } from './imageBackend'

type Rule = {
  value_type: string; required?: boolean; fixed?: unknown; minimum?: number; maximum?: number
  multiple_of?: number; min_length?: number; max_length?: number; enum_values?: unknown[]
  part_type?: string; part_names?: string[]; sources?: { role: string; output: number }[]
  same_value_as?: { role: string; input: string }
}
export interface KreaPresentation {
  schema_version: number; kind: string; family: string; default_preset: string
  presets: { id: string; inputs: { role: string; input: string; value: unknown }[] }[]
}
export interface KreaPolicy {
  max_nodes: number; max_width: number; max_height: number; max_steps: number; max_artifacts: number
  parts: { name: string; type: string; sha256: string }[]
  dimension_bounds: { min_width: number; min_height: number; max_pixels: number; width_multiple: number; height_multiple: number }
  graph_constraints: { output_role: string; roles: Record<string, { class_type: string; min_count: number; max_count: number; inputs: Record<string, Rule> }> }
}
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>
// Only the reviewed base-image graph is supported. In particular, never materialize LoRA nodes.
const classes: Record<string, string[]> = {
  clip: ['CLIPLoader'], vae: ['VAELoader'], denoiser: ['UNETLoader'],
  latent: ['EmptySD3LatentImage', 'EmptyLatentImage'], positive: ['CLIPTextEncode'], negative: ['CLIPTextEncode'],
  sampling: ['ModelSamplingFlux'], sampler: ['KSampler'], decode: ['VAEDecode'], output: ['SaveImage'],
}
const links: Record<string, string> = {
  'positive.clip': 'clip', 'negative.clip': 'clip', 'sampling.model': 'denoiser',
  'sampler.model': 'sampling', 'sampler.positive': 'positive', 'sampler.negative': 'negative',
  'sampler.latent_image': 'latent', 'decode.samples': 'sampler', 'decode.vae': 'vae', 'output.images': 'decode',
}
const presetFields = new Set(['sampler.steps', 'sampler.cfg', 'sampler.sampler_name', 'sampler.scheduler', 'sampling.base_shift', 'sampling.max_shift'])
function fail(message = 'This Krea model configuration is currently unsupported. Refresh models or choose another model.'): never { throw new Error(message) }
function positive(value: number): boolean { return Number.isFinite(value) && value > 0 }

function checkValue(value: unknown, rule: Rule): void {
  if (rule.fixed !== undefined && value !== rule.fixed || rule.enum_values && !rule.enum_values.includes(value)) fail()
  if (rule.value_type === 'integer' || rule.value_type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || rule.value_type === 'integer' && !Number.isSafeInteger(value)
      || value < (rule.minimum ?? -Infinity) || value > (rule.maximum ?? Infinity)
      || rule.multiple_of !== undefined && (!positive(rule.multiple_of) || value % rule.multiple_of !== 0)) fail()
  } else if (rule.value_type === 'string') {
    if (typeof value !== 'string' || value.length < (rule.min_length ?? 0) || value.length > (rule.max_length ?? Infinity)) fail()
  } else if (rule.value_type !== 'link' && rule.value_type !== 'part') fail()
}

/** Fit the slot inside both the published graph limits and every advertised live image capacity. */
function dimensions(model: OpenMayhemModel, width: number, height: number) {
  const policy = model.workflow!, bounds = policy.dimension_bounds
  if (![width, height, bounds.min_width, bounds.min_height, bounds.max_pixels, bounds.width_multiple, bounds.height_multiple,
    policy.max_width, policy.max_height].every(positive)) fail('Invalid image dimensions or model size limits.')
  const capacities = model.live_capacity_profiles?.map((p) => p.modalities.image)
  if (!capacities?.length || capacities.some((c) => !c || c.unit !== 'pixel' || !positive(c.maxItemUnits) || !positive(c.maxItemsPerRequest))) fail()
  const maxPixels = Math.min(bounds.max_pixels, ...capacities.map((c) => c!.maxItemUnits))
  const maxWidth = Math.min(policy.max_width, 4096), maxHeight = Math.min(policy.max_height, 4096)
  const scale = Math.min(1, maxWidth / width, maxHeight / height, Math.sqrt(maxPixels / (width * height)))
  const targetArea = width * height * scale * scale
  let best: { width: number; height: number; score: number } | undefined
  if (bounds.width_multiple < 8 || bounds.height_multiple < 8) fail()
  for (let w = Math.ceil(bounds.min_width / bounds.width_multiple) * bounds.width_multiple; w <= maxWidth; w += bounds.width_multiple) {
    for (let h = Math.ceil(bounds.min_height / bounds.height_multiple) * bounds.height_multiple; h <= maxHeight; h += bounds.height_multiple) {
      if (w * h > maxPixels) continue
      const score = Math.abs(Math.log((w / h) / (width / height))) * 3 + Math.abs(Math.log(w * h / targetArea))
      if (!best || score < best.score) best = { width: w, height: h, score }
    }
  }
  if (!best) fail('No supported image size is currently available for this model.')
  return { width: best.width, height: best.height }
}

export function kreaImageBody(model: OpenMayhemModel, params: ImageGenerateParams): { body: Record<string, unknown>; seed: number } {
  const display = model.workflow_media, policy = model.workflow
  if (!display || display.schema_version !== 1 || display.kind !== 'image'
    || !['krea2-turbo', 'krea2-raw'].includes(display.family) || !policy) fail()
  const contracts = model.request_contracts?.filter((c) => c.endpoint === 'WORKFLOWS')
  if (!model.endpoints.includes('WORKFLOWS') || !contracts?.length || contracts.some((c) =>
    !c.attributes?.workflow || (c.required ?? []).some((key) => !['model', 'workflow', 'response_format'].includes(key))
    || c.attributes.response_format?.enumValues && !c.attributes.response_format.enumValues.includes('artifact'))) fail()
  if (!params.prompt.trim() || params.prompt.length > 16384 || (params.negativePrompt?.length ?? 0) > 16384) fail('Krea prompts must contain text and be at most 16,384 characters.')
  const roles = policy.graph_constraints?.roles
  if (!roles || policy.graph_constraints.output_role !== 'output' || ![policy.max_nodes, policy.max_artifacts, policy.max_steps].every(positive)
    || policy.max_nodes < 10 || policy.max_artifacts < 1) fail()
  for (const [role, definition] of Object.entries(roles)) {
    if (!Object.prototype.hasOwnProperty.call(classes, role) && definition.min_count > 0) fail()
  }
  const presetId = display.family === 'krea2-turbo' && params.negativePrompt?.trim() ? 'turbo-negative' : display.default_preset
  const preset = display.presets?.find((p) => p.id === presetId)
  if (!preset) fail('This model has no compatible generation preset for the supplied prompt.')
  const settings: Record<string, unknown> = {}
  for (const entry of preset.inputs) {
    const key = `${entry.role}.${entry.input}`
    if (!presetFields.has(key) || key in settings) fail()
    settings[key] = entry.value
  }
  if ([...presetFields].some((key) => !(key in settings)) || typeof settings['sampler.steps'] !== 'number' || settings['sampler.steps'] > policy.max_steps) fail()
  if (params.negativePrompt?.trim() && Number(settings['sampler.cfg']) <= 1) fail('This model preset cannot apply a negative prompt.')
  const size = dimensions(model, params.width, params.height)
  const seedRule = roles.sampler?.inputs.seed
  if (!seedRule || !Number.isSafeInteger(seedRule.maximum) || seedRule.maximum! < 0) fail()
  const seed = params.seed !== undefined && params.seed >= 0 ? params.seed : Math.floor(Math.random() * (Math.min(4294967295, seedRule.maximum!) + 1))
  Object.assign(settings, {
    'positive.text': params.prompt, 'negative.text': params.negativePrompt ?? '', 'sampler.seed': seed,
    'latent.width': size.width, 'latent.height': size.height, 'latent.batch_size': 1,
    'sampling.width': size.width, 'sampling.height': size.height, 'output.filename_prefix': 'rp-suite',
  })
  const graph: Graph = {}
  for (const [role, allowedClasses] of Object.entries(classes)) {
    const definition = roles[role]
    if (!definition || !allowedClasses.includes(definition.class_type) || definition.min_count > 1 || definition.max_count < 1) fail()
    const inputs: Record<string, unknown> = {}
    for (const [input, rule] of Object.entries(definition.inputs)) {
      const key = `${role}.${input}`
      let value: unknown
      if (rule.value_type === 'link') {
        const source = links[key]
        if (!source || !rule.sources?.some((s) => s.role === source && s.output === 0)) fail()
        value = [source, 0]
      } else if (rule.value_type === 'part') {
        if (rule.part_names?.length !== 1 || rule.part_type === 'lora') fail()
        const name = rule.part_names[0]
        if (!policy.parts?.some((p) => p.name === name && p.type === rule.part_type && /^[a-f0-9]{64}$/.test(p.sha256))) fail()
        value = name
      } else if (key in settings) value = settings[key]
      else if (rule.fixed !== undefined) value = rule.fixed
      else if (!rule.required) continue
      else fail()
      checkValue(value, rule)
      inputs[input] = value
    }
    if (Object.keys(settings).some((key) => key.startsWith(`${role}.`) && !(key.slice(role.length + 1) in inputs))) fail()
    graph[role] = { class_type: definition.class_type, inputs }
  }
  for (const [role, node] of Object.entries(graph)) for (const [input, rule] of Object.entries(roles[role].inputs)) {
    const same = rule.same_value_as
    if (same && node.inputs[input] !== graph[same.role]?.inputs[same.input]) fail()
  }
  return { body: { model: model.id, workflow: graph, response_format: 'artifact' }, seed }
}

export function isKreaImageModel(model: OpenMayhemModel): boolean {
  try { kreaImageBody(model, { prompt: 'Compatibility check', width: 768, height: 768, steps: 1, cfgScale: 1, seed: 0 }); return true }
  catch { return false }
}

export function openMayhemImageLabel(model: OpenMayhemModel): string {
  if (model.workflow_media?.family === 'krea2-turbo') return 'Krea 2 Turbo'
  if (model.workflow_media?.family === 'krea2-raw') return 'Krea 2 Quality'
  if (model.id === 'tongyi/z-image-turbo') return 'Z-Image Turbo'
  return model.name || model.id
}
