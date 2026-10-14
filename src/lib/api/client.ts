import type { Character } from '@/lib/characters/cardSpec'
import type {
  Chat,
  ChatFact,
  CustomInstructTemplate,
  Objective,
  Persona,
  RelationshipEvent,
  SamplerPreset,
  StoredMessage,
  Theme,
  WorldCard,
  WorldInfoBook,
} from '@/lib/types'
import type { AssistantThread } from '@/lib/assistant/thread'
import type { AgentTool } from '@/lib/assistant/tools'
import type { ExtensionBundle, ExtensionRecord, ExtensionSource, Permission, SettingValue } from '@/lib/extensions/manifest'
import type { LintFinding } from '@/lib/extensions/lint'
import { toastError, toastSuccess, useToastStore } from '@/lib/store/useToastStore'

// The local API server runs on the same machine
const DEFAULT_TIMEOUT_MS = 15000

/** True for the 409 a save gets when what it edited has changed since it was loaded. */
export const isConflict = (e: unknown): boolean => (e as { status?: number } | null)?.status === 409

/** Every read/write in this file funnels through `request()` */
let unreachableToastId: string | null = null

function reportUnreachable(): void {
  if (unreachableToastId) return
  unreachableToastId = toastError(
    "Can't reach your local server. Nothing is being saved right now. Check that your dev server " +
      '(`npm run dev`) is still running, then try again.',
  )
}

function reportReachable(): void {
  if (!unreachableToastId) return
  useToastStore.getState().dismiss(unreachableToastId)
  unreachableToastId = null
  toastSuccess('Reconnected. Your local server is back.')
}

/** Test-only: `unreachableToastId` is deliberately module-level (one toast per outage, tracked
 *  across every call site), which otherwise leaks across test cases sharing this module instance. */
