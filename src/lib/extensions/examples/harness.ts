// Test helper: runs an example's background script against a fake `rp` so its hooks and event handlers can be called directly.

import vm from 'node:vm'
import type { ExtensionBundle } from '../manifest'

type Fn = (...args: any[]) => any

export interface FakeRpOptions {
  settings?: Record<string, unknown>
  messages?: { id?: string; role: string; name: string; text: string; createdAt?: number }[]
  /** Answers rp.generate; receives the prompt and options. */
  generate?: (prompt: string, opts: any) => string | Promise<string>
  random?: () => number
}

export async function runScript(bundle: ExtensionBundle, opts: FakeRpOptions = {}) {
  const hooks: Record<string, Fn> = {}
  const tools: Record<string, Fn> = {}
  const handlers: Record<string, Fn[]> = {}
  const store = new Map<string, unknown>()
  const calls: { method: string; args: unknown[] }[] = []
  const track =
    <T>(method: string, fn: (...a: any[]) => T) =>
    (...args: any[]) => {
      calls.push({ method, args })
      return fn(...args)
    }
  const key = (scope: string | undefined, k: string) => `${scope ?? 'global'}:${k}`
  const rp = {
    ready: Promise.resolve({ api: 1, permissions: bundle.manifest.permissions, settings: opts.settings ?? {} }),
    hook: (name: string, fn: Fn) => (hooks[name] = fn),
    tool: (name: string, fn: Fn) => (tools[name] = fn),
    on: (event: string, fn: Fn) => (handlers[event] ||= []).push(fn),
    log: () => undefined,
    notify: track('notify', async () => undefined),
    generate: track('generate', async (prompt: string, o: unknown) => (opts.generate ? opts.generate(prompt, o) : '[]')),
    settings: { all: async () => opts.settings ?? {} },
    storage: {
      get: async (k: string, scope?: string) => (store.has(key(scope, k)) ? structuredClone(store.get(key(scope, k))) : null),
      set: async (k: string, v: unknown, scope?: string) => void store.set(key(scope, k), structuredClone(v)),
      remove: async (k: string, scope?: string) => void store.delete(key(scope, k)),
      keys: async (scope?: string) => [...store.keys()].filter((x) => x.startsWith(`${scope ?? 'global'}:`)).map((x) => x.split(':').slice(1).join(':')),
    },
    chat: {
      info: async () => ({ chatId: 'c1', characterName: 'Mara', personaName: 'Kai' }),
      messages: async (n?: number) => (opts.messages ?? []).slice(-(n ?? 40)),
      append: track('chat.append', async () => undefined),
      send: track('chat.send', async () => undefined),
    },
    facts: { add: track('facts.add', async () => undefined), list: async () => [] },
  }
  const ctx = vm.createContext({ rp, console })
  if (opts.random) vm.runInContext('Math.random = __rng', Object.assign(ctx, { __rng: opts.random }))
  const code = bundle.files[bundle.manifest.script!] as string
  await vm.runInContext(`(async function(){\n${code}\n})()`, ctx)
  return {
    hooks,
    tools,
    store,
    calls,
    /** Fires every handler registered with rp.on(event) and waits for them. */
    async emit(event: string, payload: unknown) {
      await Promise.all((handlers[event] ?? []).map((fn) => fn(payload)))
    },
    input: (text: string) => hooks.input({ text, chatId: 'c1', characterName: 'Mara', personaName: 'Kai' }),
    context: (lastUserText = '') => hooks.context({ lastUserText, chatId: 'c1', characterName: 'Mara', personaName: 'Kai' }),
    output: (text: string) => hooks.output({ text, chatId: 'c1', characterName: 'Mara', personaName: 'Kai' }),
  }
}

/** A deterministic random() that cycles through the given fractions. */
export function sequence(...values: number[]) {
  let i = 0
  return () => values[i++ % values.length]
}

/** Evaluates a shared JS lib (one that defines `name`) in a fresh context with a seeded Math.random, and returns the named object. */
export function loadLib<T = any>(source: string, name: string, random?: () => number): T {
  const ctx = vm.createContext({ rp: {}, __rng: random })
  if (random) vm.runInContext('Math.random = __rng', ctx)
  return vm.runInContext(`${source}\n${name}`, ctx) as T
}
