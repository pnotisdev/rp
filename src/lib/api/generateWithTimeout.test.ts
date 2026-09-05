import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBackend } from './chatBackend'
import { ASSIST_TIMEOUT_MS, generateWithTimeout } from './generateWithTimeout'

describe('generateWithTimeout', () => {
  // The live repro this exists for: a provider response that simply never resolves (confirmed
  // against a rate-limited free OpenRouter model) used to leave the awaiting caller stuck forever
  // — a button reading "Generating…"/"Thinking…" with no error and no way to retry, because the
  // awaited promise never settled either way.
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
    // Attach the rejection assertion before advancing any timers, so the promise never has a tick
    // where it's rejected but nothing is listening yet (fake timers otherwise make that window
    // land as a real unhandled-rejection warning even though the test itself is correct).
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
    // If the timer weren't cleared, this would eventually call `controller.abort()` against a
    // long-settled controller — harmless either way, but asserting no pending timers confirms the
    // `finally`'s `clearTimeout` actually ran.
    expect(vi.getTimerCount()).toBe(0)
  })
})
