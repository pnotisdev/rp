// Host-side bridge: checks grants, validates arguments and rate-limits every call a sandboxed extension makes.

import { EVENT_PERMISSIONS, METHOD_PERMISSIONS, LIMITS, type Permission, type SettingValue } from './manifest'

export type KvScopeName = 'global' | 'chat' | 'character' | 'world'
export type NotifyKind = 'info' | 'success' | 'error'

export interface ChatInfoOut {
  chatId: string
  title: string
  characterId: string
  characterName: string
  personaName: string
  worldId: string | null
  worldName: string | null
  mode: string | null
}
export interface MessageOut {
  id: string
  role: 'user' | 'char'
  name: string
  text: string
  createdAt: number
}
export interface StateOut {
  affection: number
  warmth: number
  stage: string
  stats: Record<string, number>
  flags: string[]
  commitment: string
  coins: number
  inventory: Record<string, number>
  day: number | null
  phase: string | null
}
export interface LoreBookOut {
  id: string
  name: string
  entries: number
}
export interface LoreEntryOut {
  id: number
  keys: string[]
  content: string
  comment: string
  enabled: boolean
}
export interface FactOut {
  id: string
  text: string
  importance: number
}
export interface CharacterOut {
  id: string
  name: string
  tags: string[]
}

/** Everything the app does on an extension's behalf; the bridge is the only caller. */
export interface HostApi {
  scopeId(scope: Exclude<KvScopeName, 'global'>): Promise<string | null>
  kvList(extId: string, scope: KvScopeName, scopeId: string): Promise<Record<string, unknown>>
  kvSet(extId: string, scope: KvScopeName, scopeId: string, key: string, value: unknown): Promise<void>
  kvRemove(extId: string, scope: KvScopeName, scopeId: string, key: string): Promise<void>
  notify(source: string, text: string, kind: NotifyKind): void
  chatInfo(): Promise<ChatInfoOut | null>
  chatMessages(limit: number): Promise<MessageOut[]>
  chatAppend(text: string, as: 'char' | 'user'): Promise<MessageOut>
  chatSend(text: string): Promise<void>
  stateGet(): Promise<StateOut | null>
  stateSetFlag(flag: string, on: boolean): Promise<string[]>
  stateAddCoins(amount: number): Promise<number>
  stateGiveItem(id: string, count: number): Promise<Record<string, number>>
  loreBooks(): Promise<LoreBookOut[]>
  loreEntries(bookId: string): Promise<LoreEntryOut[]>
  loreAdd(bookId: string, entry: { keys: string[]; content: string; comment: string }): Promise<LoreEntryOut>
  loreRemove(bookId: string, entryId: number): Promise<void>
  factsList(): Promise<FactOut[]>
  factsAdd(text: string, importance: number): Promise<FactOut>
  charactersList(): Promise<CharacterOut[]>
  generate(prompt: string, opts: { system: string; maxTokens: number; temperature: number }): Promise<string>
}

export interface BridgeEnv {
  extId: string
  extName: string
  host: HostApi
  grants: () => readonly Permission[]
  settings: () => Record<string, SettingValue>
  subscribe: (event: string) => void
  onResize?: (height: number) => void
  onClose?: () => void
  now?: () => number
}

export interface Bridge {
  handle(method: string, params: unknown): Promise<unknown>
}

const SCOPES: KvScopeName[] = ['global', 'chat', 'character', 'world']
const FLAG_RE = /^[a-zA-Z0-9_-]{1,60}$/

type Params = Record<string, unknown>

