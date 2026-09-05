import { afterEach, describe, expect, it, vi } from 'vitest'
import { NovelAIClient } from './novelai'
import { KoboldApiError } from './types'
import type { GenerateRequest } from './types'
import type { ChatBackend } from './chatBackend'

/**
 * Mocked against the documented/reverse-engineered contract (see novelai.ts's own header comment)
 * — this session never had a real NovelAI account to verify against. `fetch` is mocked for BOTH
 * destinations this client calls: the local `/api/novelai/tokenize` endpoint (real, tested
 * separately and thoroughly in `server/novelaiTokenizer.test.ts` against the actual bundled model
 * files) and NovelAI's own hosted API (necessarily mocked here, since it can't be reached at all
 * without a subscription).
 */

const BASE_REQUEST: GenerateRequest = {
  prompt: 'Once upon a time,',
  max_length: 150,
  max_context_length: 4096,
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response
}

function sseResponse(rawEvents: string): Response {
  const encoder = new TextEncoder()
  let sent = false
  const reader = {
    read: async () => {
      if (sent) return { done: true, value: undefined }
      sent = true
      return { done: false, value: encoder.encode(rawEvents) }
    },
  }
  return { ok: true, status: 200, body: { getReader: () => reader }, text: async () => '' } as unknown as Response
}

