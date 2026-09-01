import type { Character } from '@/lib/characters/cardSpec'
import type {
  Chat,
  Objective,
  Persona,
  SamplerPreset,
  StoredMessage,
  Theme,
  WorldCard,
  WorldInfoBook,
} from '@/lib/types'

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { notFoundIsUndefined?: boolean },
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
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
}
export const worldInfoBooksApi = makeResource<WorldInfoBook>('world-info-books', '/world-info-books')
export const presetsApi = makeResource<SamplerPreset>('presets', '/presets')
export const themesApi = makeResource<Theme>('themes', '/themes')
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
