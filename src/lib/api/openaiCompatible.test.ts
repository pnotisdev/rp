import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleClient } from './openaiCompatible'
import { KoboldApiError } from './types'
import type { GenerateRequest } from './types'
import type { ChatBackend } from './chatBackend'

/**
 * Section 8's "additional model backends" — these tests check `OpenAICompatibleClient` against the
 * documented OpenAI Chat Completions contract with a mocked `fetch`, NOT against a real provider
 * (see the honesty note atop openaiCompatible.ts: nobody working on this had a real API key to
 * verify against). They lock in the request-shape/param-mapping and SSE-parsing logic so a future
 * change can't silently break it, but they cannot catch a real provider behaving differently than
 * documented.
 */

const BASE_REQUEST: GenerateRequest = {
  prompt: 'Hello there',
  max_length: 200,
  max_context_length: 4096,
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

/** Builds a fake streaming `Response` whose body yields the given raw SSE text in one chunk. */
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
  return {
    ok: true,
    status: 200,
    body: { getReader: () => reader },
    text: async () => '',
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenAICompatibleClient — request building', () => {
  it('wraps a plain prompt as a single user message when no messages[] is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')
    await client.generate(BASE_REQUEST)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello there' }])
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.stream).toBe(false)
  })

  it('sends a supplied messages[] as-is instead of wrapping prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')
    await client.generate({
      ...BASE_REQUEST,
      messages: [
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: 'Hello there' },
      ],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'Hello there' },
    ])
  })

  it('maps only the fields with a real Chat Completions equivalent, dropping KoboldCpp-only ones', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')
    await client.generate({
      ...BASE_REQUEST,
      temperature: 0.9,
      top_p: 0.95,
      top_k: 40, // KoboldCpp-only — must NOT appear in the sent body
      min_p: 0.05, // KoboldCpp-only
      rep_pen: 1.1, // KoboldCpp-only
      presence_penalty: 0.2,
      max_length: 256,
      stop_sequence: ['\nUser:'],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.temperature).toBe(0.9)
    expect(body.top_p).toBe(0.95)
    expect(body.presence_penalty).toBe(0.2)
    expect(body.max_tokens).toBe(256)
    expect(body.stop).toEqual(['\nUser:'])
    expect(body).not.toHaveProperty('top_k')
    expect(body).not.toHaveProperty('min_p')
    expect(body).not.toHaveProperty('rep_pen')
  })

  it('maps frequency_penalty/reasoning_effort/verbosity when the caller sets them, and omits them otherwise', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')

    await client.generate({ ...BASE_REQUEST, frequency_penalty: -0.4, reasoning_effort: 'high', verbosity: 'low' })
    let body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.frequency_penalty).toBe(-0.4)
    expect(body.reasoning_effort).toBe('high')
    expect(body.verbosity).toBe('low')

    fetchMock.mockClear()
    await client.generate(BASE_REQUEST)
    body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).not.toHaveProperty('frequency_penalty')
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('verbosity')
  })

  it('sends an Authorization header only when an API key is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    const withKey = new OpenAICompatibleClient('https://api.example.com/v1', 'sk-test-123', 'gpt-4o-mini')
    await withKey.generate(BASE_REQUEST)
    let [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-123')

    fetchMock.mockClear()
    const withoutKey = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')
    await withoutKey.generate(BASE_REQUEST)
    ;[, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('posts to <baseUrl>/chat/completions, trimming a trailing slash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new OpenAICompatibleClient('https://api.example.com/v1/', '', 'gpt-4o-mini')
    await client.generate(BASE_REQUEST)

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
  })
})

describe('OpenAICompatibleClient — generate()', () => {
  it('extracts choices[0].message.content from a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'Hello, world.' } }] })))
    const client = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')
    const text = await client.generate(BASE_REQUEST)
    expect(text).toBe('Hello, world.')
  })

  it('returns an empty string when the response has no choices', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {})))
    const client = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')
    const text = await client.generate(BASE_REQUEST)
    expect(text).toBe('')
  })

  it('throws a KoboldApiError with the provider error message on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: 'Invalid API key' } })))
    const client = new OpenAICompatibleClient('https://api.example.com/v1', 'bad-key', 'gpt-4o-mini')
    await expect(client.generate(BASE_REQUEST)).rejects.toThrow(KoboldApiError)
    await expect(client.generate(BASE_REQUEST)).rejects.toThrow(/Invalid API key/)
  })

  it('throws a KoboldApiError when the network request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const client = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')
    await expect(client.generate(BASE_REQUEST)).rejects.toThrow(KoboldApiError)
  })

  it('rethrows the original error instead of a KoboldApiError when the caller aborted', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('Aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
    controller.abort()
    const client = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')
    await expect(client.generate(BASE_REQUEST, controller.signal)).rejects.toBe(abortError)
  })
})

