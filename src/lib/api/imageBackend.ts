/** Section 11's "image/asset generation backends" */
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
  mimeType?: string
  /** The seed actually used, when the backend reports it — useful since `params.seed` is often left unset for a random one. */
  seed?: number
}

export interface ImageBackend {
  generateImage(params: ImageGenerateParams, signal?: AbortSignal): Promise<ImageGenerateResult>
  listModels(): Promise<string[]>
}

export type ImageBackendId = 'a1111' | 'comfyui' | 'swarmui' | 'novelai-image' | 'openmayhem'

export const IMAGE_BACKEND_LABELS: Record<ImageBackendId, string> = {
  openmayhem: 'OpenMayhem (hosted)',
  a1111: 'Automatic1111 / Forge (local)',
  comfyui: 'ComfyUI (local)',
  swarmui: 'SwarmUI (local)',
  'novelai-image': 'NovelAI (hosted, subscription)',
}
