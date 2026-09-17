import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { availableMediaModel, generateOpenMayhemMedia, openMayhemImageBody, openMayhemVoices, speakOpenMayhem } from './openMayhemMedia'
import { loadOpenMayhemModels, type OpenMayhemModel } from './openMayhem'
import { createImageBackend } from './createImageBackend'

const image: OpenMayhemModel = { id: 'image/model', endpoints: ['IMAGES'], providers_available: 1, request_contracts: [
  { endpoint: 'IMAGES', required: ['model', 'prompt'], attributes: {
    prompt: { maxLength: 20000 }, width: { minimum: 576, maximum: 2048, multipleOf: 16 }, height: { minimum: 576, maximum: 2048, multipleOf: 16 },
    steps: { default: 9, minimum: 7, maximum: 9 }, cfg_scale: { default: 0 }, n: { maximum: 4, minimum: 1 }, seed: { minimum: 0, maximum: 4294967295 },
  } },
] }
const speech: OpenMayhemModel = { id: 'speech/model', endpoints: ['AUDIO_SPEECH'], providers_available: 1, request_contracts: [
  { endpoint: 'AUDIO_SPEECH', required: ['model', 'input', 'voice'], attributes: { input: { maxLength: 10 }, voice: { default: 'default', enumValues: ['default'] }, response_format: { enumValues: ['wav'] } } },
] }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('OpenMayhem media catalog and contracts', () => {
  it('loads every page, discovers new models, deduplicates IDs, and keeps endpoint caches separate', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [image], next_cursor: 'page/+2' }))
      .mockResolvedValueOnce(json({ data: [image, { ...image, id: 'new/image' }] }))
    expect((await loadOpenMayhemModels(true, 'IMAGES')).map((m) => m.id)).toEqual(['image/model', 'new/image'])
    expect(fetchMock.mock.calls[1][0]).toBe('/api/openmayhem/models?endpoint_family=IMAGES&cursor=page%2F%2B2')
    expect(fetchMock.mock.calls.every(([, init]) => !init.headers)).toBe(true)
    fetchMock.mockResolvedValueOnce(json({ data: [speech] }))
    expect((await loadOpenMayhemModels(true, 'AUDIO_SPEECH'))[0].id).toBe('speech/model')
    expect((await loadOpenMayhemModels(false, 'IMAGES'))).toHaveLength(2)
  })
  it('fails a repeated cursor instead of showing a partially synced list', async () => {
    fetchMock.mockImplementation(() => json({ data: [image], next_cursor: 'loop' }))
    await expect(loadOpenMayhemModels(true, 'IMAGES')).rejects.toThrow('cursor')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('rejects offline, stale, and incompatible models before submitting a billed job', async () => {
    for (const model of [{ ...image, providers_available: 0 }, { ...image, availability_stale: true },
      { ...image, request_contracts: [{ ...image.request_contracts![0], required: ['model', 'prompt', 'input_reference'] }] }]) {
      fetchMock.mockResolvedValueOnce(json({ data: [model] }))
        .mockResolvedValueOnce(json({ data: [] }))
      await expect(availableMediaModel('IMAGES', image.id)).rejects.toThrow('no available compatible provider')
    }
    expect(fetchMock.mock.calls.every(([, init]) => !init.method)).toBe(true)
  })
  it('uses hosted defaults and supported dimensions across portrait, background and batch slots', () => {
    const body = openMayhemImageBody(image, { prompt: 'lighthouse', width: 768, height: 512, steps: 28, cfgScale: 7, seed: 42 })
    expect(body).toEqual({ model: image.id, prompt: 'lighthouse', width: 864, height: 576, steps: 9, cfg_scale: 0, n: 1, seed: 42 })
    expect(() => openMayhemImageBody(image, { prompt: 'x', width: 832, height: 1216, steps: 28, cfgScale: 7, negativePrompt: 'text' })).toThrow('negative prompt')
  })
  it('derives voices from contracts and rejects stale voices / too-long text without inference', async () => {
    expect(openMayhemVoices(speech)).toEqual(['default'])
    fetchMock.mockImplementation(() => json({ data: [speech] }))
    await expect(speakOpenMayhem('key', speech.id, 'Hello', 'alloy')).rejects.toThrow('voice')
    await expect(speakOpenMayhem('key', speech.id, 'long text beyond limit', '')).rejects.toThrow('text length')
    expect(fetchMock.mock.calls.every(([, init]) => !init.method)).toBe(true)
  })
  it('preserves fractional guidance defaults on future image models', () => {
    const fractional = { ...image, request_contracts: [{ ...image.request_contracts![0], attributes: {
      ...image.request_contracts![0].attributes, cfg_scale: { default: 7.5, minimum: 0, maximum: 20 },
    } }] }
    expect(openMayhemImageBody(fractional, { prompt: 'x', width: 832, height: 1216, steps: 28, cfgScale: 7 }).cfg_scale).toBe(7.5)
  })
})

