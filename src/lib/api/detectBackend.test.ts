import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLocalBackend, listOpenAiModels, fetchOpenAiModelContext } from './detectBackend'

// `detectLocalBackend` probes a URL with a mocked `fetch` and reports which protocol answered —
// KoboldCpp's native API or the OpenAI-compatible /v1 shape. These lock in the probe order and
// URL normalisation, not real server behaviour.

const ok = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body } as Response)
const notFound = (): Response => ({ ok: false, status: 404, json: async () => ({}) } as Response)

/** Route a fake fetch by URL suffix. Any path not listed 404s. */
function routes(map: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    for (const [suffix, body] of Object.entries(map)) {
      if (url.endsWith(suffix)) return ok(body)
    }
    return notFound()
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('detectLocalBackend', () => {
  it('recognises KoboldCpp from /api/v1/model and keeps the bare origin', async () => {
    vi.stubGlobal('fetch', routes({ 'http://localhost:5001/api/v1/model': { result: 'Heimdallr-26B' } }))
    const found = await detectLocalBackend('http://localhost:5001/')
    expect(found).toEqual({ kind: 'koboldcpp', baseUrl: 'http://localhost:5001', model: 'Heimdallr-26B' })
  })

  it('finds KoboldCpp even when the user pasted the /v1 shim URL', async () => {
    vi.stubGlobal('fetch', routes({ 'http://localhost:5001/api/v1/model': { result: 'M' } }))
    const found = await detectLocalBackend('http://localhost:5001/v1')
    expect(found?.kind).toBe('koboldcpp')
    expect(found?.baseUrl).toBe('http://localhost:5001')
  })

  it('recognises an OpenAI-compatible server and normalises to the /v1 root', async () => {
    vi.stubGlobal(
      'fetch',
      routes({ 'http://localhost:1234/v1/models': { data: [{ id: 'qwen' }, { id: 'llama' }] } }),
    )
    const found = await detectLocalBackend('http://localhost:1234')
    expect(found).toEqual({ kind: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', models: ['qwen', 'llama'] })
  })

  it('prefers KoboldCpp when a server answers both (Kobold serves an OpenAI shim too)', async () => {
    vi.stubGlobal(
      'fetch',
      routes({
        'http://localhost:5001/api/v1/model': { result: 'M' },
        'http://localhost:5001/v1/models': { data: [{ id: 'M' }] },
      }),
    )
    expect((await detectLocalBackend('http://localhost:5001'))?.kind).toBe('koboldcpp')
  })

  it('returns null when nothing recognisable answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => notFound()))
    expect(await detectLocalBackend('http://localhost:9999')).toBeNull()
  })

  it('returns null for an empty URL without touching the network', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await detectLocalBackend('   ')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})

describe('listOpenAiModels', () => {
  it('returns ids from /models', async () => {
    vi.stubGlobal('fetch', routes({ '/models': { data: [{ id: 'a' }, { id: 'b' }] } }))
    expect(await listOpenAiModels('https://api.example.com/v1')).toEqual(['a', 'b'])
  })

  it('returns null when /models does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => notFound()))
    expect(await listOpenAiModels('https://api.example.com/v1')).toBeNull()
  })
})

describe('fetchOpenAiModelContext', () => {
  it('reads context_length for the matching model id', async () => {
    vi.stubGlobal(
      'fetch',
      routes({ '/models': { data: [{ id: 'big', context_length: 131072 }, { id: 'small', context_length: 8192 }] } }),
    )
    expect(await fetchOpenAiModelContext('https://x/v1', 'big')).toBe(131072)
  })

  it('falls back through alternate field names (max_model_len)', async () => {
    vi.stubGlobal('fetch', routes({ '/models': { data: [{ id: 'm', max_model_len: 32768 }] } }))
    expect(await fetchOpenAiModelContext('https://x/v1', 'm')).toBe(32768)
  })

  it('returns null when the id is absent or carries no size', async () => {
    vi.stubGlobal('fetch', routes({ '/models': { data: [{ id: 'm' }] } }))
    expect(await fetchOpenAiModelContext('https://x/v1', 'm')).toBeNull()
    expect(await fetchOpenAiModelContext('https://x/v1', 'other')).toBeNull()
  })
})
