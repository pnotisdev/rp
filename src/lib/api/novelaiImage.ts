import { KoboldApiError } from './types'
import { extractFirstFileFromZip, uint8ArrayToBase64 } from './binaryUtils'
import type { ImageBackend, ImageGenerateParams, ImageGenerateResult } from './imageBackend'
import { novelaiUrl } from './novelai'

/** NovelAI's image models. There is no endpoint that lists them, so this is a fixed list; any other id can still be typed in. */
export const NOVELAI_IMAGE_MODELS = ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-full', 'nai-diffusion-4-curated-preview', 'nai-diffusion-3']

/** V4 and V4.5 take the prompt as structured captions and a longer parameter list than V3. */
export const isV4Model = (model: string) => /nai-diffusion-4/.test(model)

/** Pictures up to about one megapixel are free of extra cost on the subscription, and sizes must be multiples of 64. */
const MAX_PIXELS = 1_048_576

export function fitNovelAISize(width: number, height: number): { width: number; height: number } {
  const snap = (n: number) => Math.max(64, Math.round(n / 64) * 64)
  let w = snap(width)
  let h = snap(height)
  if (w * h > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (w * h))
    w = Math.max(64, Math.floor((w * k) / 64) * 64)
    h = Math.max(64, Math.floor((h * k) / 64) * 64)
  }
  return { width: w, height: h }
}

const SAMPLERS: Record<string, string> = {
  euler: 'k_euler',
  euler_ancestral: 'k_euler_ancestral',
  'euler a': 'k_euler_ancestral',
  dpmpp_2m: 'k_dpmpp_2m',
  dpmpp_sde: 'k_dpmpp_sde',
  dpmpp_2s_ancestral: 'k_dpmpp_2s_ancestral',
}

function samplerFor(requested: string | undefined, v4: boolean): string {
  if (requested?.startsWith('k_') || requested === 'ddim_v3') return requested
  return (requested && SAMPLERS[requested.toLowerCase()]) || (v4 ? 'k_euler_ancestral' : 'k_euler')
}

/** The JSON body for `/ai/generate-image`. Exported so the shape can be tested without a network. */
export function buildNovelAIImageBody(params: ImageGenerateParams, seed: number, model: string): Record<string, unknown> {
  const v4 = isV4Model(model)
  const { width, height } = fitNovelAISize(params.width, params.height)
  const negative = params.negativePrompt ?? ''
  const parameters: Record<string, unknown> = {
    width,
    height,
    scale: params.cfgScale,
    sampler: samplerFor(params.sampler, v4),
    steps: params.steps,
    seed,
    n_samples: 1,
    negative_prompt: negative,
    qualityToggle: false,
    ucPreset: 0,
  }
  if (v4) {
    Object.assign(parameters, {
      params_version: 3,
      noise_schedule: 'karras',
      cfg_rescale: 0,
      legacy: false,
      legacy_v3_extend: false,
      use_coords: false,
      characterPrompts: [],
      v4_prompt: { caption: { base_caption: params.prompt, char_captions: [] }, use_coords: false, use_order: true },
      v4_negative_prompt: { caption: { base_caption: negative, char_captions: [] }, legacy_uc: false },
    })
  }
  return { input: params.prompt, model, action: 'generate', parameters }
}

/** NovelAI's hosted image generation (`/ai/generate-image`), relayed through this app's server. */
export class NovelAIImageClient implements ImageBackend {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` }
  }

  async generateImage(params: ImageGenerateParams, signal?: AbortSignal): Promise<ImageGenerateResult> {
    if (!this.apiKey.trim()) throw new KoboldApiError('Add your NovelAI API key in Settings, Images.')
    const seed = params.seed !== undefined && params.seed >= 0 ? params.seed : Math.floor(Math.random() * 4_294_967_295)
    const model = this.model.trim() || NOVELAI_IMAGE_MODELS[0]
    let res: Response
    try {
      res = await fetch(novelaiUrl('image', '/ai/generate-image'), {
        method: 'POST',
        headers: this.headers(),
        signal,
        body: JSON.stringify(buildNovelAIImageBody(params, seed, model)),
      })
    } catch (e) {
      if (signal?.aborted) throw e
      throw new KoboldApiError('Could not reach NovelAI for image generation.')
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const hint = res.status === 401 ? ' The API key was rejected.' : res.status === 402 ? ' This needs an active subscription or Anlas.' : ''
      throw new KoboldApiError(`NovelAI image generation failed (${res.status}).${hint} ${text.slice(0, 300)}`.trim(), res.status)
    }
    const zipBytes = await res.arrayBuffer()
    const pngBytes = await extractFirstFileFromZip(zipBytes)
    return { base64: uint8ArrayToBase64(pngBytes), seed }
  }

  async listModels(): Promise<string[]> {
    return [...NOVELAI_IMAGE_MODELS]
  }
}
