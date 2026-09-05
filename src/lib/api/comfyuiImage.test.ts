import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComfyUIClient } from './comfyuiImage'
import { KoboldApiError } from './types'
import type { ImageGenerateParams } from './imageBackend'

const BASE_PARAMS: ImageGenerateParams = { prompt: 'a cat', negativePrompt: 'blurry', width: 512, height: 768, steps: 20, cfgScale: 7 }

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response
}

afterEach(() => vi.unstubAllGlobals())

describe('ComfyUIClient', () => {
  it('queues the official default workflow graph with params substituted in, and fetches the resulting image', async () => {
    const promptId = 'abc-123'
    const filename = 'rp_00001.png'
    const imageBytes = new Uint8Array([137, 80, 78, 71]) // a PNG magic-number prefix stands in for real bytes here

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/prompt')) {
        const body = JSON.parse(init!.body as string)
        // Node "3" is the KSampler in the official default graph — assert the params landed there.
        expect(body.prompt['3'].class_type).toBe('KSampler')
        expect(body.prompt['3'].inputs.steps).toBe(20)
        expect(body.prompt['3'].inputs.cfg).toBe(7)
        expect(body.prompt['5'].inputs.width).toBe(512)
        expect(body.prompt['5'].inputs.height).toBe(768)
        expect(body.prompt['6'].inputs.text).toBe('a cat')
        expect(body.prompt['7'].inputs.text).toBe('blurry')
        return jsonResponse(200, { prompt_id: promptId })
      }
      if (url.includes(`/history/${promptId}`)) {
        return jsonResponse(200, { [promptId]: { outputs: { '9': { images: [{ filename, subfolder: '', type: 'output' }] } } } })
      }
      if (url.includes('/view')) {
        expect(url).toContain(`filename=${filename}`)
        return { ok: true, arrayBuffer: async () => imageBytes.buffer } as unknown as Response
      }
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new ComfyUIClient('http://127.0.0.1:8188').generateImage(BASE_PARAMS)
    expect(result.base64.length).toBeGreaterThan(0)
    expect(typeof result.seed).toBe('number')
  })

  it('throws a KoboldApiError when the server rejects the workflow', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, { error: 'invalid workflow' })))
    await expect(new ComfyUIClient('http://127.0.0.1:8188').generateImage(BASE_PARAMS)).rejects.toThrow(KoboldApiError)
  })

  it('respects an aborted signal instead of polling forever', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/prompt')) return jsonResponse(200, { prompt_id: 'x' })
      throw new Error('should not poll after abort')
    })
    vi.stubGlobal('fetch', fetchMock)
    const promise = new ComfyUIClient('http://127.0.0.1:8188').generateImage(BASE_PARAMS, controller.signal)
    controller.abort()
    await expect(promise).rejects.toThrow()
  })

  it('listModels reads checkpoint names from the CheckpointLoaderSimple node schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { CheckpointLoaderSimple: { input: { required: { ckpt_name: [['a.safetensors', 'b.safetensors']] } } } })),
    )
    expect(await new ComfyUIClient('http://127.0.0.1:8188').listModels()).toEqual(['a.safetensors', 'b.safetensors'])
  })

  it('listModels degrades to [] when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')))
    expect(await new ComfyUIClient('http://127.0.0.1:8188').listModels()).toEqual([])
  })
})
