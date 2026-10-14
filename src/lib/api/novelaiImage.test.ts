import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildNovelAIImageBody, fitNovelAISize, NovelAIImageClient } from './novelaiImage'
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
  it('sends the request through the local relay and unzips the response into base64', async () => {
    const pngBytes = new Uint8Array([1, 2, 3, 4, 5])
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('/api/novelai/proxy/image/ai/generate-image')
      const body = JSON.parse(init!.body as string)
      expect(body.input).toBe('a cat')
      expect(body.model).toBe('nai-diffusion-4-5-full')
      expect(body.action).toBe('generate')
      expect(body.parameters).toMatchObject({ width: 512, scale: 5, steps: 28 })
      expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-nai-test')
      return { ok: true, status: 200, arrayBuffer: async () => buildStoredZip(pngBytes) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new NovelAIImageClient('sk-nai-test', 'nai-diffusion-4-5-full').generateImage(BASE_PARAMS)
    const decoded = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0))
    expect(Array.from(decoded)).toEqual(Array.from(pngBytes))
  })

  it('reports the seed actually used, generating one when the caller did not supply it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => buildStoredZip(new Uint8Array([9])) }) as unknown as Response))
    const result = await new NovelAIImageClient('sk-nai-test', 'nai-diffusion-4-5-full').generateImage(BASE_PARAMS)
    expect(typeof result.seed).toBe('number')

    const result2 = await new NovelAIImageClient('sk-nai-test', 'nai-diffusion-4-5-full').generateImage({ ...BASE_PARAMS, seed: 777 })
    expect(result2.seed).toBe(777)
  })

  it('explains common failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 402, text: async () => 'Payment required' } as unknown as Response))
    const err = await new NovelAIImageClient('sk', 'nai-diffusion-4-5-full').generateImage(BASE_PARAMS).catch((e) => e)
    expect(err).toBeInstanceOf(KoboldApiError)
    expect(err.message).toContain('subscription or Anlas')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => '' } as unknown as Response))
    await expect(new NovelAIImageClient('sk', 'nai-diffusion-4-5-full').generateImage(BASE_PARAMS)).rejects.toThrow('key was rejected')
  })

  it('asks for a key instead of sending an empty one', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(new NovelAIImageClient('  ', 'nai-diffusion-4-5-full').generateImage(BASE_PARAMS)).rejects.toThrow('API key')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('listModels returns the fixed known-model list', async () => {
    const models = await new NovelAIImageClient('sk-nai-test', 'nai-diffusion-4-5-full').listModels()
    expect(models).toContain('nai-diffusion-4-5-full')
    expect(models).toContain('nai-diffusion-3')
  })
})

describe('request body', () => {
  it('adds the structured V4 prompt for V4 and V4.5 models', () => {
    const body = buildNovelAIImageBody({ ...BASE_PARAMS, negativePrompt: 'blurry' }, 5, 'nai-diffusion-4-5-full') as { input: string; parameters: Record<string, any> }
    expect(body.parameters.params_version).toBe(3)
    expect(body.parameters.v4_prompt).toEqual({ caption: { base_caption: 'a cat', char_captions: [] }, use_coords: false, use_order: true })
    expect(body.parameters.v4_negative_prompt.caption.base_caption).toBe('blurry')
    expect(body.parameters.sampler).toBe('k_euler_ancestral')
    expect(body.parameters.seed).toBe(5)
  })

  it('keeps the plain V3 shape for V3', () => {
    const body = buildNovelAIImageBody(BASE_PARAMS, 1, 'nai-diffusion-3') as { parameters: Record<string, unknown> }
    expect(body.parameters.v4_prompt).toBeUndefined()
    expect(body.parameters.sampler).toBe('k_euler')
  })

  it('maps familiar sampler names', () => {
    const sampler = (s: string) => (buildNovelAIImageBody({ ...BASE_PARAMS, sampler: s }, 1, 'nai-diffusion-3') as { parameters: { sampler: string } }).parameters.sampler
    expect(sampler('dpmpp_2m')).toBe('k_dpmpp_2m')
    expect(sampler('euler a')).toBe('k_euler_ancestral')
    expect(sampler('k_dpmpp_sde')).toBe('k_dpmpp_sde')
    expect(sampler('unheard-of')).toBe('k_euler')
  })

  it('fits sizes to multiples of 64 within one megapixel', () => {
    expect(fitNovelAISize(512, 512)).toEqual({ width: 512, height: 512 })
    expect(fitNovelAISize(832, 1216)).toEqual({ width: 832, height: 1216 })
    expect(fitNovelAISize(500, 700)).toEqual({ width: 512, height: 704 })
    const big = fitNovelAISize(2048, 2048)
    expect(big.width * big.height).toBeLessThanOrEqual(1_048_576)
    expect(big.width % 64).toBe(0)
  })
})