function obj(v: unknown): Params {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Params) : {}
}
function str(v: unknown, name: string, max: number, opts: { empty?: boolean } = {}): string {
  if (typeof v !== 'string') throw new Error(`"${name}" must be a string`)
  if (!opts.empty && !v.trim()) throw new Error(`"${name}" must not be empty`)
  if (v.length > max) throw new Error(`"${name}" is too long (max ${max} characters)`)
  return v
}
function int(v: unknown, name: string, lo: number, hi: number, fallback?: number): number {
  if (v === undefined && fallback !== undefined) return fallback
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`"${name}" must be a number`)
  return Math.max(lo, Math.min(hi, Math.round(v)))
}
function num(v: unknown, name: string, lo: number, hi: number, fallback: number): number {
  if (v === undefined) return fallback
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`"${name}" must be a number`)
  return Math.max(lo, Math.min(hi, v))
}
function scopeOf(v: unknown): KvScopeName {
  if (!SCOPES.includes(v as KvScopeName)) throw new Error(`"scope" must be one of ${SCOPES.join(', ')}`)
  return v as KvScopeName
}

/** Sliding-window counter: at most `max` hits per `windowMs`. */
export class RateLimiter {
  private hits: number[] = []
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  take(now: number): boolean {
    this.hits = this.hits.filter((t) => now - t < this.windowMs)
    if (this.hits.length >= this.max) return false
    this.hits.push(now)
    return true
  }
}

function limitGroup(method: string): { name: string; max: number; windowMs: number } | undefined {
  if (method === 'notify') return { name: 'notify', max: 5, windowMs: 10_000 }
  if (method === 'generate') return { name: 'generate', max: 6, windowMs: 60_000 }
  if (method === 'storage.set' || method === 'storage.remove') return { name: 'storage', max: 80, windowMs: 10_000 }
  if (/^(chat\.(append|send)|state\.(setFlag|addCoins|giveItem)|lore\.(add|remove)|facts\.add)$/.test(method)) return { name: 'write', max: 20, windowMs: 10_000 }
  return undefined
}

