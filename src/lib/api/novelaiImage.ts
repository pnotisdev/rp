import { KoboldApiError } from './types'
import { extractFirstFileFromZip, uint8ArrayToBase64 } from './binaryUtils'
import type { ImageBackend, ImageGenerateParams, ImageGenerateResult } from './imageBackend'

/** NovelAI's current image models — no confirmed introspection endpoint, so this is a fixed, best-effort list rather than a guessed-at one; lower confidence than the text-model ids in `chatBackend.ts`, which came from a currently-shipping SillyTavern source. */
export const NOVELAI_IMAGE_MODELS = ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-full', 'nai-diffusion-3']

/**
 * NovelAI's hosted image generation (`/ai/generate-image`) — same account/subscription and
 * `Authorization: Bearer` scheme as `novelai.ts`'s text backend, but a genuinely different
 * response shape: the endpoint returns a ZIP archive (one PNG inside), not a plain image or a JSON
 * payload — see `extractFirstFileFromZip` for how that's handled without adding a zip dependency.
 * Never run against a real account; built to the contract as described across multiple independent
 * sources, none of which this session could cross-check live.
 */
export class NovelAIImageClient implements ImageBackend {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` }
  }

  async generateImage(params: ImageGenerateParams, signal?: AbortSignal): Promise<ImageGenerateResult> {
    const seed = params.seed ?? Math.floor(Math.random() * 4_294_967_295)
    let res: Response
    try {
      res = await fetch('https://image.novelai.net/ai/generate-image', {
        method: 'POST',
        headers: this.headers(),
        signal,
        body: JSON.stringify({
          input: params.prompt,
          model: this.model,
          action: 'generate',
          parameters: {
            width: params.width,
            height: params.height,
            scale: params.cfgScale,
            sampler: params.sampler ?? 'k_euler',
            steps: params.steps,
            seed,
            n_samples: 1,
            negative_prompt: params.negativePrompt ?? '',
            qualityToggle: false,
          },
        }),
      })
    } catch (e) {
      if (signal?.aborted) throw e
      throw new KoboldApiError('Could not reach NovelAI for image generation.')
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new KoboldApiError(`NovelAI image generation failed (${res.status}): ${text.slice(0, 300)}`, res.status)
    }
    const zipBytes = await res.arrayBuffer()
    const pngBytes = await extractFirstFileFromZip(zipBytes)
    return { base64: uint8ArrayToBase64(pngBytes), seed }
  }

  async listModels(): Promise<string[]> {
    return [...NOVELAI_IMAGE_MODELS]
  }
}
