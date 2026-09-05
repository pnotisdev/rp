import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetUnreachableStateForTests, personasApi } from './client'
import { useToastStore } from '@/lib/store/useToastStore'

/**
 * `request()` (the one function every call in this file funnels through) used to leave a dead
 * local server completely invisible: `useApiQuery`'s background refetches swallow rejections into
 * `undefined` with no toast at all, and generation itself never touches this server (it talks to
 * the model backend directly), so nothing on screen ever hinted that saves were failing. These
 * tests lock in the fix — one sticky (non-auto-dismissing) error toast per outage, not one per
 * failed call, cleared and followed by a "reconnected" toast the moment a request gets through.
 */

function okResponse<T>(body: T): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

function errorResponse(status: number, body = ''): Response {
  return { ok: false, status, json: async () => ({}), text: async () => body } as Response
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  __resetUnreachableStateForTests()
})

describe('request(): local-server-unreachable toast', () => {
  it('shows exactly one sticky error toast across repeated network-level failures, not one per call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )

    await expect(personasApi.list()).rejects.toThrow()
    await expect(personasApi.list()).rejects.toThrow()
    await expect(personasApi.list()).rejects.toThrow()

    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].variant).toBe('error')
    expect(toasts[0].message).toContain("local server")
  })

  it("doesn't auto-dismiss the unreachable toast (it's meant to survive looking away)", async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(personasApi.list()).rejects.toThrow()
    // AUTO_DISMISS_MS.error is null in ToastViewport.tsx — nothing to assert on a timer here since
    // this test only checks the toast itself carries variant: 'error', which is what that map keys on.
    expect(useToastStore.getState().toasts[0].variant).toBe('error')
  })

  it('clears the sticky toast and shows a reconnected toast once a request succeeds again', async () => {
    const fetchMock = vi.fn()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fetchMock.mockResolvedValueOnce(okResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(personasApi.list()).rejects.toThrow()
    expect(useToastStore.getState().toasts).toHaveLength(1)

    await expect(personasApi.list()).resolves.toEqual([])

    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].variant).toBe('success')
    expect(toasts[0].message).toContain('Reconnected')
  })

  it('a fresh outage after recovery raises the sticky toast again (not left permanently cleared)', async () => {
    const fetchMock = vi.fn()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fetchMock.mockResolvedValueOnce(okResponse([]))
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(personasApi.list()).rejects.toThrow() // down
    await expect(personasApi.list()).resolves.toEqual([]) // back up, toast clears
    await expect(personasApi.list()).rejects.toThrow() // down again

    // Not asserting total toast count here: the "Reconnected" success toast from the recovery step
    // is still sitting in the store (nothing in this test mounts <ToastViewport>, so nothing ever
    // runs its auto-dismiss timer) — that's expected and fine. What matters is that the fresh outage
    // actually raised a new sticky error toast rather than staying silent because one already fired
    // earlier in the test.
    const toasts = useToastStore.getState().toasts
    const latest = toasts[toasts.length - 1]
    expect(latest.variant).toBe('error')
    expect(latest.message).toContain('local server')
  })

  it('an HTTP error response (server reached, just answered with an error) does not trigger the unreachable toast', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(500, 'boom')))

    await expect(personasApi.list()).rejects.toThrow('failed (500)')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('a request timeout does not trigger the unreachable toast (separate, already-distinct error path)', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          })
        }),
      )

      const pending = expect(personasApi.list()).rejects.toThrow(/timed out/)
      await vi.advanceTimersByTimeAsync(15000)
      await pending
      expect(useToastStore.getState().toasts).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
