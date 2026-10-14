// ComfyUI image backend: queues a workflow through the local server's relay (ComfyUI sends no CORS headers), waits, and fetches the picture.

import { KoboldApiError } from './types'
import { BRAND } from '@/lib/brand'
import { uint8ArrayToBase64 } from './binaryUtils'
import { buildWorkflow, ComfyWorkflowError, DEFAULT_COMFY_CONFIG, type ComfyConfig } from './comfyWorkflow'
import type { ImageBackend, ImageGenerateParams, ImageGenerateResult } from './imageBackend'

/** How long to wait for a queued generation before giving up. A cold model load on local hardware can take minutes. */
const MAX_POLL_ATTEMPTS = 480
const POLL_INTERVAL_MS = 500

export interface ComfyCatalog {
  checkpoints: string[]
  unets: string[]
  clips: string[]
  clipTypes: string[]
  vaes: string[]
  loras: string[]
  samplers: string[]
  schedulers: string[]
}

export interface ComfyStatus {
  ok: boolean
  detail: string
}

type ObjectInfo = Record<string, { input?: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> } }>

/** Reads the allowed values of one input from an `/object_info` reply. */
function choices(info: ObjectInfo, node: string, input: string): string[] {
  const spec = info[node]?.input?.required?.[input] ?? info[node]?.input?.optional?.[input]
  const list = Array.isArray(spec) ? spec[0] : undefined
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
}

/** A readable sentence from ComfyUI's error body: the node errors say which input has a bad value. */
export function describeComfyError(body: unknown): string {
  const o = (body ?? {}) as { error?: unknown; node_errors?: Record<string, { class_type?: string; errors?: { message?: string; details?: string }[] }> }
  const top = typeof o.error === 'string' ? o.error : ((o.error as { message?: string } | undefined)?.message ?? '')
  const nodes = Object.entries(o.node_errors ?? {}).flatMap(([id, n]) => (n.errors ?? []).map((e) => `${n.class_type ?? 'node'} #${id}: ${[e.message, e.details].filter(Boolean).join(' - ')}`))
  return [top, ...nodes].filter(Boolean).join('\n').slice(0, 600) || 'no details'
}

export class ComfyUIClient implements ImageBackend {
  constructor(
    private baseUrl: string,
    private config: ComfyConfig = DEFAULT_COMFY_CONFIG,
  ) {}

  private base(): string {
    return this.baseUrl.trim().replace(/\/+$/, '')
  }

