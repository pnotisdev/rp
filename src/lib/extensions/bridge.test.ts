import { describe, expect, it, vi } from 'vitest'
import { createBridge, RateLimiter, type HostApi } from './bridge'
import type { Permission } from './manifest'

function setup(grants: Permission[] = [], opts: { chatId?: string | null; now?: () => number } = {}) {
  const host = {
    scopeId: vi.fn(async (scope: string) => (scope === 'chat' ? (opts.chatId === undefined ? 'chat-1' : opts.chatId) : scope === 'character' ? 'char-1' : null)),
    kvList: vi.fn(async () => ({ score: 7 }) as Record<string, unknown>),
    kvSet: vi.fn(async () => {}),
    kvRemove: vi.fn(async () => {}),
    notify: vi.fn(),
    chatInfo: vi.fn(async () => null),
    chatMessages: vi.fn(async () => []),
    chatAppend: vi.fn(async (text: string) => ({ id: 'm1', role: 'char' as const, name: 'A', text, createdAt: 1 })),
    chatSend: vi.fn(async () => {}),
    stateGet: vi.fn(async () => null),
    stateSetFlag: vi.fn(async () => ['met']),
    stateAddCoins: vi.fn(async (n: number) => n),
    stateGiveItem: vi.fn(async () => ({})),
    loreBooks: vi.fn(async () => []),
    loreEntries: vi.fn(async () => []),
    loreAdd: vi.fn(async (_b: string, e: { keys: string[]; content: string; comment: string }) => ({ id: 1, enabled: true, ...e })),
    loreRemove: vi.fn(async () => {}),
    factsList: vi.fn(async () => []),
    factsAdd: vi.fn(async (text: string, importance: number) => ({ id: 'f1', text, importance })),
    charactersList: vi.fn(async () => []),
    generate: vi.fn(async () => 'generated'),
  } satisfies HostApi
  const subscribe = vi.fn()
  const onResize = vi.fn()
  const bridge = createBridge({
    extId: 'demo-ext',
    extName: 'Demo',
    host,
    grants: () => grants,
    settings: () => ({ sides: 20 }),
    subscribe,
    onResize,
    now: opts.now,
  })
  return { host, bridge, subscribe, onResize }
}

describe('permissions', () => {
  it('denies a gated method without the grant and never touches the host', async () => {
    const { host, bridge } = setup([])
    await expect(bridge.handle('chat.messages', {})).rejects.toThrow(/needs the "chat\.read" permission/)
    await expect(bridge.handle('state.setFlag', { flag: 'x' })).rejects.toThrow(/state\.write/)
    await expect(bridge.handle('generate', { prompt: 'x' })).rejects.toThrow(/"generate"/)
    expect(host.chatMessages).not.toHaveBeenCalled()
    expect(host.stateSetFlag).not.toHaveBeenCalled()
    expect(host.generate).not.toHaveBeenCalled()
  })

  it('allows ungated methods and granted ones', async () => {
    const { host, bridge } = setup(['chat.read'])
    await expect(bridge.handle('settings.all', {})).resolves.toEqual({ sides: 20 })
    await bridge.handle('chat.messages', {})
    expect(host.chatMessages).toHaveBeenCalledWith(40)
  })

  it('rejects unknown and prototype-named methods', async () => {
    const { bridge } = setup(['chat.read', 'chat.write'])
    for (const name of ['nope', 'constructor', '__proto__', 'toString', 'chat.hack']) {
      await expect(bridge.handle(name, {})).rejects.toThrow(/Unknown method/)
    }
  })
})

describe('argument handling', () => {
  it('clamps numbers and defaults optional arguments', async () => {
    const { host, bridge } = setup(['chat.read', 'state.write', 'generate'])
    await bridge.handle('chat.messages', { limit: 9999 })
    expect(host.chatMessages).toHaveBeenLastCalledWith(200)
    await bridge.handle('state.addCoins', { amount: 5000 })
    expect(host.stateAddCoins).toHaveBeenLastCalledWith(1000)
    await bridge.handle('state.giveItem', { id: 'key' })
    expect(host.stateGiveItem).toHaveBeenLastCalledWith('key', 1)
    await bridge.handle('generate', { prompt: 'hi', options: { temperature: 9 } })
    expect(host.generate).toHaveBeenLastCalledWith('hi', { system: '', maxTokens: 300, temperature: 2 })
  })

  it('validates strings and flags', async () => {
    const { host, bridge } = setup(['chat.write', 'state.write'])
    await expect(bridge.handle('chat.append', { text: '   ' })).rejects.toThrow(/must not be empty/)
    await expect(bridge.handle('chat.append', { text: 5 })).rejects.toThrow(/must be a string/)
    await expect(bridge.handle('chat.append', { text: 'x'.repeat(20_001) })).rejects.toThrow(/too long/)
    await expect(bridge.handle('state.setFlag', { flag: 'bad flag!' })).rejects.toThrow(/letters, digits/)
    await bridge.handle('chat.append', { text: 'hello' })
    expect(host.chatAppend).toHaveBeenLastCalledWith('hello', 'char')
    await bridge.handle('chat.append', { text: 'hello', as: 'user' })
    expect(host.chatAppend).toHaveBeenLastCalledWith('hello', 'user')
    await bridge.handle('state.setFlag', { flag: 'met', on: false })
    expect(host.stateSetFlag).toHaveBeenLastCalledWith('met', false)
  })

  it('shapes lore entries', async () => {
    const { host, bridge } = setup(['lore.write'])
    await bridge.handle('lore.add', { bookId: 'b1', entry: { keys: Array.from({ length: 30 }, (_, i) => `k${i}`), content: 'text' } })
    const [, entry] = host.loreAdd.mock.calls[0]
    expect(entry.keys).toHaveLength(20)
    expect(entry.comment).toBe('')
    await expect(bridge.handle('lore.add', { bookId: 'b1', entry: { keys: [] } })).rejects.toThrow(/entry\.content/)
  })
})

