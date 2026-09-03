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

// The local API server runs on the same machine, but a wedged Node process (or a very large
// backup/restore payload) shouldn't be able to hang a call forever with no way out.
const DEFAULT_TIMEOUT_MS = 15000

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
    throw e
  } finally {
    clearTimeout(timeout)
  }
  if (res.status === 404 && opts?.notFoundIsUndefined) return undefined as T
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${method} ${path} failed (${res.status})${text ? `: ${text}` : ''}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// A local-server equivalent of Dexie's live-query: every mutating call below announces
// which resource changed, and useApiQuery (src/lib/hooks/useApiQuery.ts) re-fetches
// wherever that resource is being read — including the very same hook that just wrote it.
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
export const chatsApi = {
  ...makeResource<Chat>('chats', '/chats'),
  // Cascades server-side (deletes the chat's messages and objectives too).
  async remove(id: string): Promise<void> {
    await request<void>('DELETE', `/chats/${id}`)
    invalidate('chats')
    invalidate('messages')
    invalidate('objectives')
  },
  // Creates a new chat that branches off this one, carrying its relationship/gift/gallery
  // state and a copy of the transcript up to (and including) `messageId` — or the whole
  // transcript, if omitted.
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

// A full backup/restore inlines every avatar/sprite/background as base64 — on a
// data-heavy install this can legitimately take much longer than the default timeout.
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
