import { describe, expect, it } from 'vitest'
import { createGenerationLock } from './generationLock'

describe('createGenerationLock', () => {
  it('starts unheld', () => {
    expect(createGenerationLock().held).toBe(false)
  })

  it('grants the first claim and refuses every later one until released', () => {
    const lock = createGenerationLock()
    expect(lock.begin()).toBe(true)
    expect(lock.begin()).toBe(false)
    expect(lock.begin()).toBe(false)
    expect(lock.held).toBe(true)
  })

  it('grants again after a release', () => {
    const lock = createGenerationLock()
    lock.begin()
    lock.end()
    expect(lock.held).toBe(false)
    expect(lock.begin()).toBe(true)
  })

  it('tolerates a release that was never claimed', () => {
    const lock = createGenerationLock()
    lock.end()
    lock.end()
    expect(lock.held).toBe(false)
    expect(lock.begin()).toBe(true)
  })

  it('is synchronous, so a second caller in the same tick is refused', async () => {
    // The regression this exists for. The old guard was React state, which a callback created on
    // an earlier render still read as `false` after a newer call had already started generating —
    // both proceeded and interleaved their writes to the same message row. Modelled here as two
    // callers dispatched together with no render (and no await) between them.
    const lock = createGenerationLock()
    const ran: string[] = []
    const attempt = async (name: string) => {
      if (!lock.begin()) return
      try {
        ran.push(name)
        await Promise.resolve()
      } finally {
        lock.end()
      }
    }

    await Promise.all([attempt('first'), attempt('second')])

    expect(ran).toEqual(['first'])
    expect(lock.held).toBe(false)
  })

  it('releases when the holder throws, so one failed generation cannot wedge the chat', async () => {
    const lock = createGenerationLock()
    const boom = async () => {
      if (!lock.begin()) return
      try {
        throw new Error('generation failed')
      } finally {
        lock.end()
      }
    }

    await expect(boom()).rejects.toThrow('generation failed')
    expect(lock.held).toBe(false)
    expect(lock.begin()).toBe(true)
  })

  it('lets a queued caller through only once the holder has finished, not while it awaits', async () => {
    const lock = createGenerationLock()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })

    const holder = (async () => {
      expect(lock.begin()).toBe(true)
      try {
        await blocked
      } finally {
        lock.end()
      }
    })()

    // Mid-await: the holder has yielded, but the claim is still theirs.
    await Promise.resolve()
    expect(lock.begin()).toBe(false)

    release()
    await holder
    expect(lock.begin()).toBe(true)
  })

  it('keeps separate chats independent', () => {
    const a = createGenerationLock()
    const b = createGenerationLock()
    expect(a.begin()).toBe(true)
    expect(b.begin()).toBe(true)
    a.end()
    expect(b.held).toBe(true)
  })
})