export function createBridge(env: BridgeEnv): Bridge {
  const limiters = new Map<string, RateLimiter>()
  const clock = env.now ?? (() => Date.now())
  const { host } = env

  function need(permission: Permission): void {
    if (!env.grants().includes(permission)) {
      throw new Error(`Permission denied: "${env.extName}" needs the "${permission}" permission, and it has not been granted.`)
    }
  }

  function throttle(method: string): void {
    const group = limitGroup(method)
    if (!group) return
    let limiter = limiters.get(group.name)
    if (!limiter) {
      limiter = new RateLimiter(group.max, group.windowMs)
      limiters.set(group.name, limiter)
    }
    if (!limiter.take(clock())) throw new Error(`Slow down: too many "${method}" calls. Try again in a moment.`)
  }

  async function resolveScope(scopeIn: unknown): Promise<{ scope: KvScopeName; scopeId: string }> {
    const scope = scopeOf(scopeIn)
    if (scope === 'global') return { scope, scopeId: '' }
    const id = await host.scopeId(scope)
    if (!id) throw new Error(`No ${scope} is open, so "${scope}" storage is unavailable right now.`)
    return { scope, scopeId: id }
  }

  async function dispatch(method: string, p: Params): Promise<unknown> {
    switch (method) {
      case 'subscribe': {
        const event = str(p.event, 'event', 40)
        if (!Object.prototype.hasOwnProperty.call(EVENT_PERMISSIONS, event)) throw new Error(`Unknown event "${event}". Known: ${Object.keys(EVENT_PERMISSIONS).join(', ')}`)
        const required = EVENT_PERMISSIONS[event]
        if (required) need(required)
        env.subscribe(event)
        return null
      }
      case 'notify': {
        const kind = p.kind === 'success' || p.kind === 'error' ? p.kind : 'info'
        host.notify(env.extName, str(p.text, 'text', 300), kind)
        return null
      }
      case 'resize':
        env.onResize?.(int(p.height, 'height', 40, 2000))
        return null
      case 'close':
        env.onClose?.()
        return null
      case 'settings.all':
        return env.settings()
      case 'storage.get': {
        const { scope, scopeId } = await resolveScope(p.scope)
        const all = await host.kvList(env.extId, scope, scopeId)
        const key = str(p.key, 'key', LIMITS.kvKeyLength)
        return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : null
      }
      case 'storage.keys': {
        const { scope, scopeId } = await resolveScope(p.scope)
        return Object.keys(await host.kvList(env.extId, scope, scopeId))
      }
      case 'storage.set': {
        const { scope, scopeId } = await resolveScope(p.scope)
        const key = str(p.key, 'key', LIMITS.kvKeyLength)
        const json = JSON.stringify(p.value === undefined ? null : p.value)
        if (json === undefined || json.length > LIMITS.kvValueBytes) throw new Error(`Stored values must be JSON and at most ${LIMITS.kvValueBytes} bytes.`)
        await host.kvSet(env.extId, scope, scopeId, key, JSON.parse(json))
        return null
      }
      case 'storage.remove': {
        const { scope, scopeId } = await resolveScope(p.scope)
        await host.kvRemove(env.extId, scope, scopeId, str(p.key, 'key', LIMITS.kvKeyLength))
        return null
      }
      case 'chat.info':
        return host.chatInfo()
      case 'chat.messages':
        return host.chatMessages(int(p.limit, 'limit', 1, 200, 40))
      case 'chat.append':
        return host.chatAppend(str(p.text, 'text', 20_000), p.as === 'user' ? 'user' : 'char')
      case 'chat.send':
        await host.chatSend(str(p.text, 'text', 8000))
        return null
      case 'state.get':
        return host.stateGet()
      case 'state.setFlag': {
        const flag = str(p.flag, 'flag', 60)
        if (!FLAG_RE.test(flag)) throw new Error('"flag" may only use letters, digits, dashes and underscores')
        return host.stateSetFlag(flag, p.on !== false)
      }
      case 'state.addCoins':
        return host.stateAddCoins(int(p.amount, 'amount', -1000, 1000))
      case 'state.giveItem':
        return host.stateGiveItem(str(p.id, 'id', 80), int(p.count, 'count', 1, 99, 1))
      case 'lore.books':
        return host.loreBooks()
      case 'lore.entries':
        return host.loreEntries(str(p.bookId, 'bookId', 80))
      case 'lore.add': {
        const entry = obj(p.entry)
        const keys = Array.isArray(entry.keys) ? entry.keys.map((k) => str(k, 'entry.keys[]', 80)).slice(0, 20) : []
        return host.loreAdd(str(p.bookId, 'bookId', 80), {
          keys,
          content: str(entry.content, 'entry.content', 4000),
          comment: typeof entry.comment === 'string' ? entry.comment.slice(0, 200) : '',
        })
      }
      case 'lore.remove':
        await host.loreRemove(str(p.bookId, 'bookId', 80), int(p.entryId, 'entryId', 0, 1_000_000))
        return null
      case 'facts.list':
        return host.factsList()
      case 'facts.add':
        return host.factsAdd(str(p.text, 'text', 500), num(p.importance, 'importance', 0, 1, 0.5))
      case 'characters.list':
        return host.charactersList()
      case 'generate': {
        const o = obj(p.options)
        return host.generate(str(p.prompt, 'prompt', 12_000), {
          system: typeof o.system === 'string' ? o.system.slice(0, 4000) : '',
          maxTokens: int(o.maxTokens, 'maxTokens', 1, 1000, 300),
          temperature: num(o.temperature, 'temperature', 0, 2, 0.8),
        })
      }
    }
    throw new Error(`Unknown method "${method}"`)
  }

  return {
    async handle(method, params) {
      if (method !== 'subscribe' && !Object.prototype.hasOwnProperty.call(METHOD_PERMISSIONS, method)) throw new Error(`Unknown method "${method}"`)
      const required = method === 'subscribe' ? null : METHOD_PERMISSIONS[method]
      if (required) need(required)
      throttle(method)
      return dispatch(method, obj(params))
    },
  }
}