/** Routes a mocked fetch by URL: the local tokenizer vs. NovelAI's own generate endpoints. */
function routedFetchMock(opts: {
  tokenizeIds?: number[]
  generate?: () => Response
  generateStream?: () => Response
}) {
  return vi.fn(async (url: string, _init: RequestInit) => {
    if (url.includes('/api/novelai/tokenize')) {
      return jsonResponse(200, { ids: opts.tokenizeIds ?? [1, 2, 3] })
    }
    if (url.includes('/ai/generate-stream')) return opts.generateStream?.() ?? jsonResponse(200, {})
    if (url.includes('/ai/generate')) return opts.generate?.() ?? jsonResponse(200, { output: '' })
    throw new Error(`Unexpected URL in test: ${url}`)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NovelAIClient — request building', () => {
  it('sends the prompt as plain text with use_string: true (not tokenized)', async () => {
    const fetchMock = routedFetchMock({ generate: () => jsonResponse(200, { output: 'hi' }) })
    vi.stubGlobal('fetch', fetchMock)

    const client = new NovelAIClient('sk-test', 'kayra-v1')
    await client.generate(BASE_REQUEST)

    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/ai/generate') && !String(c[0]).includes('stream'))
    const body = JSON.parse(call![1].body as string)
    expect(body.input).toBe('Once upon a time,')
    expect(body.model).toBe('kayra-v1')
    expect(body.parameters.use_string).toBe(true)
  })

  it('routes Kayra to text.novelai.net and Clio to api.novelai.net', async () => {
    const fetchMock = routedFetchMock({ generate: () => jsonResponse(200, { output: 'hi' }) })
    vi.stubGlobal('fetch', fetchMock)

    await new NovelAIClient('sk-test', 'kayra-v1').generate(BASE_REQUEST)
    await new NovelAIClient('sk-test', 'clio-v1').generate(BASE_REQUEST)

    const urls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/ai/generate') && !u.includes('stream'))
    expect(urls[0]).toBe('https://text.novelai.net/ai/generate')
    expect(urls[1]).toBe('https://api.novelai.net/ai/generate')
  })

  it('sends a Bearer Authorization header', async () => {
    const fetchMock = routedFetchMock({ generate: () => jsonResponse(200, { output: 'hi' }) })
    vi.stubGlobal('fetch', fetchMock)
    await new NovelAIClient('my-real-key', 'kayra-v1').generate(BASE_REQUEST)
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/ai/generate'))
    expect((call![1].headers as Record<string, string>).Authorization).toBe('Bearer my-real-key')
  })

  it('maps this app’s GenerationParams fields onto NovelAI’s own parameter names', async () => {
    const fetchMock = routedFetchMock({ generate: () => jsonResponse(200, { output: 'hi' }) })
    vi.stubGlobal('fetch', fetchMock)
    await new NovelAIClient('sk-test', 'kayra-v1').generate({
      ...BASE_REQUEST,
      temperature: 1.35,
      top_p: 0.9,
      top_k: 40,
      top_a: 0.02,
      min_p: 0.05,
      typical: 0.98,
      tfs: 0.95,
      rep_pen: 2.5,
      rep_pen_range: 2048,
      rep_pen_slope: 0.2,
      presence_penalty: 0.1,
      mirostat_tau: 5,
      mirostat_eta: 0.1,
    })
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/ai/generate'))
    const { parameters } = JSON.parse(call![1].body as string)
    expect(parameters.temperature).toBe(1.35)
    expect(parameters.top_p).toBe(0.9)
    expect(parameters.top_k).toBe(40)
    expect(parameters.top_a).toBe(0.02)
    expect(parameters.min_p).toBe(0.05)
    expect(parameters.typical_p).toBe(0.98)
    expect(parameters.tail_free_sampling).toBe(0.95)
    expect(parameters.repetition_penalty).toBe(2.5)
    expect(parameters.repetition_penalty_range).toBe(2048)
    expect(parameters.repetition_penalty_slope).toBe(0.2)
    expect(parameters.repetition_penalty_presence).toBe(0.1)
    expect(parameters.mirostat_tau).toBe(5)
    expect(parameters.mirostat_lr).toBe(0.1)
  })

  it('tokenizes stop sequences via the local server into arrays of token ids', async () => {
    const fetchMock = routedFetchMock({ tokenizeIds: [42, 43], generate: () => jsonResponse(200, { output: 'hi' }) })
    vi.stubGlobal('fetch', fetchMock)
    await new NovelAIClient('sk-test', 'kayra-v1').generate({ ...BASE_REQUEST, stop_sequence: ['\nYou:', '\nSumire:'] })

    const tokenizeCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/novelai/tokenize'))
    expect(tokenizeCalls).toHaveLength(2)
    const generateCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/ai/generate'))
    const { parameters } = JSON.parse(generateCall![1].body as string)
    expect(parameters.stop_sequences).toEqual([
      [42, 43],
      [42, 43],
    ])
  })

  it('omits stop_sequences entirely when tokenization is unreachable, rather than failing the generation', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/novelai/tokenize')) throw new TypeError('network error')
      return jsonResponse(200, { output: 'hi' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const text = await new NovelAIClient('sk-test', 'kayra-v1').generate({ ...BASE_REQUEST, stop_sequence: ['\nYou:'] })
    expect(text).toBe('hi')
  })
})

describe('NovelAIClient — generate()', () => {
  it('extracts the "output" field from a successful response', async () => {
    const fetchMock = routedFetchMock({ generate: () => jsonResponse(200, { output: 'A story begins.' }) })
    vi.stubGlobal('fetch', fetchMock)
    const text = await new NovelAIClient('sk-test', 'kayra-v1').generate(BASE_REQUEST)
    expect(text).toBe('A story begins.')
  })

  it('throws a KoboldApiError on a non-2xx response', async () => {
    const fetchMock = routedFetchMock({ generate: () => jsonResponse(401, { message: 'Invalid key' }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(new NovelAIClient('bad-key', 'kayra-v1').generate(BASE_REQUEST)).rejects.toThrow(KoboldApiError)
  })

  it('rethrows the original error when the caller aborted', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('Aborted', 'AbortError')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('tokenize')) return jsonResponse(200, { ids: [] })
        throw abortError
      }),
    )
    controller.abort()
    await expect(new NovelAIClient('sk-test', 'kayra-v1').generate(BASE_REQUEST, controller.signal)).rejects.toBe(abortError)
  })
})