describe('OpenAICompatibleClient — generateStream()', () => {
  it('parses delta.content chunks, calls onToken incrementally, and ignores [DONE]', async () => {
    const events = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' } }] })}`,
      'data: [DONE]',
    ]
      .map((e) => e + '\n\n')
      .join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(events)))

    const client = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')
    const tokens: string[] = []
    const full = await client.generateStream(BASE_REQUEST, (token) => tokens.push(token))

    expect(tokens).toEqual(['Hel', 'lo'])
    expect(full).toBe('Hello')
  })

  it('ignores malformed/keepalive events without throwing', async () => {
    const events = [': keepalive', `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}`, 'data: not json'].map((e) => e + '\n\n').join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(events)))

    const client = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')
    const full = await client.generateStream(BASE_REQUEST, () => {})
    expect(full).toBe('ok')
  })

  it('returns an empty string instead of throwing when the caller aborted before the request landed', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')))
    controller.abort()
    const client = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')
    const full = await client.generateStream(BASE_REQUEST, () => {}, controller.signal)
    expect(full).toBe('')
  })
})

describe('OpenAICompatibleClient — no-op / fallback surface', () => {
  it('getEffectiveMaxContext always returns the caller-supplied fallback (no introspection endpoint)', async () => {
    const client = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')
    expect(await client.getEffectiveMaxContext(8192)).toBe(8192)
    expect(await client.getEffectiveMaxContext()).toBe(4096)
  })

  it('tokenCount falls back to the same character-based estimate the rest of the app uses', async () => {
    const client = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')
    const { count } = await client.tokenCount('twelve characters here')
    expect(count).toBe(Math.ceil('twelve characters here'.length / 4))
  })

  it('abort() resolves without making any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // Typed as the shared interface, not the concrete class — every real call site holds a
    // `ChatBackend`, and the interface's `abort(genkey)` takes an argument this implementation
    // itself just ignores.
    const client: ChatBackend = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')
    await expect(client.abort('some-genkey')).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('getChatTemplate always returns null (not a locally loaded GGUF)', async () => {
    const client = new OpenAICompatibleClient('https://api.example.com/v1', '', 'gpt-4o-mini')
    expect(await client.getChatTemplate()).toBeNull()
  })
})

// Settings → Connection's "does this actually work" check (also the header status dot for this
// backend) — a GET, never a real chat completion, so it costs nothing on a paid provider.
describe('checkConnection', () => {
  it("hits GET {baseUrl}/models for a non-OpenRouter provider, and treats 200 as ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: 'gpt-4o-mini' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new OpenAICompatibleClient('https://api.openai.com/v1', 'sk-real', 'gpt-4o-mini')
    const result = await client.checkConnection()
    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.objectContaining({ headers: expect.any(Object) }))
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-real')
  })

  it('reports a rejected key distinctly on 401/403, for a non-OpenRouter provider', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})))
    const client = new OpenAICompatibleClient('https://api.openai.com/v1', 'sk-bad', 'gpt-4o-mini')
    expect(await client.checkConnection()).toEqual({ ok: false, detail: 'The API key was rejected.' })
  })

  it('reports unreachable (not a key problem) when the fetch itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const client = new OpenAICompatibleClient('https://api.example.com/v1', 'sk-real', 'gpt-4o-mini')
    const result = await client.checkConnection()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Could not reach')
  })

  it('refuses to check with no base URL set, without making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const client = new OpenAICompatibleClient('', 'sk-real', 'gpt-4o-mini')
    expect(await client.checkConnection()).toEqual({ ok: false, detail: 'No base URL set.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("uses OpenRouter's own /key endpoint instead of /models, since /models there is public and would never catch a bad key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: { is_free_tier: true, usage: 0, limit: null } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', 'sk-or-real', 'minimax/minimax-m3:free')
    await client.checkConnection()
    expect(fetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/v1/key', expect.anything())
  })

  it("surfaces OpenRouter's usage/limit as the success detail", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { data: { is_free_tier: false, usage: 25.5, limit: 100 } })),
    )
    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', 'sk-or-real', 'anthropic/claude-3.5-sonnet')
    expect(await client.checkConnection()).toEqual({ ok: true, detail: '$25.50 used of $100 limit' })
  })

  it('falls back to noting a free-tier key when OpenRouter reports no usage yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: { is_free_tier: true, limit: null } })))
    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', 'sk-or-real', 'minimax/minimax-m3:free')
    expect(await client.checkConnection()).toEqual({ ok: true, detail: 'Free-tier key' })
  })

  it("still reports a rejected key on OpenRouter's /key endpoint", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})))
    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', 'sk-or-bad', 'minimax/minimax-m3:free')
    expect(await client.checkConnection()).toEqual({ ok: false, detail: 'The API key was rejected.' })
  })
})
