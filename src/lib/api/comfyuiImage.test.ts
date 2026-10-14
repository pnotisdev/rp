import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComfyUIClient, describeComfyError } from './comfyuiImage'
import { DEFAULT_COMFY_CONFIG } from './comfyWorkflow'
import { KoboldApiError } from './types'
import type { ImageGenerateParams } from './imageBackend'

const BASE_PARAMS: ImageGenerateParams = { prompt: 'a cat', negativePrompt: 'blurry', width: 512, height: 768, steps: 20, cfgScale: 7 }
const BASE = 'http://127.0.0.1:8188'

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response
}

/** The path ComfyUI would see, decoded from the relay URL. */
function comfyPath(url: string): string {
  const u = new URL(url, 'http://app')
  expect(u.pathname).toBe('/api/comfy/proxy')
  expect(u.searchParams.get('base')).toBe(BASE)
  return u.searchParams.get('path')!
}

afterEach(() => vi.unstubAllGlobals())

describe('ComfyUIClient', () => {
  it('queues the workflow with params substituted in, and fetches the resulting image, all through the relay', async () => {
    const promptId = 'abc-123'
    const filename = 'rp_00001.png'
    const imageBytes = new Uint8Array([137, 80, 78, 71])

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = comfyPath(url)
      if (path === '/prompt') {
        const body = JSON.parse(init!.body as string)
        expect(body.prompt['3'].class_type).toBe('KSampler')
        expect(body.prompt['3'].inputs).toMatchObject({ steps: 20, cfg: 7 })
        expect(body.prompt['5'].inputs).toMatchObject({ width: 512, height: 768 })
        expect(body.prompt['6'].inputs.text).toBe('a cat')
        expect(body.prompt['7'].inputs.text).toBe('blurry')
        return jsonResponse(200, { prompt_id: promptId })
      }
      if (path === `/history/${promptId}`) {
        return jsonResponse(200, { [promptId]: { outputs: { '8': { images: [{ filename: 'tmp.png', subfolder: '', type: 'temp' }] }, '9': { images: [{ filename, subfolder: '', type: 'output' }] } } } })
      }
      if (path.startsWith('/view')) {
        expect(path).toContain(`filename=${filename}`)
        return { ok: true, arrayBuffer: async () => imageBytes.buffer } as unknown as Response
      }
      throw new Error(`unexpected path ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new ComfyUIClient(BASE).generateImage(BASE_PARAMS)
    expect(result.base64.length).toBeGreaterThan(0)
    expect(typeof result.seed).toBe('number')
  })

  it('uses the split-loader graph for the DiT preset and the user workflow for custom', async () => {
    const sent: Record<string, { class_type: string }>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (comfyPath(url) === '/prompt') sent.push(JSON.parse(init!.body as string).prompt)
        return jsonResponse(400, { error: { message: 'stop here' } })
      }),
    )
    await expect(new ComfyUIClient(BASE, { ...DEFAULT_COMFY_CONFIG, preset: 'dit', unet: 'u', clip: 'c', vae: 'v' }).generateImage(BASE_PARAMS)).rejects.toThrow('stop here')
    expect(sent[0]['1'].class_type).toBe('UNETLoader')
    const custom = JSON.stringify({ '1': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } }, '2': { class_type: 'SaveImage', inputs: {} } })
    await expect(new ComfyUIClient(BASE, { ...DEFAULT_COMFY_CONFIG, preset: 'custom', workflow: custom }).generateImage(BASE_PARAMS)).rejects.toThrow('stop here')
    expect(sent[1]['1'].class_type).toBe('CLIPTextEncode')
  })

  it('uses the first checkpoint ComfyUI has when none is chosen, and the chosen one otherwise', async () => {
    const sent: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = comfyPath(url)
        if (path.startsWith('/object_info')) return jsonResponse(200, { CheckpointLoaderSimple: { input: { required: { ckpt_name: [['first.safetensors', 'second.safetensors']] } } } })
        if (path === '/prompt') sent.push(JSON.parse(init!.body as string).prompt['4'].inputs.ckpt_name)
        return jsonResponse(400, { error: { message: 'stop here' } })
      }),
    )
    const client = new ComfyUIClient(BASE)
    await expect(client.generateImage(BASE_PARAMS)).rejects.toThrow('stop here')
    await expect(client.generateImage({ ...BASE_PARAMS, model: 'second.safetensors' })).rejects.toThrow('stop here')
    expect(sent).toEqual(['first.safetensors', 'second.safetensors'])
  })

  it('reports workflow problems before queueing anything', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(new ComfyUIClient(BASE, { ...DEFAULT_COMFY_CONFIG, preset: 'dit' }).generateImage(BASE_PARAMS)).rejects.toThrow('Choose the diffusion model')
    await expect(new ComfyUIClient(BASE, { ...DEFAULT_COMFY_CONFIG, preset: 'custom', workflow: '{' }).generateImage(BASE_PARAMS)).rejects.toThrow('not valid JSON')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('explains a rejected workflow using the node errors', async () => {
    const body = { error: { message: 'Prompt outputs failed validation' }, node_errors: { '4': { class_type: 'CheckpointLoaderSimple', errors: [{ message: 'Value not in list', details: "ckpt_name: 'x.safetensors' not in [...]" }] } } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, body)))
    const err = await new ComfyUIClient(BASE).generateImage(BASE_PARAMS).catch((e) => e)
    expect(err).toBeInstanceOf(KoboldApiError)
    expect(err.message).toContain('CheckpointLoaderSimple #4: Value not in list')
    expect(describeComfyError(null)).toBe('no details')
  })

  it('says ComfyUI is down when the relay answers 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(502, { error: 'unreachable' })))
    await expect(new ComfyUIClient(BASE).generateImage(BASE_PARAMS)).rejects.toThrow('Could not reach ComfyUI')
    expect((await new ComfyUIClient(BASE).check()).detail).toContain('Is it running')
  })

  it('surfaces an execution error from the history instead of waiting forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = comfyPath(url)
        if (path === '/prompt') return jsonResponse(200, { prompt_id: 'p' })
        return jsonResponse(200, { p: { status: { status_str: 'error', messages: [['execution_error', { node_type: 'KSampler', exception_message: 'CUDA out of memory' }]] }, outputs: {} } })
      }),
    )
    await expect(new ComfyUIClient(BASE).generateImage(BASE_PARAMS)).rejects.toThrow('KSampler): CUDA out of memory')
  })

  it('respects an aborted signal instead of polling forever, and asks ComfyUI to stop', async () => {
    const controller = new AbortController()
    const paths: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = comfyPath(url)
        paths.push(path)
        if (path === '/prompt') return jsonResponse(200, { prompt_id: 'x' })
        return jsonResponse(404, {})
      }),
    )
    const promise = new ComfyUIClient(BASE).generateImage(BASE_PARAMS, controller.signal)
    controller.abort()
    await expect(promise).rejects.toThrow()
    await Promise.resolve()
    expect(paths).toContain('/interrupt')
  })

  it('listModels reads checkpoint names from the CheckpointLoaderSimple node schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { CheckpointLoaderSimple: { input: { required: { ckpt_name: [['a.safetensors', 'b.safetensors']] } } } })))
    expect(await new ComfyUIClient(BASE).listModels()).toEqual(['a.safetensors', 'b.safetensors'])
  })

  it('listModels degrades to [] when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')))
    expect(await new ComfyUIClient(BASE).listModels()).toEqual([])
  })

  it('catalog gathers every dropdown from the running ComfyUI', async () => {
    const info: Record<string, unknown> = {
      CheckpointLoaderSimple: { CheckpointLoaderSimple: { input: { required: { ckpt_name: [['m1.safetensors']] } } } },
      UNETLoader: { UNETLoader: { input: { required: { unet_name: [['anima.safetensors']] } } } },
      CLIPLoader: { CLIPLoader: { input: { required: { clip_name: [['qwen.safetensors']], type: [['cosmos', 'flux']] } } } },
      VAELoader: { VAELoader: { input: { required: { vae_name: [['vae.safetensors']] } } } },
      LoraLoader: { LoraLoader: { input: { required: { lora_name: [['style.safetensors']] } } } },
      KSampler: { KSampler: { input: { required: { sampler_name: [['euler', 'dpmpp_2m']], scheduler: [['simple', 'karras']] } } } },
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => jsonResponse(200, info[comfyPath(url).split('/')[2]])))
    expect(await new ComfyUIClient(BASE).catalog()).toEqual({
      checkpoints: ['m1.safetensors'],
      unets: ['anima.safetensors'],
      clips: ['qwen.safetensors'],
      clipTypes: ['cosmos', 'flux'],
      vaes: ['vae.safetensors'],
      loras: ['style.safetensors'],
      samplers: ['euler', 'dpmpp_2m'],
      schedulers: ['simple', 'karras'],
    })
  })

  it('check reports the version and graphics card', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { system: { comfyui_version: '0.3.60' }, devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 2080 Ti', vram_total: 11 * 1024 ** 3 }] })))
    expect(await new ComfyUIClient(BASE).check()).toEqual({ ok: true, detail: 'Connected, ComfyUI 0.3.60, NVIDIA GeForce RTX 2080 Ti (11 GB).' })
  })
})