describe('NovelAIClient — generateStream()', () => {
  it('parses {token} events and accumulates the full text', async () => {
    const events = [`data: ${JSON.stringify({ token: 'Once ' })}`, `data: ${JSON.stringify({ token: 'upon a time.' })}`]
      .map((e) => e + '\n\n')
      .join('')
    const fetchMock = routedFetchMock({ generateStream: () => sseResponse(events) })
    vi.stubGlobal('fetch', fetchMock)

    const tokens: string[] = []
    const full = await new NovelAIClient('sk-test', 'kayra-v1').generateStream(BASE_REQUEST, (t) => tokens.push(t))
    expect(tokens).toEqual(['Once ', 'upon a time.'])
    expect(full).toBe('Once upon a time.')
  })

  it('falls back to the non-streaming endpoint when the stream produces zero tokens', async () => {
    const fetchMock = routedFetchMock({
      generateStream: () => sseResponse(''), // no events at all — the "wrong field name" failure mode this guards against
      generate: () => jsonResponse(200, { output: 'fallback text' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const full = await new NovelAIClient('sk-test', 'kayra-v1').generateStream(BASE_REQUEST, () => {})
    expect(full).toBe('fallback text')
    const generateCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/ai/generate') && !String(c[0]).includes('stream'))
    expect(generateCalls).toHaveLength(1)
  })

  it('does not fall back when the caller aborted (empty is expected, not a failure)', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('tokenize')) return jsonResponse(200, { ids: [] })
      throw new DOMException('Aborted', 'AbortError')
    })
    vi.stubGlobal('fetch', fetchMock)
    controller.abort()
    const full = await new NovelAIClient('sk-test', 'kayra-v1').generateStream(BASE_REQUEST, () => {}, controller.signal)
    expect(full).toBe('')
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/ai/generate') && !String(c[0]).includes('stream'))).toHaveLength(0)
  })
})

describe('NovelAIClient — fallback surface', () => {
  it('getEffectiveMaxContext returns the caller-supplied fallback', async () => {
    const client = new NovelAIClient('sk-test', 'kayra-v1')
    expect(await client.getEffectiveMaxContext(8192)).toBe(8192)
    expect(await client.getEffectiveMaxContext()).toBe(4096)
  })

  it('tokenCount uses the real local tokenizer when reachable', async () => {
    vi.stubGlobal('fetch', routedFetchMock({ tokenizeIds: [1, 2, 3, 4, 5] }))
    const { count } = await new NovelAIClient('sk-test', 'kayra-v1').tokenCount('some text')
    expect(count).toBe(5)
  })

  it('tokenCount falls back to the character estimate when the local tokenizer is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network error')
      }),
    )
    const { count } = await new NovelAIClient('sk-test', 'kayra-v1').tokenCount('twelve characters here')
    expect(count).toBe(Math.ceil('twelve characters here'.length / 4))
  })

  it('abort() resolves without making any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // Typed as the shared interface, not the concrete class — see the identical note in
    // openaiCompatible.test.ts.
    const client: ChatBackend = new NovelAIClient('sk-test', 'kayra-v1')
    await expect(client.abort('genkey')).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('getChatTemplate always returns null', async () => {
    expect(await new NovelAIClient('sk-test', 'kayra-v1').getChatTemplate()).toBeNull()
  })
})

// Settings → Connection's "does this actually work" check (also the header status dot for this
// backend) — hits the same endpoint SillyTavern's own current backend uses to verify a key
// (GET /user/subscription), never a real generation, so it costs no subscription quota.
describe('checkConnection', () => {
  it('treats a 200 from /user/subscription as ok, with the right auth header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { tier: 3, active: true }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await new NovelAIClient('sk-real', 'kayra-v1').checkConnection()
    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('https://api.novelai.net/user/subscription', expect.objectContaining({ headers: expect.any(Object) }))
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-real')
  })

  it('reports a rejected key distinctly on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})))
    const result = await new NovelAIClient('sk-bad', 'kayra-v1').checkConnection()
    expect(result).toEqual({ ok: false, detail: 'The API key was rejected.' })
  })

  it('reports unreachable (not a key problem) when the fetch itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const result = await new NovelAIClient('sk-real', 'kayra-v1').checkConnection()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Could not reach')
  })

  it('reports a generic error for any other non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})))
    const result = await new NovelAIClient('sk-real', 'kayra-v1').checkConnection()
    expect(result).toEqual({ ok: false, detail: 'Unexpected response (500).' })
  })

  it('refuses to check with no API key set, without making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await new NovelAIClient('', 'kayra-v1').checkConnection()
    expect(result).toEqual({ ok: false, detail: 'No API key set.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
