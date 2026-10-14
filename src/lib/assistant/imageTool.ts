// The Assistant's picture-making tool: runs on the browser side because the image backend and its keys live in settings.

import { createImageBackend, type ImageBackendSettings } from '@/lib/api/createImageBackend'
import { IMAGE_BACKEND_LABELS } from '@/lib/api/imageBackend'
import { shrinkImage } from '@/lib/images'
import type { AgentTool, ToolCall, ToolResult } from './tools'

export const GENERATE_IMAGE = 'generate_image'

/** Backends that charge per picture ask before every use. */
export function isBilledBackend(s: Pick<ImageBackendSettings, 'imageBackend'>): boolean {
  return s.imageBackend === 'openmayhem' || s.imageBackend === 'novelai-image'
}

/** True when the chosen image backend has what it needs to run. */
export function imageBackendReady(s: ImageBackendSettings): boolean {
  switch (s.imageBackend) {
    case 'openmayhem':
      return !!s.openMayhemApiKey
    case 'novelai-image':
      return !!s.imageBackendUsername.trim()
    default:
      return !!s.imageBackendBaseUrl.trim()
  }
}

export function generateImageTool(s: ImageBackendSettings): AgentTool | null {
  if (!imageBackendReady(s)) return null
  return {
    name: GENERATE_IMAGE,
    title: 'Make a picture',
    description: `Make a picture with the user's image generator (${IMAGE_BACKEND_LABELS[s.imageBackend]}) and look at it. Write the prompt the way that generator likes (tags or a short description). Optionally keep it in the workspace with save_as.`,
    inputSchema: {
      properties: {
        prompt: { type: 'string', description: 'What to draw' },
        negative_prompt: { type: 'string', description: 'What to avoid (optional)' },
        width: { type: 'number', description: 'Pixels, multiple of 64 (default 1024)' },
        height: { type: 'number', description: 'Pixels, multiple of 64 (default 1024)' },
        save_as: { type: 'string', description: 'Workspace path ending in .png, to keep the picture (optional)' },
      },
      required: ['prompt'],
    },
    write: false,
    confirm: isBilledBackend(s),
  }
}

const clampSize = (v: unknown) => Math.max(256, Math.min(1536, Math.round((Number(v) || 1024) / 64) * 64))

/** Generates the picture and returns it for the model (and the user) to see. Keeping it is a separate, approved step done by the caller. */
export async function runGenerateImage(call: ToolCall, settings: ImageBackendSettings, signal?: AbortSignal): Promise<ToolResult> {
  const prompt = typeof call.arguments.prompt === 'string' ? call.arguments.prompt.trim() : ''
  if (!prompt) return { text: 'Give a prompt describing the picture.', isError: true }
  const negative = typeof call.arguments.negative_prompt === 'string' ? call.arguments.negative_prompt.trim() : ''
  const novelai = settings.imageBackend === 'novelai-image'
  try {
    const result = await createImageBackend(settings).generateImage(
      {
        prompt,
        negativePrompt: negative || undefined,
        width: clampSize(call.arguments.width),
        height: clampSize(call.arguments.height),
        steps: 28,
        cfgScale: novelai ? 5 : 7,
        model: settings.imageBackendModel || undefined,
      },
      signal,
    )
    if (!result.base64) return { text: 'The image backend returned no picture.', isError: true }
    const image = await shrinkImage(`data:${result.mimeType || 'image/png'};base64,${result.base64}`)
    return { text: `Made the picture (seed ${result.seed ?? 'unknown'}). It is attached for you to look at.`, isError: false, images: [image] }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    return { text: `The picture could not be made: ${e instanceof Error ? e.message : String(e)}`, isError: true }
  }
}
