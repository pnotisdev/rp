import { KoboldApiError } from './types'
import { uint8ArrayToBase64 } from './binaryUtils'
import type { ImageBackend, ImageGenerateParams, ImageGenerateResult } from './imageBackend'

type ComfyNode = { class_type: string; inputs: Record<string, unknown> }
type ComfyWorkflow = Record<string, ComfyNode>

/**
 * ComfyUI has no "just send a prompt" simple endpoint — every request is a full node graph, and a
 * real one varies with whatever's actually loaded (custom nodes, LoRAs, ControlNet, ...). This is
 * ComfyUI's own official default `txt2img` graph (from `script_examples/basic_api_example.py` in
 * the ComfyUI repo itself: CheckpointLoaderSimple → two CLIPTextEncode → EmptyLatentImage →
 * KSampler → VAEDecode → SaveImage) with this app's params substituted in — it'll work for a
 * standard install, but not for a user running a heavily customized workflow. A real "paste your
 * own workflow JSON" mode is a reasonable follow-up, not attempted here.
 */
function buildDefaultWorkflow(params: ImageGenerateParams, seed: number): ComfyWorkflow {
  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: params.steps,
        cfg: params.cfgScale,
        sampler_name: params.sampler ?? 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: params.model ?? '' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: params.width, height: params.height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: params.prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: params.negativePrompt ?? '', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'rp', images: ['8', 0] } },
  }
}

/** How long to wait for a queued generation before giving up — local Stable Diffusion, especially on a cold model load, can genuinely take a while; a stuck/errored job shouldn't hang forever either. */
const MAX_POLL_ATTEMPTS = 240
const POLL_INTERVAL_MS = 500

/**
 * ComfyUI's own graph-based API — confirmed from ComfyUI's official example script
 * (`script_examples/basic_api_example.py`) for the workflow shape, and its documented `/prompt`
 * (queue) → `/history/{id}` (poll for output) → `/view` (fetch bytes) flow. Uses polling rather
 * than the websocket progress API for simplicity; never run against a real ComfyUI instance.
 */
export class ComfyUIClient implements ImageBackend {
  constructor(private baseUrl: string) {}

  private base(): string {
    return this.baseUrl.replace(/\/+$/, '')
  }

  async generateImage(params: ImageGenerateParams, signal?: AbortSignal): Promise<ImageGenerateResult> {
    const seed = params.seed ?? Math.floor(Math.random() * 1_000_000_000_000)
    const workflow = buildDefaultWorkflow(params, seed)

    let queueRes: Response
    try {
      queueRes = await fetch(`${this.base()}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }),
      })
    } catch (e) {
      if (signal?.aborted) throw e
      throw new KoboldApiError(`Could not reach ComfyUI at ${this.baseUrl}.`)
    }
    if (!queueRes.ok) {
      const text = await queueRes.text().catch(() => '')
      throw new KoboldApiError(`ComfyUI rejected the workflow (${queueRes.status}): ${text.slice(0, 300)}`, queueRes.status)
    }
    const { prompt_id: promptId } = (await queueRes.json()) as { prompt_id: string }

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const histRes = await fetch(`${this.base()}/history/${promptId}`, { signal }).catch(() => null)
      if (histRes?.ok) {
        const history = (await histRes.json()) as Record<
          string,
          { outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }
        >
        const images = Object.values(history[promptId]?.outputs ?? {}).flatMap((o) => o.images ?? [])
        if (images.length > 0) {
          const img = images[0]
          const viewUrl = `${this.base()}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(img.type)}`
          const imgRes = await fetch(viewUrl, { signal })
          if (!imgRes.ok) throw new KoboldApiError(`ComfyUI produced an image but it couldn't be fetched (${imgRes.status}).`)
          const base64 = uint8ArrayToBase64(new Uint8Array(await imgRes.arrayBuffer()))
          return { base64, seed }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    throw new KoboldApiError('ComfyUI generation timed out waiting for a result.')
  }

  /** Reads the checkpoint list straight from the loader node's own schema — best-effort, an unreachable/older server just yields no models rather than an error. */
  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.base()}/object_info/CheckpointLoaderSimple`)
      if (!res.ok) return []
      const data = (await res.json()) as {
        CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[]] } } }
      }
      const names = data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]
      return Array.isArray(names) ? names : []
    } catch {
      return []
    }
  }
}
