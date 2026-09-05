import { KoboldApiError } from './types'
import type { ImageBackend, ImageGenerateParams, ImageGenerateResult } from './imageBackend'

/**
 * Automatic1111's `stable-diffusion-webui` (and forks like Forge/reForge that keep the same API
 * surface) — the most standardized and widely-documented of section 11's four backends, run with
 * `--api` on the command line. Contract confirmed from the project's own official wiki
 * (`/sdapi/v1/txt2img` request/response shape, base64 images in the `images` array) — not
 * live-verified against a running instance this session.
 */
export class A1111Client implements ImageBackend {
  constructor(
    private baseUrl: string,
    /** A1111's own optional `--api-auth user:pass` flag — HTTP Basic, not an API key. */
    private username?: string,
    private password?: string,
  ) {}

  private url(path: string): string {
    return this.baseUrl.replace(/\/+$/, '') + path
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.username) h.Authorization = 'Basic ' + btoa(`${this.username}:${this.password ?? ''}`)
    return h
  }

  async generateImage(params: ImageGenerateParams, signal?: AbortSignal): Promise<ImageGenerateResult> {
    let res: Response
    try {
      res = await fetch(this.url('/sdapi/v1/txt2img'), {
        method: 'POST',
        headers: this.headers(),
        signal,
        body: JSON.stringify({
          prompt: params.prompt,
          negative_prompt: params.negativePrompt ?? '',
          width: params.width,
          height: params.height,
          steps: params.steps,
          cfg_scale: params.cfgScale,
          seed: params.seed ?? -1,
          sampler_name: params.sampler ?? 'Euler a',
          ...(params.model ? { override_settings: { sd_model_checkpoint: params.model }, override_settings_restore_afterwards: true } : {}),
        }),
      })
    } catch (e) {
      if (signal?.aborted) throw e
      throw new KoboldApiError(`Could not reach Automatic1111 at ${this.baseUrl}. Is it running with --api?`)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new KoboldApiError(`Automatic1111 generation failed (${res.status}): ${text.slice(0, 300)}`, res.status)
    }
    const data = (await res.json()) as { images?: string[]; info?: string }
    const base64 = data.images?.[0] ?? ''
    let seed: number | undefined
    try {
      seed = data.info ? (JSON.parse(data.info) as { seed?: number }).seed : undefined
    } catch {
      // `info` is a JSON-encoded string per the API's own convention — a malformed one just means no reported seed.
    }
    return { base64, seed }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(this.url('/sdapi/v1/sd-models'), { headers: this.headers() })
      if (!res.ok) return []
      const data = (await res.json()) as { title?: string; model_name?: string }[]
      return data.map((m) => m.title ?? m.model_name ?? '').filter(Boolean)
    } catch {
      return []
    }
  }
}
