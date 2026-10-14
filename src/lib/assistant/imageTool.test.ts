import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateImageTool, imageBackendReady, isBilledBackend, runGenerateImage } from './imageTool'
import type { ImageBackendSettings } from '@/lib/api/createImageBackend'

const settings = (over: Partial<ImageBackendSettings> = {}): ImageBackendSettings => ({ imageBackend: 'comfyui', imageBackendBaseUrl: 'http://127.0.0.1:8188', imageBackendUsername: '', imageBackendPassword: '', imageBackendModel: '', ...over })

afterEach(() => vi.unstubAllGlobals())

describe('generate_image availability', () => {
  it('is offered only when the backend is configured', () => {
    expect(generateImageTool(settings())?.name).toBe('generate_image')
    expect(generateImageTool(settings({ imageBackendBaseUrl: '' }))).toBeNull()
    expect(imageBackendReady(settings({ imageBackend: 'novelai-image', imageBackendUsername: ' ' }))).toBe(false)
    expect(imageBackendReady(settings({ imageBackend: 'novelai-image', imageBackendUsername: 'key' }))).toBe(true)
    expect(imageBackendReady(settings({ imageBackend: 'openmayhem', openMayhemApiKey: 'k' }))).toBe(true)
  })

  it('asks before using a billed backend, never for a local one', () => {
    expect(generateImageTool(settings({ imageBackend: 'novelai-image', imageBackendUsername: 'k' }))?.confirm).toBe(true)
    expect(generateImageTool(settings())?.confirm).toBe(false)
    expect(isBilledBackend({ imageBackend: 'a1111' })).toBe(false)
  })
})

describe('runGenerateImage', () => {
  it('needs a prompt', async () => {
    expect((await runGenerateImage({ name: 'generate_image', arguments: {} }, settings())).isError).toBe(true)
  })

  it('turns a backend failure into an error result the model can read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}), text: async () => '' } as unknown as Response))
    const out = await runGenerateImage({ name: 'generate_image', arguments: { prompt: 'a cat' } }, settings())
    expect(out.isError).toBe(true)
    expect(out.text).toContain('could not be made')
  })

  it('sends the size clamped to a multiple of 64 and returns the picture', async () => {
    const sent: any[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url, 'http://app').searchParams.get('path') ?? ''
        if (path === '/prompt') {
          sent.push(JSON.parse(init!.body as string).prompt)
          return { ok: true, status: 200, json: async () => ({ prompt_id: 'p' }) } as unknown as Response
        }
        if (path.startsWith('/history')) return { ok: true, status: 200, json: async () => ({ p: { outputs: { 9: { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } }) } as unknown as Response
        return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer } as unknown as Response
      }),
    )
    const out = await runGenerateImage({ name: 'generate_image', arguments: { prompt: 'a cat', width: 700, height: 99999 } }, settings({ imageBackendModel: 'm.safetensors' }))
    expect(out.isError).toBe(false)
    expect(out.images?.[0]).toMatch(/^data:image\/png;base64,/)
    expect(sent[0]['5'].inputs).toMatchObject({ width: 704, height: 1536 })
  })
})