export function __resetUnreachableStateForTests(): void {
  unreachableToastId = null
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { notFoundIsUndefined?: boolean; timeoutMs?: number },
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(`${method} ${path} timed out after ${timeoutMs / 1000}s`)
    }
    // Anything else `fetch` throws on a same-origin relative URL
    reportUnreachable()
    throw e
  } finally {
    clearTimeout(timeout)
  }
  reportReachable()
  if (res.status === 404 && opts?.notFoundIsUndefined) return undefined as T
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // Validation errors (4xx) carry a message meant for people; show just that.
    const reason = res.status < 500 ? (() => { try { return (JSON.parse(text) as { error?: unknown } | null)?.error } catch { return null } })() : null
    if (typeof reason === 'string' && reason) throw Object.assign(new Error(reason), { status: res.status })
    throw new Error(`${method} ${path} failed (${res.status})${text ? `: ${text}` : ''}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// A local-server equivalent of Dexie's live-query
type Listener = () => void
const listeners = new Map<string, Set<Listener>>()

export function invalidate(resource: string): void {
  listeners.get(resource)?.forEach((fn) => fn())
}

export function subscribe(resource: string, fn: Listener): () => void {
  if (!listeners.has(resource)) listeners.set(resource, new Set())
  listeners.get(resource)!.add(fn)
  return () => listeners.get(resource)?.delete(fn)
}

function makeResource<T>(resource: string, path: string) {
  return {
    list(): Promise<T[]> {
      return request<T[]>('GET', path)
    },
    get(id: string): Promise<T | undefined> {
      return request<T | undefined>('GET', `${path}/${id}`, undefined, { notFoundIsUndefined: true })
    },
    async create(input: unknown): Promise<T> {
      const result = await request<T>('POST', path, input)
      invalidate(resource)
      return result
    },
    async update(id: string, patch: unknown): Promise<T> {
      const result = await request<T>('PUT', `${path}/${id}`, patch)
      invalidate(resource)
      return result
    },
    async remove(id: string): Promise<void> {
      await request<void>('DELETE', `${path}/${id}`)
      invalidate(resource)
    },
  }
}

export const charactersApi = {
  ...makeResource<Character>('characters', '/characters'),
  // Cascades server-side (deletes the character's chats, messages, and objectives too).
  async remove(id: string): Promise<void> {
    await request<void>('DELETE', `/characters/${id}`)
    invalidate('characters')
    invalidate('chats')
    invalidate('messages')
    invalidate('objectives')
  },
}
export const personasApi = makeResource<Persona>('personas', '/personas')
/** Plain assistant conversations (`lib/assistant/`) — no character, no relationship track. */
export const assistantThreadsApi = makeResource<AssistantThread>('assistant-threads', '/assistant-threads')
export const chatsApi = {
  ...makeResource<Chat>('chats', '/chats'),
  // Soft delete — the chat moves to the trash (`trash`/`restore`/`purge` below) rather than being destroyed immediately.
  async remove(id: string): Promise<void> {
    await request<void>('DELETE', `/chats/${id}`)
    invalidate('chats')
  },
  /** Chats currently in the trash, most recently deleted first. */
  async trash(): Promise<Chat[]> {
    return request<Chat[]>('GET', '/chats/trash')
  },
  /** Moves a trashed chat back into the normal chat list. */
  async restore(id: string): Promise<Chat> {
    const result = await request<Chat>('POST', `/chats/${id}/restore`)
    invalidate('chats')
    return result
  },
  /** Permanently deletes a chat and everything that cascades from it (messages, objectives, relationship history) — cannot be undone. */
  async purge(id: string): Promise<void> {
    await request<void>('DELETE', `/chats/${id}/purge`)
    invalidate('chats')
    invalidate('messages')
    invalidate('objectives')
  },
  // Creates a new chat that branches off this one, carrying its relationship/gift/gallery state and a copy of the transcript up to…
  async fork(id: string, messageId?: string): Promise<Chat> {
    const result = await request<Chat>('POST', `/chats/${id}/fork`, { messageId })
    invalidate('chats')
    invalidate('messages')
    invalidate('objectives')
    return result
  },
}
export const worldInfoBooksApi = makeResource<WorldInfoBook>('world-info-books', '/world-info-books')
export const presetsApi = makeResource<SamplerPreset>('presets', '/presets')
export const themesApi = makeResource<Theme>('themes', '/themes')
export const instructTemplatesApi = makeResource<CustomInstructTemplate>('instruct-templates', '/instruct-templates')
export const worldsApi = {
  ...makeResource<WorldCard>('worlds', '/worlds'),
  // Un-assigns any characters living here server-side, rather than deleting them.
  async remove(id: string): Promise<void> {
    await request<void>('DELETE', `/worlds/${id}`)
    invalidate('worlds')
    invalidate('characters')
  },
}

export const messagesApi = {
  ...makeResource<StoredMessage>('messages', '/messages'),
  listByChat(chatId: string): Promise<StoredMessage[]> {
    return request<StoredMessage[]>('GET', `/chats/${chatId}/messages`)
  },
  /** Substring search across every chat's messages, newest first, capped server-side to 50 hits. */
  search(query: string): Promise<StoredMessage[]> {
    return request<StoredMessage[]>('GET', `/messages/search?q=${encodeURIComponent(query)}`)
  },
}

// A full backup/restore inlines every avatar/sprite/background as base64
const BACKUP_TIMEOUT_MS = 120000

export const backupApi = {
  fetchBackup(): Promise<unknown> {
    return request<unknown>('GET', '/backup', undefined, { timeoutMs: BACKUP_TIMEOUT_MS })
  },
  async restore(backup: unknown): Promise<void> {
    await request<void>('POST', '/restore', backup, { timeoutMs: BACKUP_TIMEOUT_MS })
    for (const resource of [
      'characters',
      'personas',
      'chats',
      'messages',
      'world-info-books',
      'presets',
      'themes',
      'worlds',
      'objectives',
      'relationship-events',
      'chat-facts',
      'extensions',
    ]) {
      invalidate(resource)
    }
  },
}

export const objectivesApi = {
  ...makeResource<Objective>('objectives', '/objectives'),
  getActive(chatId: string): Promise<Objective | undefined> {
    return request<Objective | null>('GET', `/objectives/active?chatId=${encodeURIComponent(chatId)}`).then(
      (o) => o ?? undefined,
    )
  },
  listByChat(chatId: string, status?: string): Promise<Objective[]> {
    const statusQuery = status ? `&status=${encodeURIComponent(status)}` : ''
    return request<Objective[]>('GET', `/objectives?chatId=${encodeURIComponent(chatId)}${statusQuery}`)
  },
}

export const relationshipEventsApi = {
  ...makeResource<RelationshipEvent>('relationship-events', '/relationship-events'),
  listByChat(chatId: string): Promise<RelationshipEvent[]> {
    return request<RelationshipEvent[]>('GET', `/chats/${chatId}/relationship-events`)
  },
}

export const chatFactsApi = {
  ...makeResource<ChatFact>('chat-facts', '/chat-facts'),
  listByChat(chatId: string): Promise<ChatFact[]> {
    return request<ChatFact[]>('GET', `/chats/${chatId}/chat-facts`)
  },
}

export interface ExtensionInstallResult {
  record: ExtensionRecord
  created: boolean
  newPermissions: Permission[]
  warnings: string[]
}

export interface ExtensionFileInfo {
  path: string
  size: number
  mime: string
}

export interface ExtensionFileContent {
  path: string
  content: string
  encoding: 'utf8' | 'base64'
  mime: string
}

export interface ExtensionValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
  lint: LintFinding[]
}

export interface McpSettingsView {
  enabled: boolean
  readOnly: boolean
  token: string
  apiPort: number
  mcpPort: number
  scriptPath: string
}

export interface WorkspaceConfig {
  root: string
  allowCommands: boolean
}

export interface MemoryNote {
  id: string
  text: string
  createdAt: number
}

/** The tools the in-app Assistant can call (the library tools MCP agents get, workspace/web/memory tools, and connected servers). */
export const agentApi = {
  tools: () => request<AgentTool[]>('GET', '/agent/tools'),
  /** `confirmed` is true once the user approved a risky call (an edit or a command). A picture the tool returns comes back in `images`. */
  call: (name: string, args: Record<string, unknown>, allowWrites: boolean, confirmed = false) =>
    request<{ text: string; isError: boolean; images?: string[] }>('POST', '/agent/call', { name, arguments: args, allowWrites, confirmed }, { timeoutMs: 180000 }),
  saveImage: (path: string, dataUrl: string, confirmed: boolean) =>
    request<{ text: string; isError: boolean }>('POST', '/agent/save-image', { path, dataUrl, allowWrites: true, confirmed }, { timeoutMs: 60000 }),
  workspace: () => request<WorkspaceConfig>('GET', '/agent/workspace'),
  setWorkspace: (config: WorkspaceConfig) => request<WorkspaceConfig>('PUT', '/agent/workspace', config),
  memory: () => request<MemoryNote[]>('GET', '/agent/memory'),
  addMemory: (text: string) => request<MemoryNote>('POST', '/agent/memory', { text }),
  removeMemory: (id: string) => request<void>('DELETE', `/agent/memory/${id}`),
}

export interface McpServerView {
  id: string
  name: string
  url: string
  hasKey: boolean
  tools: number | null
}

/** Other MCP servers whose tools the in-app Assistant can use. */
export const mcpServersApi = {
  list: () => request<McpServerView[]>('GET', '/mcp/servers'),
  async add(input: { name: string; url: string; token?: string }): Promise<McpServerView> {
    const result = await request<McpServerView>('POST', '/mcp/servers', input, { timeoutMs: 60000 })
    invalidate('mcp-servers')
    return result
  },
  async remove(id: string): Promise<void> {
    await request<void>('DELETE', `/mcp/servers/${id}`)
    invalidate('mcp-servers')
  },
}

/** Agent access (MCP): the switch, read-only mode and the connection token. */
export const mcpApi = {
  get: () => request<McpSettingsView>('GET', '/mcp/settings'),
  async update(patch: { enabled?: boolean; readOnly?: boolean }): Promise<McpSettingsView> {
    const result = await request<McpSettingsView>('PUT', '/mcp/settings', patch)
    invalidate('mcp')
    return result
  },
  async rotateToken(): Promise<McpSettingsView> {
    const result = await request<McpSettingsView>('POST', '/mcp/token', {})
    invalidate('mcp')
    return result
  },
}

/** Extensions (`lib/extensions/`): installed bundles, their files, grants and scoped key-value data. */
export const extensionsApi = {
  list: () => request<ExtensionRecord[]>('GET', '/extensions'),
  get: (id: string) => request<ExtensionRecord | undefined>('GET', `/extensions/${id}`, undefined, { notFoundIsUndefined: true }),
  bundle: (id: string) => request<ExtensionBundle>('GET', `/extensions/${id}/bundle`),
  files: (id: string) => request<ExtensionFileInfo[]>('GET', `/extensions/${id}/files`),
  readFile: (id: string, path: string) => request<ExtensionFileContent>('GET', `/extensions/${id}/file?path=${encodeURIComponent(path)}`),
  lint: (id: string) => request<LintFinding[]>('GET', `/extensions/${id}/lint`),
  validate: (body: unknown) => request<ExtensionValidation>('POST', '/extensions/validate', body),
  async install(bundle: unknown, source: ExtensionSource = 'local'): Promise<ExtensionInstallResult> {
    const result = await request<ExtensionInstallResult>('POST', `/extensions/install?source=${source}`, bundle, { timeoutMs: 60000 })
    invalidate('extensions')
    return result
  },
  async setState(id: string, patch: { enabled?: boolean; grants?: Permission[]; settings?: Record<string, SettingValue> }): Promise<ExtensionRecord> {
    const result = await request<ExtensionRecord>('PUT', `/extensions/${id}`, patch)
    invalidate('extensions')
    return result
  },
  async remove(id: string): Promise<void> {
    await request<void>('DELETE', `/extensions/${id}`)
    invalidate('extensions')
  },
  async writeFile(id: string, path: string, content: string): Promise<ExtensionRecord> {
    const result = await request<ExtensionRecord>('PUT', `/extensions/${id}/file`, { path, content })
    invalidate('extensions')
    return result
  },
  async deleteFile(id: string, path: string): Promise<ExtensionRecord> {
    const result = await request<ExtensionRecord>('DELETE', `/extensions/${id}/file?path=${encodeURIComponent(path)}`)
    invalidate('extensions')
    return result
  },
  async setManifest(id: string, manifest: unknown): Promise<ExtensionRecord> {
    const result = await request<ExtensionRecord>('PUT', `/extensions/${id}/manifest`, manifest)
    invalidate('extensions')
    return result
  },
  kvList: (id: string, scope: string, scopeId: string) =>
    request<Record<string, unknown>>('GET', `/extensions/${id}/data?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}`),
  kvSet: (id: string, scope: string, scopeId: string, key: string, value: unknown) =>
    request<void>('PUT', `/extensions/${id}/data`, { scope, scopeId, key, value }),
  kvRemove: (id: string, scope: string, scopeId: string, key: string) =>
    request<void>('DELETE', `/extensions/${id}/data?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}&key=${encodeURIComponent(key)}`),
}

export type VectorScope = 'global' | 'character' | 'chat'

export interface VectorSource {
  source: string
  sourceName: string
  chunks: number
  dim: number
  createdAt: number
}

export interface VectorHit {
  id: string
  text: string
  score: number
  source: string
  sourceName: string
  scope: VectorScope
}

/** Stored text chunks and their embeddings (see `server/vectors.ts`). Search runs on the server. */
export const vectorsApi = {
  async index(scope: VectorScope, scopeId: string, source: string, sourceName: string, chunks: { text: string; vector: number[] }[]): Promise<{ chunks: number }> {
    const r = await request<{ chunks: number }>('POST', '/vectors/index', { scope, scopeId, source, sourceName, chunks }, { timeoutMs: 120_000 })
    invalidate('vector-sources')
    return r
  },
  sources(scope: VectorScope, scopeId = ''): Promise<VectorSource[]> {
    return request<VectorSource[]>('GET', `/vectors/sources?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}`)
  },
  async removeSource(scope: VectorScope, scopeId: string, source: string): Promise<void> {
    await request<void>('DELETE', `/vectors/source?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}&source=${encodeURIComponent(source)}`)
    invalidate('vector-sources')
  },
  async removeScope(scope: VectorScope, scopeId = ''): Promise<void> {
    await request<void>('DELETE', `/vectors/scope?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}`)
    invalidate('vector-sources')
  },
  search(targets: { scope: VectorScope; scopeId?: string }[], vector: number[], opts: { k?: number; minScore?: number; excludeSources?: string[] } = {}): Promise<VectorHit[]> {
    return request<VectorHit[]>('POST', '/vectors/search', { targets, vector, ...opts })
  },
}
