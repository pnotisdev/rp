import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBackend } from './chatBackend'
import type { GenerateRequest } from './types'
import { ASSIST_TIMEOUT_MS, generateWithTimeout, trimCodeFence } from './generateWithTimeout'
import { getInstructTemplate } from '../prompt/instructTemplates'

describe('generateWithTimeout', () => {
  // The live repro this exists for: a provider response that simply never resolves (confirmed against a rate-limited free OpenRouter…
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves normally when the backend answers before the timeout', async () => {
    const client = { generate: async () => 'real answer' } as unknown as ChatBackend
    await expect(generateWithTimeout(client, { prompt: 'x' } as never, 'Test call')).resolves.toBe('real answer')
  })

  it('aborts the request and rejects with a clear message once the backend never responds', async () => {
    let sawAbort = false
    const client = {
      generate: (_p: unknown, signal?: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            sawAbort = true
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    } as unknown as ChatBackend

    const pending = generateWithTimeout(client, { prompt: 'x' } as never, 'Test call')
    // Attach the rejection assertion before advancing any timers
    const assertion = expect(pending).rejects.toThrow(/Test call timed out after 45s/)

    // Nothing has happened yet — still well within the timeout window.
    await vi.advanceTimersByTimeAsync(ASSIST_TIMEOUT_MS - 1000)
    expect(sawAbort).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(sawAbort).toBe(true)
  })

  it('still surfaces a real (non-timeout) error as itself, not a misleading timeout message', async () => {
    const client = {
      generate: async () => {
        throw new Error('Chat completion failed (429): Provider returned error')
      },
    } as unknown as ChatBackend
    await expect(generateWithTimeout(client, { prompt: 'x' } as never, 'Test call')).rejects.toThrow(/429/)
  })

  it('clears its internal timer on a normal resolution, so it does not fire after the fact', async () => {
    const client = { generate: async () => 'ok' } as unknown as ChatBackend
    await generateWithTimeout(client, { prompt: 'x' } as never, 'Test call')
    // If the timer weren't cleared, this would eventually call `controller.abort()` against a long-settled controller
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('generateWithTimeout prompt shaping', () => {
  // rp#7 + rp#6: a background judge call (relationship tracker, objectives, choices, director pick, rapport, scene vision) used to…
  function captureClient() {
    let sent: GenerateRequest | undefined
    const client = {
      generate: async (p: GenerateRequest) => {
        sent = p
        return '{}'
      },
    } as unknown as ChatBackend
    return { client, sent: () => sent! }
  }

  it('leaves the prompt and max_length untouched with no shaping given, exactly like before', async () => {
    const { client, sent } = captureClient()
    await generateWithTimeout(client, { prompt: 'JSON:', max_length: 200 } as GenerateRequest, 'Test call')
    expect(sent().prompt).toBe('JSON:')
    expect(sent().max_length).toBe(200)
  })

  it('wraps the prompt in the given template and merges in its stop sequences', async () => {
    const { client, sent } = captureClient()
    const gemma = getInstructTemplate('gemma')
    await generateWithTimeout(
      client,
      { prompt: 'JSON:', max_length: 200, stop_sequence: ['```'] } as GenerateRequest,
      'Test call',
      undefined,
      { template: gemma },
    )
    expect(sent().prompt).toBe('<start_of_turn>user\nJSON:<end_of_turn>\n<start_of_turn>model\n')
    // The fence stop is dropped (cut afterwards instead); only the template's own stops go to the server.
    expect(sent().stop_sequence).toEqual(['<end_of_turn>', '<start_of_turn>'])
  })

  it('is a no-op for plain-chat (beyond the trailing newline), same as omitting a template', async () => {
    const { client, sent } = captureClient()
    await generateWithTimeout(
      client,
      { prompt: 'JSON:', max_length: 200 } as GenerateRequest,
      'Test call',
      undefined,
      { template: getInstructTemplate('plain-chat') },
    )
    expect(sent().prompt).toBe('JSON:\n')
    expect(sent().stop_sequence).toBeUndefined()
  })

  it('adds reasoningReserve on top of the caller\'s own max_length', async () => {
    const { client, sent } = captureClient()
    await generateWithTimeout(
      client,
      { prompt: 'JSON:', max_length: 200 } as GenerateRequest,
      'Test call',
      undefined,
      { reasoningReserve: 800 },
    )
    expect(sent().max_length).toBe(1000)
    expect(sent().prompt).toBe('JSON:')
  })

  it('applies template wrapping and reasoning reserve together', async () => {
    const { client, sent } = captureClient()
    await generateWithTimeout(
      client,
      { prompt: 'JSON:', max_length: 200 } as GenerateRequest,
      'Test call',
      undefined,
      { template: getInstructTemplate('gemma'), reasoningReserve: 800 },
    )
    expect(sent().max_length).toBe(1000)
    expect(sent().prompt).toBe('<start_of_turn>user\nJSON:<end_of_turn>\n<start_of_turn>model\n')
  })

  it('ignores a zero or negative reasoningReserve rather than shrinking max_length', async () => {
    const { client, sent } = captureClient()
    await generateWithTimeout(client, { prompt: 'JSON:', max_length: 200 } as GenerateRequest, 'Test call', undefined, {
      reasoningReserve: 0,
    })
    expect(sent().max_length).toBe(200)
  })
})

describe('fenced answers', () => {
  const clientReturning = (text: string, spy?: (p: GenerateRequest) => void) =>
    ({ generate: async (p: GenerateRequest) => (spy?.(p), text) }) as unknown as ChatBackend

  it('keeps the JSON of an answer that opens with a code fence instead of returning nothing', async () => {
    let stops: string[] | undefined
    const out = await generateWithTimeout(
      clientReturning('```json\n{"a":1}\n```\nSome trailing remark.', (p) => (stops = p.stop_sequence)),
      { prompt: 'JSON:', max_length: 50, stop_sequence: ['\n\n\n', '```'] } as GenerateRequest,
      'Test call',
    )
    expect(out).toBe('{"a":1}\n')
    expect(stops).toEqual(['\n\n\n'])
  })

  it('trimCodeFence cuts a bare answer at the first fence and leaves fence-free text alone', () => {
    expect(trimCodeFence('{"a":1}\n```\nnotes')).toBe('{"a":1}\n')
    expect(trimCodeFence('plain text')).toBe('plain text')
    expect(trimCodeFence('```\n[1,2]\n```')).toBe('[1,2]\n')
  })
})