  /** One request to ComfyUI through the relay. */
  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `/api/comfy/proxy?base=${encodeURIComponent(this.base())}&path=${encodeURIComponent(path)}`
    try {
      return await fetch(url, init)
    } catch (e) {
      if (init.signal?.aborted) throw e
      throw new KoboldApiError(`Could not reach the ${BRAND.name} server to talk to ComfyUI.`)
    }
  }

  async generateImage(params: ImageGenerateParams, signal?: AbortSignal): Promise<ImageGenerateResult> {
    const seed = params.seed !== undefined && params.seed >= 0 ? params.seed : Math.floor(Math.random() * 1_000_000_000_000)
    let workflow
    try {
      // The checkpoint graph needs a real file name; with none chosen, take the first ComfyUI has.
      const model = params.model || (this.config.preset === 'checkpoint' ? (await this.listModels())[0] : undefined)
      workflow = buildWorkflow({ ...params, model }, seed, this.config)
    } catch (e) {
      if (e instanceof ComfyWorkflowError) throw new KoboldApiError(e.message)
      throw e
    }

    const queueRes = await this.call('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }),
    })
    if (queueRes.status === 502) throw new KoboldApiError(`Could not reach ComfyUI at ${this.baseUrl}. Is it running?`)
    if (!queueRes.ok) {
      const body = await queueRes.json().catch(() => null)
      throw new KoboldApiError(`ComfyUI rejected the workflow (${queueRes.status}): ${describeComfyError(body)}`, queueRes.status)
    }
    const { prompt_id: promptId } = (await queueRes.json()) as { prompt_id: string }

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      if (signal?.aborted) {
        void this.call('/interrupt', { method: 'POST' }).catch(() => undefined)
        throw new DOMException('Aborted', 'AbortError')
      }
      const histRes = await this.call(`/history/${encodeURIComponent(promptId)}`, { signal }).catch(() => null)
      if (histRes?.ok) {
        const history = (await histRes.json()) as Record<
          string,
          {
            outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>
            status?: { status_str?: string; messages?: [string, { exception_message?: string; node_type?: string }][] }
          }
        >
        const entry = history[promptId]
        const failure = entry?.status?.status_str === 'error' ? entry.status.messages?.find((m) => m[0] === 'execution_error')?.[1] : undefined
        if (entry?.status?.status_str === 'error') throw new KoboldApiError(`ComfyUI failed while generating${failure?.node_type ? ` (${failure.node_type})` : ''}: ${failure?.exception_message?.trim() || 'see the ComfyUI console'}`)
        const images = Object.values(entry?.outputs ?? {}).flatMap((o) => o.images ?? [])
        const img = images.find((i) => i.type === 'output') ?? images[0]
        if (img) {
          const imgRes = await this.call(`/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(img.type)}`, { signal })
          if (!imgRes.ok) throw new KoboldApiError(`ComfyUI produced an image but it couldn't be fetched (${imgRes.status}).`)
          return { base64: uint8ArrayToBase64(new Uint8Array(await imgRes.arrayBuffer())), seed }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    throw new KoboldApiError('ComfyUI generation timed out waiting for a result.')
  }

  /** Checkpoint names, straight from the loader node's own schema. An unreachable server yields no models rather than an error. */
  async listModels(): Promise<string[]> {
    try {
      const res = await this.call('/object_info/CheckpointLoaderSimple')
      if (!res.ok) return []
      return choices((await res.json()) as ObjectInfo, 'CheckpointLoaderSimple', 'ckpt_name')
    } catch {
      return []
    }
  }

  /** Everything the settings page offers in dropdowns, read from the running ComfyUI. */
  async catalog(): Promise<ComfyCatalog> {
    const ask = async (node: string): Promise<ObjectInfo> => {
      try {
        const res = await this.call(`/object_info/${node}`)
        return res.ok ? ((await res.json()) as ObjectInfo) : {}
      } catch {
        return {}
      }
    }
    const [ckpt, unet, clip, vae, lora, ksampler] = await Promise.all(['CheckpointLoaderSimple', 'UNETLoader', 'CLIPLoader', 'VAELoader', 'LoraLoader', 'KSampler'].map(ask))
    return {
      checkpoints: choices(ckpt, 'CheckpointLoaderSimple', 'ckpt_name'),
      unets: choices(unet, 'UNETLoader', 'unet_name'),
      clips: choices(clip, 'CLIPLoader', 'clip_name'),
      clipTypes: choices(clip, 'CLIPLoader', 'type'),
      vaes: choices(vae, 'VAELoader', 'vae_name'),
      loras: choices(lora, 'LoraLoader', 'lora_name'),
      samplers: choices(ksampler, 'KSampler', 'sampler_name'),
      schedulers: choices(ksampler, 'KSampler', 'scheduler'),
    }
  }

  /** Is ComfyUI up, and what is it running on? */
  async check(): Promise<ComfyStatus> {
    let res: Response
    try {
      res = await this.call('/system_stats')
    } catch {
      return { ok: false, detail: `Could not reach the ${BRAND.name} server.` }
    }
    if (res.status === 502) return { ok: false, detail: `Could not reach ComfyUI at ${this.baseUrl}. Is it running, with that address?` }
    if (!res.ok) return { ok: false, detail: `ComfyUI answered ${res.status}.` }
    const stats = (await res.json().catch(() => null)) as { system?: { comfyui_version?: string }; devices?: { name?: string; vram_total?: number }[] } | null
    const device = stats?.devices?.[0]
    const gb = device?.vram_total ? ` (${Math.round(device.vram_total / 1024 ** 3)} GB)` : ''
    return { ok: true, detail: `Connected${stats?.system?.comfyui_version ? `, ComfyUI ${stats.system.comfyui_version}` : ''}${device?.name ? `, ${device.name.replace(/^cuda:\d+\s*/, '')}${gb}` : ''}.` }
  }
}
