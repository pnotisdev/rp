import { afterEach, describe, expect, it, vi } from 'vitest'
import { SwarmUIClient } from './swarmuiImage'
import { KoboldApiError } from './types'
import type { ImageGenerateParams } from './imageBackend'

const BASE_PARAMS: ImageGenerateParams = { prompt: 'a cat', width: 512, height: 512, steps: 20, cfgScale: 7 }

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response
}

afterEach(() => vi.unstubAllGlobals())

describe('SwarmUIClient', () => {
  it('fetches a session before generating, then reuses it on a second call', async () => {
    let sessionRequests = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/API/GetNewSession')) {
        sessionRequests++
        return jsonResponse(200, { session_id: 'sess-1' })
      }
      if (url.endsWith('/API/GenerateText2Image')) return jsonResponse(200, { images: ['data:image/png;base64,Zm9v'] })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new SwarmUIClient('http://127.0.0.1:7801')
    await client.generateImage(BASE_PARAMS)
    await client.generateImage(BASE_PARAMS)
    expect(sessionRequests).toBe(1)
  })

  it('sends the documented field names, including negativeprompt/cfgscale', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/API/GetNewSession')) return jsonResponse(200, { session_id: 'sess-1' })
      const body = JSON.parse(init!.body as string)
      expect(body.session_id).toBe('sess-1')
      expect(body.prompt).toBe('a cat')
      expect(body.negativeprompt).toBe('')
      expect(body.width).toBe(512)
      expect(body.cfgscale).toBe(7)
      return jsonResponse(200, { images: ['data:image/png;base64,Zm9v'] })
    })
    vi.stubGlobal('fetch', fetchMock)
    await new SwarmUIClient('http://127.0.0.1:7801').generateImage(BASE_PARAMS)
  })

  it('decodes a data: URI image directly without a follow-up fetch', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/API/GetNewSession')) return jsonResponse(200, { session_id: 'sess-1' })
      return jsonResponse(200, { images: ['data:image/png;base64,aGVsbG8='] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await new SwarmUIClient('http://127.0.0.1:7801').generateImage(BASE_PARAMS)
    expect(result.base64).toBe('aGVsbG8=')
    expect(fetchMock).toHaveBeenCalledTimes(2) // session + generate, no separate image fetch
  })

  it('fetches a file-path image with a follow-up GET', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/API/GetNewSession')) return jsonResponse(200, { session_id: 'sess-1' })
      if (url.endsWith('/API/GenerateText2Image')) return jsonResponse(200, { images: ['View/local/raw/out.png'] })
      if (url.endsWith('/View/local/raw/out.png')) return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as unknown as Response
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await new SwarmUIClient('http://127.0.0.1:7801').generateImage(BASE_PARAMS)
    expect(result.base64.length).toBeGreaterThan(0)
  })

  it('retries exactly once with a fresh session on invalid_session_id', async () => {
    let sessionCount = 0
    let generateCount = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/API/GetNewSession')) {
        sessionCount++
        return jsonResponse(200, { session_id: `sess-${sessionCount}` })
      }
      if (url.endsWith('/API/GenerateText2Image')) {
        generateCount++
        const body = JSON.parse(init!.body as string)
        if (body.session_id === 'sess-1') return jsonResponse(200, { error: 'expired', error_id: 'invalid_session_id' })
        return jsonResponse(200, { images: ['data:image/png;base64,b2s='] })
      }
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await new SwarmUIClient('http://127.0.0.1:7801').generateImage(BASE_PARAMS)
    expect(sessionCount).toBe(2)
    expect(generateCount).toBe(2)
    expect(result.base64).toBe('b2s=')
  })

  it('throws a KoboldApiError on a reported error other than an expired session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/API/GetNewSession')) return jsonResponse(200, { session_id: 'sess-1' })
        return jsonResponse(200, { error: 'model not found' })
      }),
    )
    await expect(new SwarmUIClient('http://127.0.0.1:7801').generateImage(BASE_PARAMS)).rejects.toThrow(KoboldApiError)
  })

  it('listModels returns an empty array (no confirmed endpoint)', async () => {
    expect(await new SwarmUIClient('http://127.0.0.1:7801').listModels()).toEqual([])
  })
})