describe('OpenMayhem async media lifecycle', () => {
  it('submits once, polls and downloads only a fixed owned artifact path, preserving MIME', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(json({ id: 'job_1', status: 'running', polling_url: 'https://untrusted.test' }))
      .mockResolvedValueOnce(json({ id: 'job_1', status: 'completed', artifacts: [{ id: 'artifact_1', contentType: 'image/webp', url: 'https://untrusted.test' }] }))
      .mockResolvedValueOnce(new Response('image bytes', { headers: { 'Content-Type': 'image/webp' } }))
    const pending = generateOpenMayhemMedia('IMAGES', ' key ', { model: image.id })
    await vi.advanceTimersByTimeAsync(1500)
    const blob = await pending
    expect(blob.type).toBe('image/webp')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/openmayhem/images/generations', '/api/openmayhem/jobs/job_1', '/api/openmayhem/artifacts/artifact_1'])
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    expect(fetchMock.mock.calls.every(([, init]) => init.headers.Authorization === 'Bearer key')).toBe(true)
  })
  it.each(['IMAGES', 'WORKFLOWS'] as const)('recovers the ID and cancels %s when Stop arrives during submission', async (endpoint) => {
    const controller = new AbortController()
    fetchMock.mockImplementationOnce(async () => { controller.abort(); return json({ id: 'job_1', status: 'running' }) })
      .mockResolvedValueOnce(json({ status: 'cancelled' }))
    await expect(generateOpenMayhemMedia(endpoint, 'key', {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock.mock.calls[1]).toEqual(['/api/openmayhem/jobs/job_1', expect.objectContaining({ method: 'DELETE' })])
  })
  it('surfaces failed cancellation rather than promising the job stopped', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementationOnce(async () => { controller.abort(); return json({ id: 'job_1', status: 'running' }) })
      .mockResolvedValueOnce(json({ error: { message: 'Unavailable' } }, 503))
    await expect(generateOpenMayhemMedia('IMAGES', 'key', {}, controller.signal)).rejects.toThrow('Could not confirm cancellation')
  })
  it('does not retry auth, credit, capacity errors or terminal failures', async () => {
    for (const status of [401, 402, 429, 503]) {
      fetchMock.mockResolvedValueOnce(json({ error: { message: 'No capacity or credit' } }, status))
      await expect(generateOpenMayhemMedia('AUDIO_SPEECH', 'key', {})).rejects.toThrow(`(${status})`)
    }
    fetchMock.mockResolvedValueOnce(json({ id: 'job_1', status: 'failed', error: 'Provider failed after partial work' }))
    await expect(generateOpenMayhemMedia('IMAGES', 'key', {})).rejects.toThrow('Provider failed')
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
  it('does not retry a submission whose outcome is unknown after a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Connection reset'))
    await expect(generateOpenMayhemMedia('IMAGES', 'key', {})).rejects.toThrow('submission status is unknown')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('cancels an in-progress job when its polling request is aborted', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    fetchMock.mockResolvedValueOnce(json({ id: 'job_1', status: 'running' }))
      .mockImplementationOnce(async () => { controller.abort(); throw controller.signal.reason })
      .mockResolvedValueOnce(json({ status: 'cancelled' }))
    const result = generateOpenMayhemMedia('IMAGES', 'key', {}, controller.signal).catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(1500)
    expect(await result).toMatchObject({ name: 'AbortError' })
    expect(fetchMock.mock.calls[2][1].method).toBe('DELETE')
  })
  it('rejects a completed job with missing/wrong media', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'job_1', status: 'completed', artifacts: [] }))
    await expect(generateOpenMayhemMedia('IMAGES', 'key', {})).rejects.toThrow('without a usable media artifact')
    fetchMock.mockResolvedValueOnce(json({ id: 'job_2', status: 'completed', artifacts: [{ id: 'a', contentType: 'audio/wav' }] }))
      .mockResolvedValueOnce(new Response('<html>error</html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(generateOpenMayhemMedia('AUDIO_SPEECH', 'key', {})).rejects.toThrow('invalid media data')
  })
  it('uses the dedicated key in the shared image factory and defaults the speech voice', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [image] }))
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ id: 'job', status: 'completed', artifacts: [{ id: 'a', contentType: 'image/png' }] }))
      .mockResolvedValueOnce(new Response('png', { headers: { 'Content-Type': 'image/png' } }))
    const backend = createImageBackend({ imageBackend: 'openmayhem', imageBackendModel: image.id, imageBackendBaseUrl: 'https://wrong.test', imageBackendUsername: 'wrong-key', imageBackendPassword: '', openMayhemApiKey: 'media-key' })
    const result = await backend.generateImage({ prompt: 'x', width: 832, height: 1216, steps: 28, cfgScale: 7 })
    expect(result.mimeType).toBe('image/png')
    expect(atob(result.base64)).toBe('png')
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer media-key')
    fetchMock.mockResolvedValueOnce(json({ data: [speech] }))
      .mockResolvedValueOnce(json({ id: 'job', status: 'completed', artifacts: [{ id: 'a', contentType: 'audio/wav' }] }))
      .mockResolvedValueOnce(new Response('wav', { headers: { 'Content-Type': 'audio/wav' } }))
    await speakOpenMayhem('media-key', speech.id, 'Hello', '')
    expect(JSON.parse(fetchMock.mock.calls[5][1].body)).toEqual({ model: speech.id, input: 'Hello', voice: 'default', response_format: 'wav' })
  })
})
