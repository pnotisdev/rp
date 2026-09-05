import { describe, expect, it } from 'vitest'
import { createCoinMutex, getCoinMutex } from './coinMutex'

describe('createCoinMutex', () => {
  it('runs a single caller immediately and returns its value', async () => {
    const mutex = createCoinMutex()
    await expect(mutex.run(async () => 42)).resolves.toBe(42)
  })

  it('serializes two overlapping callers so the second only starts once the first finishes', async () => {
    // The regression this exists for: two `GET`-compute-`PUT` critical sections racing so the
    // second's read observes the first's *pre*-write state, silently dropping the first's delta.
    const mutex = createCoinMutex()
    const order: string[] = []
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = mutex.run(async () => {
      order.push('first-start')
      await blocked
      order.push('first-end')
      return 'first'
    })
    const second = mutex.run(async () => {
      order.push('second-start')
      return 'second'
    })

    // Give both a tick to attempt to start — only the first should actually have begun.
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['first-start'])

    release()
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
    expect(order).toEqual(['first-start', 'first-end', 'second-start'])
  })

  it('lets a later caller through even when an earlier one throws', async () => {
    const mutex = createCoinMutex()
    await expect(
      mutex.run(async () => {
        throw new Error('purchase failed')
      }),
    ).rejects.toThrow('purchase failed')

    await expect(mutex.run(async () => 'still works')).resolves.toBe('still works')
  })

  it('preserves queue order across three callers', async () => {
    const mutex = createCoinMutex()
    const order: number[] = []
    await Promise.all([
      mutex.run(async () => {
        order.push(1)
      }),
      mutex.run(async () => {
        order.push(2)
      }),
      mutex.run(async () => {
        order.push(3)
      }),
    ])
    expect(order).toEqual([1, 2, 3])
  })
})

describe('getCoinMutex', () => {
  it('returns the same mutex instance for the same chat id', () => {
    expect(getCoinMutex('chat-a')).toBe(getCoinMutex('chat-a'))
  })

  it('keeps different chats on independent mutexes', async () => {
    const a = getCoinMutex('chat-b')
    const b = getCoinMutex('chat-c')
    expect(a).not.toBe(b)

    const order: string[] = []
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const heldByA = a.run(async () => {
      order.push('a-start')
      await blocked
      order.push('a-end')
    })
    // A caller on a *different* chat's mutex must not wait behind chat-b's holder.
    await b.run(async () => {
      order.push('b')
    })
    expect(order).toEqual(['a-start', 'b'])
    release()
    await heldByA
  })
})
