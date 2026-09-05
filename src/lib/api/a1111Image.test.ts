import { afterEach, describe, expect, it, vi } from 'vitest'
import { A1111Client } from './a1111Image'
import { KoboldApiError } from './types'
import type { ImageGenerateParams } from './imageBackend'

const BASE_PARAMS: ImageGenerateParams = { prompt: 'a cat', width: 512, height: 512, steps: 20, cfgScale: 7 }

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response
}

afterEach(() => vi.unstubAllGlobals())

describe('A1111Client', () => {
  it('posts to /sdapi/v1/txt2img with the documented field names', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { images: ['base64png'], info: '{"seed": 123}' }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new A1111Client('http://127.0.0.1:7860')
    const result = await client.generateImage({ ...BASE_PARAMS, negativePrompt: 'blurry', seed: 42, sampler: 'DPM++ 2M' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:7860/sdapi/v1/txt2img')
    const body = JSON.parse(init.body as string)
    expect(body.prompt).toBe('a cat')
    expect(body.negative_prompt).toBe('blurry')
    expect(body.width).toBe(512)
    expect(body.height).toBe(512)
    expect(body.steps).toBe(20)
    expect(body.cfg_scale).toBe(7)
    expect(body.seed).toBe(42)
    expect(body.sampler_name).toBe('DPM++ 2M')
    expect(result.base64).toBe('base64png')
    expect(result.seed).toBe(123)
  })

  it('defaults seed to -1 (random) when not specified', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { images: ['x'] }))
    vi.stubGlobal('fetch', fetchMock)
    await new A1111Client('http://127.0.0.1:7860').generateImage(BASE_PARAMS)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.seed).toBe(-1)
  })

  it('sends HTTP Basic auth only when a username is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { images: ['x'] }))
    vi.stubGlobal('fetch', fetchMock)
    await new A1111Client('http://127.0.0.1:7860', 'user', 'pass').generateImage(BASE_PARAMS)
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Authorization).toBe(`Basic ${btoa('user:pass')}`)

    fetchMock.mockClear()
    await new A1111Client('http://127.0.0.1:7860').generateImage(BASE_PARAMS)
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('throws a KoboldApiError on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, { error: 'OOM' })))
    await expect(new A1111Client('http://127.0.0.1:7860').generateImage(BASE_PARAMS)).rejects.toThrow(KoboldApiError)
  })

  it('listModels maps the sd-models response to title strings, and degrades to [] on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, [{ title: 'model-a.safetensors [abc123]' }, { model_name: 'model-b' }])),
    )
    expect(await new A1111Client('http://127.0.0.1:7860').listModels()).toEqual(['model-a.safetensors [abc123]', 'model-b'])

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('network error')),
    )
    expect(await new A1111Client('http://127.0.0.1:7860').listModels()).toEqual([])
  })
})
