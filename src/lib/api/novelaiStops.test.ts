import { afterEach, describe, expect, it, vi } from 'vitest'
import { cutAtStop, NovelAIClient } from './novelai'
import type { GenerateRequest } from './types'

const REQUEST: GenerateRequest = { prompt: 'Once upon a time,', max_length: 150, max_context_length: 4096 }

function json(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response
}

function sse(tokens: string[]): Response {
  const encoder = new TextEncoder()
  const raw = tokens.map((t) => `data: ${JSON.stringify({ token: t })}\n\n`).join('')
  let sent = false
  const reader = { read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: encoder.encode(raw) })), cancel: async () => undefined }
  return { ok: true, status: 200, body: { getReader: () => reader }, text: async () => '' } as unknown as Response
}

/** The tokenizer endpoint answers 404 (a model with no bundled tokenizer); everything else is `reply`. */
function mock(reply: () => Response) {
  return vi.fn(async (url: string) => (String(url).includes('/api/novelai/tokenize') ? ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response) : reply()))
}

afterEach(() => vi.unstubAllGlobals())

describe('stop sequences handled in the app', () => {
  it('cuts at the earliest stop sequence', () => {
    expect(cutAtStop('Hello\nYou: hi', ['\nYou:', '\nMe:'])).toBe('Hello')
    expect(cutAtStop('a END b STOP c', ['STOP', 'END'])).toBe('a ')
    expect(cutAtStop('nothing', ['x', ''])).toBe('nothing')
    expect(cutAtStop('keep', undefined)).toBe('keep')
  })

  it('applies them to a finished reply when the tokenizer cannot', async () => {
    vi.stubGlobal('fetch', mock(() => json({ output: 'Fine.\nUser: and then' })))
    expect(await new NovelAIClient('sk', 'llama-3-erato-v1').generate({ ...REQUEST, stop_sequence: ['\nUser:'] })).toBe('Fine.')
  })

  it('stops a stream as soon as one appears', async () => {
    vi.stubGlobal('fetch', mock(() => sse(['Fine.', '\nUs', 'er: more', ' never shown'])))
    const seen: string[] = []
    const full = await new NovelAIClient('sk', 'llama-3-erato-v1').generateStream({ ...REQUEST, stop_sequence: ['\nUser:'] }, (_t, f) => seen.push(f))
    expect(full).toBe('Fine.')
    expect(seen[seen.length - 1]).not.toContain('User')
  })

  it('sends Erato through the text host of the local relay', async () => {
    const fetchMock = mock(() => json({ output: 'x' }))
    vi.stubGlobal('fetch', fetchMock)
    await new NovelAIClient('sk', 'llama-3-erato-v1').generate(REQUEST)
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/novelai/proxy/text/ai/generate')).toBe(true)
  })
})
