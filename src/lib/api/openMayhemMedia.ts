import { hasAvailableOpenMayhemProvider, loadOpenMayhemModels, loadOpenMayhemImageModels, openMayhemAttribute, OPENMAYHEM_PROXY, type Attribute, type OpenMayhemModel } from './openMayhem'
import { kreaImageBody } from './openMayhemKrea'
import type { ImageBackend, ImageGenerateParams, ImageGenerateResult } from './imageBackend'

type Endpoint = 'IMAGES' | 'AUDIO_SPEECH'
type Job = { id: string; status: string; error?: string | { message?: string }; artifacts?: { id: string; contentType?: string; content_type?: string }[] }
const resourceId = (id: string) => {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw new Error('OpenMayhem returned an invalid resource ID.')
  return id
}
async function checkResponse(res: Response): Promise<Response> {
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: { message?: string }; message?: string } | null
    throw new Error(`OpenMayhem (${res.status}): ${body?.error?.message || body?.message || 'Request failed.'}`)
  }
  return res
}
function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 1500)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Submit once, poll without resubmitting, then retrieve the owned artifact through our relay. */
export async function generateOpenMayhemMedia(endpoint: Endpoint | 'WORKFLOWS', apiKey: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Blob> {
  if (!apiKey.trim()) throw new Error('Enter your OpenMayhem media API key in Settings first.')
  signal?.throwIfAborted()
  const headers = { Authorization: `Bearer ${apiKey.trim()}` }
  const lifetime = AbortSignal.any([AbortSignal.timeout(300000), ...(signal ? [signal] : [])])
  let jobId: string | undefined
  let terminal = false
  try {
    // Keep submission alive long enough to recover its ID even if the user presses Stop.
    // Once it arrives, the aborted lifetime triggers DELETE below instead of leaving an orphan job.
    let job: Job = await (await checkResponse(await fetch(`${OPENMAYHEM_PROXY}/${endpoint === 'WORKFLOWS' ? 'workflows' : endpoint === 'IMAGES' ? 'images/generations' : 'audio/speech'}`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    }))).json() as Job
    jobId = resourceId(job.id)
    for (;;) {
      lifetime.throwIfAborted()
      if (job.status === 'completed') { terminal = true; break }
      if (['failed', 'cancelled', 'expired'].includes(job.status)) {
        terminal = true
        throw new Error(typeof job.error === 'string' ? job.error : job.error?.message || `OpenMayhem job ${job.status}.`)
      }
      if (!['submitted', 'queued', 'pending', 'running', 'reconciling'].includes(job.status)) throw new Error('OpenMayhem returned an unknown job status.')
      await waitForPoll(lifetime)
      job = await (await checkResponse(await fetch(`${OPENMAYHEM_PROXY}/jobs/${jobId}`, { headers, signal: AbortSignal.any([lifetime, AbortSignal.timeout(30000)]) }))).json() as Job
    }
    const kind = endpoint === 'AUDIO_SPEECH' ? 'audio/' : 'image/'
    const artifact = job.artifacts?.find((a) => (a.contentType || a.content_type)?.startsWith(kind))
    if (!artifact) throw new Error('OpenMayhem completed without a usable media artifact.')
    const res = await checkResponse(await fetch(`${OPENMAYHEM_PROXY}/artifacts/${resourceId(artifact.id)}`, { headers, signal: lifetime }))
    const blob = await res.blob()
    if (!blob.size || !blob.type.startsWith(kind)) throw new Error('OpenMayhem returned invalid media data.')
    return blob
  } catch (error) {
    if (!jobId && (error instanceof TypeError || error instanceof DOMException && error.name === 'TimeoutError')) {
      throw new Error('OpenMayhem submission status is unknown after a connection failure. Check your OpenMayhem dashboard before retrying; a job may already be running.')
    }
    if (jobId && !terminal) {
      try {
        await checkResponse(await fetch(`${OPENMAYHEM_PROXY}/jobs/${jobId}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(10000) }))
      } catch {
        throw new Error(`Could not confirm cancellation of OpenMayhem job ${jobId}. Check your OpenMayhem dashboard before retrying; work may still be billed.`)
      }
    }
    throw error
  }
}

export async function availableMediaModel(endpoint: Endpoint, id: string): Promise<OpenMayhemModel> {
  if (!id) throw new Error(`Choose an OpenMayhem ${endpoint === 'IMAGES' ? 'image' : 'speech'} model in Settings first.`)
  const catalog = await (endpoint === 'IMAGES' ? loadOpenMayhemImageModels(true) : loadOpenMayhemModels(true, endpoint))
  const model = catalog.find((m) => m.id === id && hasAvailableOpenMayhemProvider(m))
  if (!model) throw new Error('This OpenMayhem model has no available compatible provider. Refresh Settings and choose an available model.')
  return model
}

function validate(value: unknown, attr: Attribute, key: string): void {
  if (attr.enumValues && !attr.enumValues.includes(value)
    || typeof value === 'number' && (!Number.isFinite(value) || value < (attr.minimum ?? -Infinity) || value > (attr.maximum ?? Infinity)
      || attr.multipleOf !== undefined && Math.abs(value / attr.multipleOf - Math.round(value / attr.multipleOf)) > 1e-7)
    || typeof value === 'string' && (value.length > (attr.maxLength ?? Infinity) || value.length < (attr.minLength ?? 0))) {
    throw new Error(`The selected OpenMayhem model does not support this ${key}. Check the model settings.`)
  }
}

function requiredFields(model: OpenMayhemModel, endpoint: Endpoint, body: Record<string, unknown>) {
  for (const c of model.request_contracts!.filter((c) => c.endpoint === endpoint)) {
    for (const key of c.required ?? []) if (body[key] === undefined) throw new Error(`This OpenMayhem model requires ${key}. Choose a different model.`)
  }
}

export function openMayhemVoices(model?: OpenMayhemModel): string[] | undefined {
  return model ? openMayhemAttribute(model, 'AUDIO_SPEECH', 'voice')?.enumValues?.filter((v): v is string => typeof v === 'string') : undefined
}

export async function speakOpenMayhem(apiKey: string, modelId: string, input: string, voice: string, signal?: AbortSignal): Promise<Blob> {
  const model = await availableMediaModel('AUDIO_SPEECH', modelId)
  const body: Record<string, unknown> = { model: model.id, input }
  const inputAttr = openMayhemAttribute(model, 'AUDIO_SPEECH', 'input')
  if (inputAttr) validate(input, inputAttr, 'text length')
  const attr = openMayhemAttribute(model, 'AUDIO_SPEECH', 'voice')
  const chosen = voice || attr?.default || openMayhemVoices(model)?.[0]
  if (chosen && attr) { validate(chosen, attr, 'voice'); body.voice = chosen }
  else if (voice) throw new Error('This OpenMayhem speech model does not support voice selection.')
  const format = openMayhemAttribute(model, 'AUDIO_SPEECH', 'response_format')
  if (format) {
    const playable = ['wav', 'mp3'].find((f) => !format.enumValues || format.enumValues.includes(f))
    if (!playable) throw new Error('This speech model has no browser-playable audio format.')
    body.response_format = playable
  }
  requiredFields(model, 'AUDIO_SPEECH', body)
  return generateOpenMayhemMedia('AUDIO_SPEECH', apiKey, body, signal)
}

/** Slots supply their aspect ratio. Hosted generation uses the model's own sampling defaults. */
export function openMayhemImageBody(model: OpenMayhemModel, params: ImageGenerateParams): Record<string, unknown> {
  const body: Record<string, unknown> = { model: model.id, prompt: params.prompt }
  const attr = (key: string) => openMayhemAttribute(model, 'IMAGES', key)
  if (params.prompt.length > 20000) throw new Error('OpenMayhem image prompts are limited to 20,000 characters.')
  if (attr('prompt')) validate(params.prompt, attr('prompt')!, 'prompt')
  const fit = (value: number, a?: Attribute) => {
    const multiple = a?.multipleOf || 1
    const min = Math.ceil((a?.minimum ?? 1) / multiple) * multiple
    const max = Math.floor((a?.maximum ?? 4096) / multiple) * multiple
    return Math.max(min, Math.min(max, Math.round(value / multiple) * multiple))
  }
  if (attr('width') && attr('height')) {
    const minScale = Math.max((attr('width')!.minimum ?? 1) / params.width, (attr('height')!.minimum ?? 1) / params.height)
    const maxScale = Math.min((attr('width')!.maximum ?? 4096) / params.width, (attr('height')!.maximum ?? 4096) / params.height)
    const scale = Math.min(maxScale, Math.max(1, minScale))
    body.width = fit(params.width * scale, attr('width'))
    body.height = fit(params.height * scale, attr('height'))
  } else if (attr('size')) {
    const sizes = attr('size')!.enumValues?.filter((s): s is string => typeof s === 'string' && /^\d+x\d+$/.test(s))
    body.size = sizes?.length ? sizes.slice().sort((a, b) => {
      const distance = (size: string) => { const [w, h] = size.split('x').map(Number); return Math.abs(w / h - params.width / params.height) }
      return distance(a) - distance(b)
    })[0] : `${params.width}x${params.height}`
  }
  for (const [key, fallback] of [['steps', params.steps], ['cfg_scale', params.cfgScale]] as const) {
    const a = attr(key)
    if (a) body[key] = a.default ?? Math.max(a.minimum ?? 0, Math.min(a.maximum ?? Infinity, fallback))
  }
  if (attr('n')) body.n = 1
  if (attr('seed')) body.seed = params.seed !== undefined && params.seed >= 0 ? params.seed : Math.floor(Math.random() * Math.min(4294967296, (attr('seed')!.maximum ?? 4294967295) + 1))
  if (params.negativePrompt) {
    if (!attr('negative_prompt')) throw new Error('This OpenMayhem model does not support a negative prompt.')
    body.negative_prompt = params.negativePrompt
  }
  for (const [key, value] of Object.entries(body)) if (key !== 'model' && attr(key)) validate(value, attr(key)!, key)
  requiredFields(model, 'IMAGES', body)
  return body
}

export class OpenMayhemImageClient implements ImageBackend {
  constructor(private apiKey: string, private model: string) {}
  async listModels(): Promise<string[]> { return (await loadOpenMayhemImageModels(true)).filter(hasAvailableOpenMayhemProvider).map((m) => m.id) }
  async generateImage(params: ImageGenerateParams, signal?: AbortSignal): Promise<ImageGenerateResult> {
    const model = await availableMediaModel('IMAGES', params.model || this.model)
    const workflow = model.endpoints.includes('WORKFLOWS') ? kreaImageBody(model, params) : undefined
    const body = workflow?.body ?? openMayhemImageBody(model, params)
    const blob = await generateOpenMayhemMedia(workflow ? 'WORKFLOWS' : 'IMAGES', this.apiKey, body, signal)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return { base64: btoa(binary), mimeType: blob.type, seed: workflow?.seed ?? (typeof body.seed === 'number' ? body.seed : undefined) }
  }
}
