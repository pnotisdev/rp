import { afterEach, describe, expect, it, vi } from 'vitest'
import { NovelAIImageClient } from './novelaiImage'
import { KoboldApiError } from './types'
import type { ImageGenerateParams } from './imageBackend'

const BASE_PARAMS: ImageGenerateParams = { prompt: 'a cat', width: 512, height: 512, steps: 28, cfgScale: 5 }

/** A minimal single-entry ZIP (stored, uncompressed) — matches how `binaryUtils.test.ts` builds its own fixture. */
function buildStoredZip(data: Uint8Array): ArrayBuffer {
  const filename = new TextEncoder().encode('image_0.png')
  const header = new Uint8Array(30 + filename.length + data.length)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x04034b50, true)
  view.setUint16(8, 0, true)
  view.setUint32(18, data.length, true)
  view.setUint32(22, data.length, true)
  view.setUint16(26, filename.length, true)
  header.set(filename, 30)
  header.set(data, 30 + filename.length)
  return header.buffer
}

afterEach(() => vi.unstubAllGlobals())

describe('NovelAIImageClient', () => {
  it('sends the documented request shape and unzips the response into base64', async () => {
    const pngBytes = new Uint8Array([1, 2, 3, 4, 5])
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://image.novelai.net/ai/generate-image')
      const body = JSON.parse(init!.body as string)
      expect(body.input).toBe('a cat')
      expect(body.model).toBe('nai-diffusion-4-5-full')
      expect(body.action).toBe('generate')
      expect(body.parameters.width).toBe(512)
      expect(body.parameters.scale).toBe(5)
      expect(body.parameters.steps).toBe(28)
      expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-nai-test')
      return { ok: true, status: 200, arrayBuffer: async () => buildStoredZip(pngBytes) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new NovelAIImageClient('sk-nai-test', 'nai-diffusion-4-5-full').generateImage(BASE_PARAMS)
    const decoded = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0))
    expect(Array.from(decoded)).toEqual(Array.from(pngBytes));
  })

  it('reports the seed actually used, generating one when the caller did not supply it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => buildStoredZip(new Uint8Array([9])) }) as unknown as Response))
    const result = await new NovelAIImageClient('sk-nai-test', 'nai-diffusion-4-5-full').generateImage(BASE_PARAMS)
    expect(typeof result.seed).toBe('number')

    const result2 = await new NovelAIImageClient('sk-nai-test', 'nai-diffusion-4-5-full').generateImage({ ...BASE_PARAMS, seed: 777 })
    expect(result2.seed).toBe(777)
  })

  it('throws a KoboldApiError on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 402, text: async () => 'Payment required' } as unknown as Response))
    await expect(new NovelAIImageClient('sk-nai-test', 'nai-diffusion-4-5-full').generateImage(BASE_PARAMS)).rejects.toThrow(KoboldApiError)
  })

  it('listModels returns the fixed known-model list', async () => {
    const models = await new NovelAIImageClient('sk-nai-test', 'nai-diffusion-4-5-full').listModels()
    expect(models.length).toBeGreaterThan(0)
    expect(models).toContain('nai-diffusion-4-5-full')
  })
})