describe('storage', () => {
  it('reads values and treats inherited names as missing', async () => {
    const { host, bridge } = setup()
    await expect(bridge.handle('storage.get', { key: 'score', scope: 'global' })).resolves.toBe(7)
    await expect(bridge.handle('storage.get', { key: 'constructor', scope: 'global' })).resolves.toBeNull()
    await expect(bridge.handle('storage.keys', { scope: 'global' })).resolves.toEqual(['score'])
    expect(host.kvList).toHaveBeenCalledWith('demo-ext', 'global', '')
  })

  it('resolves chat scope or explains why it cannot', async () => {
    const open = setup([], { chatId: 'chat-9' })
    await open.bridge.handle('storage.set', { key: 'k', value: { a: 1 }, scope: 'chat' })
    expect(open.host.kvSet).toHaveBeenCalledWith('demo-ext', 'chat', 'chat-9', 'k', { a: 1 })
    const closed = setup([], { chatId: null })
    await expect(closed.bridge.handle('storage.get', { key: 'k', scope: 'chat' })).rejects.toThrow(/No chat is open/)
    await expect(closed.bridge.handle('storage.get', { key: 'k', scope: 'planet' })).rejects.toThrow(/scope/)
  })

  it('stores undefined as null and rejects oversized values', async () => {
    const { host, bridge } = setup()
    await bridge.handle('storage.set', { key: 'k', scope: 'global' })
    expect(host.kvSet).toHaveBeenLastCalledWith('demo-ext', 'global', '', 'k', null)
    await expect(bridge.handle('storage.set', { key: 'k', value: 'x'.repeat(300_000), scope: 'global' })).rejects.toThrow(/at most/)
  })
})

describe('events and ui', () => {
  it('only subscribes when the event permission is granted', async () => {
    const denied = setup([])
    await expect(denied.bridge.handle('subscribe', { event: 'message' })).rejects.toThrow(/chat\.read/)
    await expect(denied.bridge.handle('subscribe', { event: 'constructor' })).rejects.toThrow(/Unknown event/)
    await denied.bridge.handle('subscribe', { event: 'settings' })
    expect(denied.subscribe).toHaveBeenCalledWith('settings')
    const ok = setup(['chat.read'])
    await ok.bridge.handle('subscribe', { event: 'message' })
    expect(ok.subscribe).toHaveBeenCalledWith('message')
  })

  it('forwards notify and resize with normalization', async () => {
    const { host, bridge, onResize } = setup()
    await bridge.handle('notify', { text: 'saved', kind: 'bogus' })
    expect(host.notify).toHaveBeenLastCalledWith('Demo', 'saved', 'info')
    await bridge.handle('notify', { text: 'yay', kind: 'success' })
    expect(host.notify).toHaveBeenLastCalledWith('Demo', 'yay', 'success')
    await bridge.handle('resize', { height: 99999 })
    expect(onResize).toHaveBeenLastCalledWith(2000)
  })
})

describe('rate limiting', () => {
  it('limits writes per window and recovers', async () => {
    let t = 1000
    const { host, bridge } = setup(['chat.write'], { now: () => t })
    for (let i = 0; i < 20; i++) await bridge.handle('chat.append', { text: `m${i}` })
    await expect(bridge.handle('chat.append', { text: 'one too many' })).rejects.toThrow(/Slow down/)
    expect(host.chatAppend).toHaveBeenCalledTimes(20)
    t += 10_001
    await expect(bridge.handle('chat.append', { text: 'ok again' })).resolves.toBeTruthy()
  })

  it('limits notifications separately from writes', async () => {
    const { bridge } = setup(['chat.write'])
    for (let i = 0; i < 5; i++) await bridge.handle('notify', { text: 'n' })
    await expect(bridge.handle('notify', { text: 'n' })).rejects.toThrow(/Slow down/)
    await expect(bridge.handle('chat.append', { text: 'still fine' })).resolves.toBeTruthy()
  })

  it('RateLimiter slides', () => {
    const r = new RateLimiter(2, 100)
    expect([r.take(0), r.take(10), r.take(20)]).toEqual([true, true, false])
    expect(r.take(111)).toBe(true)
  })
})
