import { afterEach, describe, expect, it, vi } from 'vitest'
import { embedTexts, embeddingsUrl } from './embeddings'

const cfg = { baseUrl: 'http://localhost:5001', apiKey: '', model: '' }

const reply = (data: unknown, ok = true, status = 200) => ({ ok, status, json: async () => data, text: async () => JSON.stringify(data) }) as Response

afterEach(() => vi.unstubAllGlobals())

describe('embeddingsUrl', () => {
  it('adds /v1/embeddings, or just /embeddings after a /v1', () => {
    expect(embeddingsUrl('http://localhost:5001')).toBe('http://localhost:5001/v1/embeddings')
    expect(embeddingsUrl('http://localhost:5001/')).toBe('http://localhost:5001/v1/embeddings')
    expect(embeddingsUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/embeddings')
  })
})

describe('embedTexts', () => {
  it('returns one vector per text, in the server\'s index order', async () => {
    const fetchMock = vi.fn(async () => reply({ data: [{ index: 1, embedding: [2, 2] }, { index: 0, embedding: [1, 1] }] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await embedTexts(cfg, ['a', 'b'])).toEqual([[1, 1], [2, 2]])
  })

  it('sends the key and model when set, and nothing when not', async () => {
    const fetchMock = vi.fn(async () => reply({ data: [{ index: 0, embedding: [1] }] }))
    vi.stubGlobal('fetch', fetchMock)
    await embedTexts({ baseUrl: 'http://x', apiKey: 'sk-1', model: 'nomic' }, ['a'])
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-1')
    expect(JSON.parse(init.body as string)).toEqual({ input: ['a'], model: 'nomic' })
    await embedTexts(cfg, ['a'])
    const [, bare] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(JSON.parse(bare.body as string)).toEqual({ input: ['a'] })
    expect(bare.headers).not.toHaveProperty('Authorization')
  })

  it('sends long lists in batches', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const n = (JSON.parse(init.body as string).input as string[]).length
      return reply({ data: Array.from({ length: n }, (_, i) => ({ index: i, embedding: [i + 1] })) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await embedTexts(cfg, Array.from({ length: 40 }, (_, i) => `t${i}`))
    expect(out).toHaveLength(40)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('says what went wrong', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'no model' }, false, 501)))
    await expect(embedTexts(cfg, ['a'])).rejects.toThrow(/answered 501/)
    vi.stubGlobal('fetch', vi.fn(async () => reply({ data: [] })))
    await expect(embedTexts(cfg, ['a'])).rejects.toThrow(/one vector per text/)
    await expect(embedTexts({ ...cfg, baseUrl: '' }, ['a'])).rejects.toThrow(/Set an embeddings server/)
  })
})
