/**
 * Section 11's "image/asset generation backends" — the same "one interface, many providers" shape
 * as `ChatBackend`/`ttsProviders.ts`, this time for generating an image into a slot (character
 * avatar, VN sprite, world background, gallery CG) that today only accepts an upload. Deliberately
 * minimal: one call to generate, one to list what models/checkpoints are available (best-effort —
 * a backend with no such introspection, or one that's unreachable, returns an empty list rather
 * than throwing, since the picker just falls back to a free-text field in that case).
 */
export interface ImageGenerateParams {
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  steps: number
  cfgScale: number
  /** Omit (or -1) for a random seed — every backend here treats that the same way. */
  seed?: number
  /** Checkpoint/model name — meaning is backend-specific; omit to use whatever's already loaded. */
  model?: string
  sampler?: string
}

export interface ImageGenerateResult {
  /** Base64-encoded image bytes, no `data:` prefix — callers wrap it into a data URL themselves (matches how `decodeImageDataUrl` on the server already expects one). */
  base64: string
  /** The seed actually used, when the backend reports it — useful since `params.seed` is often left unset for a random one. */
  seed?: number
}

export interface ImageBackend {
  generateImage(params: ImageGenerateParams, signal?: AbortSignal): Promise<ImageGenerateResult>
  listModels(): Promise<string[]>
}

export type ImageBackendId = 'a1111' | 'comfyui' | 'swarmui' | 'novelai-image'

export const IMAGE_BACKEND_LABELS: Record<ImageBackendId, string> = {
  a1111: 'Automatic1111 / Forge (local)',
  comfyui: 'ComfyUI (local)',
  swarmui: 'SwarmUI (local)',
  'novelai-image': 'NovelAI (hosted, subscription)',
}
