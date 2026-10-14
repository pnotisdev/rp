import { describe, expect, it, vi } from 'vitest'
import type { VectorHit, VectorSource } from '@/lib/api/client'
import { embeddingConfigFrom, indexDocument, indexMessages, retrieveMemories, type MemoryDeps } from './memory'

/** A fake embedder: the vector says how many characters the text has. */
const embed = vi.fn(async (texts: string[]) => texts.map((t) => [t.length, 1]))

function deps(over: { sources?: VectorSource[]; hits?: VectorHit[] } = {}) {
  const index = vi.fn(async (..._a: Parameters<MemoryDeps['api']['index']>) => ({ chunks: 0 }))
  const sources = vi.fn(async () => over.sources ?? [])
  const search = vi.fn(async (..._a: Parameters<MemoryDeps['api']['search']>) => over.hits ?? [])
  return { embed, api: { index, sources, search } } satisfies MemoryDeps
}

const base = { embeddingsBaseUrl: '', embeddingsApiKey: '', embeddingsModel: '', chatBackend: 'koboldcpp', baseUrl: 'http://localhost:5001', chatBackendBaseUrl: 'https://api.example/v1', chatBackendApiKey: 'sk-1' }

describe('embeddingConfigFrom', () => {
  it('prefers the writer\'s own embeddings server', () => {
    expect(embeddingConfigFrom({ ...base, embeddingsBaseUrl: 'http://emb:8080', embeddingsApiKey: 'k', embeddingsModel: 'nomic' })).toEqual({ baseUrl: 'http://emb:8080', apiKey: 'k', model: 'nomic' })
  })

  it('falls back to KoboldCpp, or to the hosted server with its key', () => {
    expect(embeddingConfigFrom(base)).toEqual({ baseUrl: 'http://localhost:5001', apiKey: '', model: '' })
    expect(embeddingConfigFrom({ ...base, chatBackend: 'openai-compatible' })).toEqual({ baseUrl: 'https://api.example/v1', apiKey: 'sk-1', model: '' })
  })
})

describe('indexDocument', () => {
  it('chunks, embeds and stores the text under its source', async () => {
    const d = deps()
    const n = await indexDocument(d, 'character', 'c1', 'doc:1', 'Lore.txt', 'First paragraph.\n\nSecond paragraph.')
    expect(n).toBe(1)
    expect(d.api.index).toHaveBeenCalledWith('character', 'c1', 'doc:1', 'Lore.txt', [{ text: 'First paragraph.\n\nSecond paragraph.', vector: [35, 1] }])
  })

  it('refuses an empty document', async () => {
    await expect(indexDocument(deps(), 'global', '', 'doc:2', 'Empty', '  \n ')).rejects.toThrow(/no text/)
  })
})

describe('indexMessages', () => {
  const msgs = [
    { id: 'a', name: 'Mira', text: 'Hello there.' },
    { id: 'b', name: 'Kai', text: 'Hi.' },
    { id: 'c', name: 'Mira', text: '' },
    { id: 'd', name: 'Mira', text: 'Failed one', failed: true },
    { id: 'e', name: 'Kai', text: 'Already stored.' },
  ]

  it('stores only new, non-empty, successful messages, each as its own source', async () => {
    const d = deps({ sources: [{ source: 'msg:e', sourceName: 'Kai', chunks: 1, dim: 2, createdAt: 0 }] })
    expect(await indexMessages(d, 'chat1', msgs)).toBe(2)
    expect(d.api.index).toHaveBeenCalledTimes(2)
    expect(d.api.index.mock.calls.map((c) => c[2])).toEqual(['msg:a', 'msg:b'])
    expect(d.api.index.mock.calls[0][4]).toEqual([{ text: 'Mira: Hello there.', vector: [18, 1] }])
  })

  it('does nothing, and embeds nothing, when everything is stored', async () => {
    embed.mockClear()
    const d = deps({ sources: msgs.map((m) => ({ source: `msg:${m.id}`, sourceName: m.name, chunks: 1, dim: 2, createdAt: 0 })) })
    expect(await indexMessages(d, 'chat1', msgs)).toBe(0)
    expect(embed).not.toHaveBeenCalled()
  })

  it('takes at most `max` per call, oldest first', async () => {
    const d = deps()
    expect(await indexMessages(d, 'chat1', msgs, 1)).toBe(1)
    expect(d.api.index.mock.calls[0][2]).toBe('msg:a')
  })
})

describe('retrieveMemories', () => {
  const hit = (over: Partial<VectorHit>): VectorHit => ({ id: 'x', text: 'text', score: 0.8, source: 'doc:1', sourceName: 'Notes', scope: 'global', ...over })

  it('searches documents, the character and the chat, skipping what is already in the prompt', async () => {
    const d = deps({ hits: [hit({ text: 'A fact.' }), hit({ scope: 'chat', source: 'msg:1', sourceName: 'Mira', text: 'Mira: I remember.' })] })
    const out = await retrieveMemories(d, 'what happened at the harbor', { chatId: 'c1', characterId: 'ch1', skipMessageIds: ['m9'], k: 3, minScore: 0.4 })
    expect(out).toEqual(['[Notes] A fact.', 'Mira: I remember.'])
    expect(d.api.search).toHaveBeenCalledWith([{ scope: 'global' }, { scope: 'character', scopeId: 'ch1' }, { scope: 'chat', scopeId: 'c1' }], expect.any(Array), { k: 3, minScore: 0.4, excludeSources: ['msg:m9'] })
  })

  it('leaves the chat out when chat memory is off', async () => {
    const d = deps()
    await retrieveMemories(d, 'q', { chatId: 'c1', chatMemory: false })
    expect(d.api.search.mock.calls[0][0]).toEqual([{ scope: 'global' }])
  })

  it('does not search for an empty query', async () => {
    const d = deps()
    expect(await retrieveMemories(d, '   ')).toEqual([])
    expect(d.api.search).not.toHaveBeenCalled()
  })
})
