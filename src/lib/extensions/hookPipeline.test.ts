import { describe, expect, it, vi } from 'vitest'
import { applyInputHooks, applyOutputHooks, collectContextSections, hookedRunners, type HookReply, type HookRunner } from './hookPipeline'
import type { HookName, Permission } from './manifest'

const ctx = { chatId: 'c1', characterName: 'Aria', personaName: 'You' }

function runner(name: string, reply: (payload: unknown) => HookReply | Promise<HookReply>, opts: { hooks?: HookName[]; grants?: Permission[]; enabled?: boolean } = {}): HookRunner & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    record: {
      id: name.toLowerCase().replace(/\s/g, '-'),
      enabled: opts.enabled ?? true,
      grants: opts.grants ?? ['hooks'],
      manifest: { name, hooks: opts.hooks ?? ['input', 'output', 'context'] } as HookRunner['record']['manifest'],
    },
    async callHook(_n, payload) {
      calls.push(payload)
      return reply(payload)
    },
  }
}
const ok = (value: unknown): HookReply => ({ ok: true, value })

describe('hookedRunners', () => {
  it('requires enabled, the hooks grant and a manifest declaration, and sorts by name', () => {
    const a = runner('Zed', () => ok(null))
    const b = runner('Alpha', () => ok(null))
    const off = runner('Off', () => ok(null), { enabled: false })
    const ungranted = runner('NoGrant', () => ok(null), { grants: [] })
    const undeclared = runner('Undeclared', () => ok(null), { hooks: ['output'] })
    expect(hookedRunners([a, b, off, ungranted, undeclared], 'input').map((r) => r.record.manifest.name)).toEqual(['Alpha', 'Zed'])
  })
})

describe('applyInputHooks', () => {
  it('pipes text through hooks in name order, accepting strings and { text }', async () => {
    const a = runner('A', (p) => ok(`${(p as { text: string }).text}!`))
    const b = runner('B', (p) => ok({ text: `[${(p as { text: string }).text}]` }))
    const result = await applyInputHooks([b, a], 'hi', ctx, vi.fn())
    expect(result).toEqual({ text: '[hi!]' })
    expect(b.calls[0]).toMatchObject({ text: 'hi!', chatId: 'c1', characterName: 'Aria' })
  })

  it('lets a hook cancel the send with a reason', async () => {
    const stopper = runner('Stopper', () => ok({ cancel: true, reason: 'No spoilers' }))
    const later = runner('Zlater', () => ok('never'))
    expect(await applyInputHooks([stopper, later], 'x', ctx, vi.fn())).toEqual({ text: 'x', cancelled: 'No spoilers' })
    expect(later.calls).toHaveLength(0)
  })

  it('fails open on errors, skips, throws, blanks and oversized results', async () => {
    const log = vi.fn()
    const rs = [
      runner('A', () => ({ ok: false, error: 'boom' })),
      runner('B', () => ({ skipped: true })),
      runner('C', () => {
        throw new Error('kaboom')
      }),
      runner('D', () => ok('   ')),
      runner('E', () => ok('x'.repeat(30_000))),
      runner('F', () => ok(42)),
    ]
    expect(await applyInputHooks(rs, 'keep me', ctx, log)).toEqual({ text: 'keep me' })
    expect(log).toHaveBeenCalledWith('a', 'error', 'input hook failed: boom')
    expect(log).toHaveBeenCalledWith('c', 'error', 'input hook failed: kaboom')
  })
})

describe('applyOutputHooks', () => {
  it('transforms replies and ignores empty results', async () => {
    const upper = runner('Upper', (p) => ok((p as { text: string }).text.toUpperCase()))
    const blank = runner('Zblank', () => ok(''))
    expect(await applyOutputHooks([upper, blank], 'hello there', ctx, vi.fn())).toBe('HELLO THERE')
  })

  it('does nothing without runners', async () => {
    expect(await applyOutputHooks([], 'unchanged', ctx, vi.fn())).toBe('unchanged')
  })
})

describe('collectContextSections', () => {
  const cctx = { ...ctx, lastUserText: 'hello' }

  it('normalizes strings, objects, arrays and { sections }', async () => {
    const rs = [
      runner('A', () => ok('Plain text')),
      runner('B', () => ok({ text: 'Object', label: 'quests' })),
      runner('C', () => ok(['one', { text: 'two' }])),
      runner('D', () => ok({ sections: [{ text: 'nested' }] })),
      runner('E', () => ok(null)),
    ]
    const out = await collectContextSections(rs, cctx, vi.fn())
    expect(out.map((s) => [s.label, s.text])).toEqual([
      ['A', 'Plain text'],
      ['B: quests', 'Object'],
      ['C', 'one'],
      ['C', 'two'],
      ['D', 'nested'],
    ])
  })

  it('caps section size, per-extension count and the total', async () => {
    const big = runner('Big', () => ok(Array.from({ length: 10 }, () => 'y'.repeat(2000))))
    const out = await collectContextSections([big, runner('Zmore', () => ok('late'))], cctx, vi.fn())
    expect(out.length).toBeLessThanOrEqual(4)
    expect(out.every((s) => s.text.length <= 1200)).toBe(true)
    expect(out.reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(3000)
  })

  it('passes the last user text to hooks', async () => {
    const r = runner('A', () => ok(null))
    await collectContextSections([r], cctx, vi.fn())
    expect(r.calls[0]).toMatchObject({ lastUserText: 'hello' })
  })
})
