// Similarity search over a chat's older messages and the writer's documents: indexing them, and finding what matches what was just said.

import type { VectorHit, VectorScope, VectorSource } from '@/lib/api/client'
import { chunkText } from './chunk'
import type { EmbeddingConfig } from './embeddings'

export interface MemoryDeps {
  embed: (texts: string[]) => Promise<number[][]>
  api: {
    index: (scope: VectorScope, scopeId: string, source: string, sourceName: string, chunks: { text: string; vector: number[] }[]) => Promise<unknown>
    sources: (scope: VectorScope, scopeId?: string) => Promise<VectorSource[]>
    search: (targets: { scope: VectorScope; scopeId?: string }[], vector: number[], opts?: { k?: number; minScore?: number; excludeSources?: string[] }) => Promise<VectorHit[]>
  }
}

/** The embeddings address: the writer's own, else the chat server's (KoboldCpp or the OpenAI-compatible one). */
export function embeddingConfigFrom(s: {
  embeddingsBaseUrl: string
  embeddingsApiKey: string
  embeddingsModel: string
  chatBackend: string
  baseUrl: string
  chatBackendBaseUrl: string
  chatBackendApiKey: string
}): EmbeddingConfig {
  if (s.embeddingsBaseUrl.trim()) return { baseUrl: s.embeddingsBaseUrl, apiKey: s.embeddingsApiKey, model: s.embeddingsModel }
  const hosted = s.chatBackend === 'openai-compatible'
  return { baseUrl: hosted ? s.chatBackendBaseUrl : s.baseUrl, apiKey: hosted ? s.chatBackendApiKey : '', model: s.embeddingsModel }
}

export const MESSAGE_SOURCE = (id: string) => `msg:${id}`

/** Chunks, embeds and stores one document under a scope. Replaces an earlier version with the same source id. */
export async function indexDocument(
  deps: MemoryDeps,
  scope: VectorScope,
  scopeId: string,
  source: string,
  name: string,
  text: string,
  chunkChars = 800,
): Promise<number> {
  const pieces = chunkText(text, { maxChars: chunkChars, overlap: Math.round(chunkChars / 8) })
  if (!pieces.length) throw new Error('That document has no text in it.')
  const vectors = await deps.embed(pieces)
  await deps.api.index(scope, scopeId, source, name, pieces.map((t, i) => ({ text: t, vector: vectors[i] })))
  return pieces.length
}

export interface IndexableMessage {
  id: string
  name: string
  text: string
  failed?: boolean
}

/** Stores messages that are not in the chat's memory yet, oldest first, at most `max` per call so a long chat catches up over several replies. Returns how many it added. */
export async function indexMessages(deps: MemoryDeps, chatId: string, messages: IndexableMessage[], max = 24, chunkChars = 800): Promise<number> {
  const known = new Set((await deps.api.sources('chat', chatId)).map((s) => s.source))
  const todo = messages.filter((m) => !m.failed && m.text.trim() && !known.has(MESSAGE_SOURCE(m.id))).slice(0, max)
  if (!todo.length) return 0
  const perMessage = todo.map((m) => chunkText(`${m.name}: ${m.text.trim()}`, { maxChars: chunkChars, overlap: 0 }))
  const vectors = await deps.embed(perMessage.flat())
  let at = 0
  for (let i = 0; i < todo.length; i += 1) {
    const pieces = perMessage[i]
    const chunks = pieces.map((text) => ({ text, vector: vectors[at++] }))
    await deps.api.index('chat', chatId, MESSAGE_SOURCE(todo[i].id), todo[i].name, chunks)
  }
  return todo.length
}

export interface RetrieveOptions {
  chatId?: string
  characterId?: string
  /** Messages already in the prompt, which would only repeat themselves. */
  skipMessageIds?: string[]
  k?: number
  minScore?: number
  /** Whether to look in this chat's own memory (documents are always searched). */
  chatMemory?: boolean
}

/** The passages that best match `query`, formatted for the prompt. Documents are labelled with their name. */
export async function retrieveMemories(deps: MemoryDeps, query: string, opts: RetrieveOptions = {}): Promise<string[]> {
  if (!query.trim()) return []
  const targets: { scope: VectorScope; scopeId?: string }[] = [{ scope: 'global' }]
  if (opts.characterId) targets.push({ scope: 'character', scopeId: opts.characterId })
  if (opts.chatId && opts.chatMemory !== false) targets.push({ scope: 'chat', scopeId: opts.chatId })
  const [vector] = await deps.embed([query.trim().slice(0, 2000)])
  const hits = await deps.api.search(targets, vector, {
    k: opts.k ?? 4,
    minScore: opts.minScore ?? 0.3,
    excludeSources: (opts.skipMessageIds ?? []).map(MESSAGE_SOURCE),
  })
  return hits.map((h) => (h.scope === 'chat' ? h.text : `[${h.sourceName}] ${h.text}`))
}
