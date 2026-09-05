import { A1111Client } from './a1111Image'
import { ComfyUIClient } from './comfyuiImage'
import { SwarmUIClient } from './swarmuiImage'
import { NovelAIImageClient } from './novelaiImage'
import type { ImageBackend, ImageBackendId } from './imageBackend'

export interface ImageBackendSettings {
  imageBackend: ImageBackendId
  /** a1111 / comfyui / swarmui only. */
  imageBackendBaseUrl: string
  /** a1111's optional --api-auth username; novelai's API key. */
  imageBackendUsername: string
  /** a1111's optional --api-auth password. */
  imageBackendPassword: string
  imageBackendModel: string
}

/** Section 11's image-backend factory — the `createChatBackend` pattern applied to image generation. */
export function createImageBackend(settings: ImageBackendSettings): ImageBackend {
  switch (settings.imageBackend) {
    case 'comfyui':
      return new ComfyUIClient(settings.imageBackendBaseUrl)
    case 'swarmui':
      return new SwarmUIClient(settings.imageBackendBaseUrl)
    case 'novelai-image':
      return new NovelAIImageClient(settings.imageBackendUsername, settings.imageBackendModel)
    case 'a1111':
    default:
      return new A1111Client(settings.imageBackendBaseUrl, settings.imageBackendUsername || undefined, settings.imageBackendPassword || undefined)
  }
}
