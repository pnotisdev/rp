import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { PANEL_BOOT, SCRIPT_RELAY_BOOT, SDK_CORE, WORKER_BOOT } from './sdkSource'
import { METHOD_PERMISSIONS } from './manifest'

type Msg = Record<string, unknown>

function load() {
  const out: Msg[] = []
  const ctx = vm.createContext({ __out: out })
  vm.runInContext(`${SDK_CORE}\nvar core = createRp({ post: function (m) { __out.push(JSON.parse(JSON.stringify(m))); } });`, ctx)
  const run = (code: string) => vm.runInContext(code, ctx)
  return { out, run, dispatch: (m: Msg) => run(`core.dispatch(${JSON.stringify(m)})`) }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('SDK core', () => {
  it('queues calls until init, then flushes in order and resolves ready', async () => {
    const t = load()
    t.run(`core.rp.notify('hi', 'success'); core.rp.storage.get('k');`)
    expect(t.out).toEqual([])
    t.dispatch({ t: 'init', info: { api: 1 } })
    expect(t.out.map((m) => (m as { method: string }).method)).toEqual(['notify', 'storage.get'])
    expect(await t.run('core.rp.ready')).toMatchObject({ api: 1 })
  })

  it('resolves and rejects calls from result messages', async () => {
    const t = load()
    t.dispatch({ t: 'init', info: {} })
    t.run(`var a = core.rp.chat.info(); var b = core.rp.state.get(); a.then(function (v) { globalThis.A = v }); b.catch(function (e) { globalThis.B = e.message });`)
    const [first, second] = t.out as { id: number }[]
    t.dispatch({ t: 'result', id: first.id, result: { chatId: 'c1' } })
    t.dispatch({ t: 'result', id: second.id, error: 'Needs permission' })
    await flush()
    expect(JSON.stringify(t.run('globalThis.A'))).toBe('{"chatId":"c1"}')
    expect(t.run('globalThis.B')).toBe('Needs permission')
  })

  it('maps SDK calls to bridge methods with defaults', () => {
    const t = load()
    t.dispatch({ t: 'init', info: {} })
    t.run(`
      var rp = core.rp;
      rp.chat.append('x'); rp.chat.append('y', { as: 'user' }); rp.chat.messages(5); rp.chat.send('go');
      rp.state.setFlag('met'); rp.state.setFlag('met', false); rp.state.addCoins(3); rp.state.giveItem('key');
      rp.facts.add('likes tea'); rp.storage.set('k', 1); rp.storage.keys('chat'); rp.generate('hello', { maxTokens: 9 });
    `)
    const calls = t.out.map((m) => [(m as Msg).method, (m as Msg).params])
    expect(calls).toEqual([
      ['chat.append', { text: 'x', as: 'char' }],
      ['chat.append', { text: 'y', as: 'user' }],
      ['chat.messages', { limit: 5 }],
      ['chat.send', { text: 'go' }],
      ['state.setFlag', { flag: 'met', on: true }],
      ['state.setFlag', { flag: 'met', on: false }],
      ['state.addCoins', { amount: 3 }],
      ['state.giveItem', { id: 'key', count: 1 }],
      ['facts.add', { text: 'likes tea', importance: 0.5 }],
      ['storage.set', { key: 'k', value: 1, scope: 'global' }],
      ['storage.keys', { scope: 'chat' }],
      ['generate', { prompt: 'hello', options: { maxTokens: 9 } }],
    ])
  })

  it('subscribes once per event, delivers payloads and unsubscribes; theme needs no subscription', () => {
    const t = load()
    t.dispatch({ t: 'init', info: {} })
    t.run(`
      globalThis.seen = [];
      globalThis.off = core.rp.on('message', function (p) { seen.push(p.text); });
      core.rp.on('message', function () {});
      core.rp.on('theme', function (p) { seen.push('theme:' + p.dark); });
    `)
    expect(t.out.filter((m) => (m as Msg).method === 'subscribe')).toHaveLength(1)
    t.dispatch({ t: 'event', event: 'message', payload: { text: 'a' } })
    t.dispatch({ t: 'theme', tokens: {}, dark: true })
    t.run('off()')
    t.dispatch({ t: 'event', event: 'message', payload: { text: 'b' } })
    expect(JSON.stringify(t.run('seen'))).toBe('["a","theme:true"]')
  })

  it('runs hooks and tools, reporting skips and errors', async () => {
    const t = load()
    t.dispatch({ t: 'init', info: {} })
    t.run(`
      core.rp.hook('output', function (text) { return text.toUpperCase(); });
      core.rp.hook('input', function () { throw new Error('boom'); });
      core.rp.tool('add', function (a) { return a.x + a.y; });
    `)
    t.dispatch({ t: 'hook', id: 1, name: 'output', payload: 'hi' })
    t.dispatch({ t: 'hook', id: 2, name: 'input', payload: 'hi' })
    t.dispatch({ t: 'hook', id: 3, name: 'context', payload: {} })
    t.dispatch({ t: 'tool', id: 4, name: 'add', args: { x: 2, y: 3 } })
    t.dispatch({ t: 'tool', id: 5, name: 'nope', args: {} })
    await flush()
    const byId = Object.fromEntries(t.out.filter((m) => 'id' in m && (m as Msg).t !== 'call').map((m) => [(m as { id: number }).id, m]))
    expect(byId[1]).toMatchObject({ t: 'hookResult', result: 'HI' })
    expect(byId[2]).toMatchObject({ t: 'hookResult', error: 'boom' })
    expect(byId[3]).toMatchObject({ t: 'hookResult', skipped: true })
    expect(byId[4]).toMatchObject({ t: 'toolResult', result: 5 })
    expect(byId[5]).toMatchObject({ t: 'toolResult', error: 'Unknown tool nope' })
  })

  it('only calls bridge methods the permission table knows about', () => {
    const methods = [...SDK_CORE.matchAll(/(?:call|scoped)\('([\w.]+)'/g)].map((m) => m[1])
    expect(methods.length).toBeGreaterThan(15)
    for (const method of methods) {
      expect(method === 'subscribe' || method in METHOD_PERMISSIONS, `${method} is missing from METHOD_PERMISSIONS`).toBe(true)
    }
  })
})

describe('boot scripts', () => {
  it('captures console output inside a worker-style global', () => {
    const out: Msg[] = []
    const ctx = vm.createContext({
      postMessage: (m: Msg) => out.push(JSON.parse(JSON.stringify(m))),
      addEventListener() {},
      console: { log() {}, info() {}, warn() {}, error() {} },
    })
    vm.runInContext(`var self = this;\n${SDK_CORE}\n${WORKER_BOOT}`, ctx)
    vm.runInContext(`self.onmessage({ data: { t: 'init', info: {} } })`, ctx)
    vm.runInContext(`console.log('a', { b: 1 }); console.warn('careful'); rp.log('direct');`, ctx)
    expect(out.map((m) => [m.level, m.text])).toEqual([
      ['log', 'a {"b":1}'],
      ['warn', 'careful'],
      ['log', 'direct'],
    ])
  })

  it('keeps the frame colour scheme in step with the app when the mode flips', () => {
    const classes = new Set<string>()
    const style = { colorScheme: '', props: {} as Record<string, string>, setProperty(k: string, v: string) { this.props[k] = v } }
    const documentElement = { style, classList: { toggle: (c: string, on: boolean) => void (on ? classes.add(c) : classes.delete(c)) }, getAttribute: () => null }
    const listeners: Record<string, (e: unknown) => void> = {}
    const win: Record<string, unknown> = { addEventListener: (t: string, fn: (e: unknown) => void) => void (listeners[t] = fn) }
    win.parent = win
    const ctx = vm.createContext({ window: win, document: { documentElement }, console: { log() {}, info() {}, warn() {}, error() {} } })
    vm.runInContext(`${SDK_CORE}
${PANEL_BOOT}`, ctx)
    const port: { onmessage?: (e: { data: unknown }) => void; postMessage: () => void } = { postMessage() {} }
    listeners.message({ source: win.parent, data: { t: 'init', info: {}, dark: false, tokens: { '--c-bg': '1 2 3' } }, ports: [port] })
    expect(style.colorScheme).toBe('light')
    port.onmessage!({ data: { t: 'theme', dark: true, tokens: { '--c-bg': '9 9 9' } } })
    expect(style.colorScheme).toBe('dark')
    expect(classes.has('dark')).toBe(true)
    expect(style.props['--c-bg']).toBe('9 9 9')
  })

  it('is syntactically valid JavaScript', () => {
    for (const src of [`${SDK_CORE}\n${PANEL_BOOT}`, `${SDK_CORE}\n${WORKER_BOOT}`, SCRIPT_RELAY_BOOT.replace('__WORKER_SOURCE__', '"x"')]) {
      expect(() => new vm.Script(src)).not.toThrow()
    }
  })

  it('has no template-literal hazards', () => {
    for (const src of [SDK_CORE, PANEL_BOOT, WORKER_BOOT, SCRIPT_RELAY_BOOT]) {
      expect(src).not.toContain('`')
      expect(src).not.toContain('${')
    }
  })
})
