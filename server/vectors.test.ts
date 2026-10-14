import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

let tmp: string
let server: Server
let base: string

const call = async (method: string, route: string, body?: unknown) => {
  const res = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-vectors-test-'))
  process.env.RP_DATA_DIR = tmp
  const { app } = await import('./app.ts')
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 60_000)

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  const { db } = await import('./db.ts')
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const index = (scope: string, scopeId: string, source: string, chunks: { text: string; vector: number[] }[], sourceName?: string) =>
  call('POST', '/api/vectors/index', { scope, scopeId, source, sourceName, chunks })

describe('vector storage', () => {
  it('finds the closest chunk by cosine similarity, best first', async () => {
    await index('global', '', 'doc-a', [
      { text: 'about cats', vector: [1, 0, 0] },
      { text: 'about dogs', vector: [0, 1, 0] },
      { text: 'about both', vector: [0.7, 0.7, 0] },
    ], 'Pets.txt')
    const r = await call('POST', '/api/vectors/search', { targets: [{ scope: 'global' }], vector: [1, 0.1, 0], k: 3 })
    expect(r.status).toBe(200)
    expect(r.body.map((h: { text: string }) => h.text)).toEqual(['about cats', 'about both', 'about dogs'])
    expect(r.body[0]).toMatchObject({ source: 'doc-a', sourceName: 'Pets.txt', scope: 'global' })
    expect(r.body[0].score).toBeGreaterThan(0.99)
  })

  it('keeps only hits above the minimum score and respects k', async () => {
    const r = await call('POST', '/api/vectors/search', { targets: [{ scope: 'global' }], vector: [1, 0, 0], k: 1, minScore: 0.5 })
    expect(r.body).toHaveLength(1)
    const none = await call('POST', '/api/vectors/search', { targets: [{ scope: 'global' }], vector: [0, 0, 1], minScore: 0.5 })
    expect(none.body).toEqual([])
  })

  it('replaces a source instead of piling up chunks, and lists sources', async () => {
    await index('chat', 'c1', 'msg:1', [{ text: 'old', vector: [1, 0] }])
    await index('chat', 'c1', 'msg:1', [{ text: 'new', vector: [1, 0] }, { text: 'newer', vector: [0, 1] }])
    await index('chat', 'c1', 'msg:2', [{ text: 'second', vector: [0.5, 0.5] }])
    const sources = await call('GET', '/api/vectors/sources?scope=chat&scopeId=c1')
    expect(sources.body).toMatchObject([{ source: 'msg:1', chunks: 2, dim: 2 }, { source: 'msg:2', chunks: 1 }])
    const hits = await call('POST', '/api/vectors/search', { targets: [{ scope: 'chat', scopeId: 'c1' }], vector: [1, 0], k: 10 })
    expect(hits.body.map((h: { text: string }) => h.text)).not.toContain('old')
  })

  it('searches several scopes at once and can skip sources', async () => {
    const r = await call('POST', '/api/vectors/search', { targets: [{ scope: 'chat', scopeId: 'c1' }, { scope: 'global' }], vector: [1, 0, 0], k: 10, excludeSources: ['doc-a'] })
    expect(r.body.every((h: { source: string }) => h.source !== 'doc-a')).toBe(true)
  })

  it('skips chunks of another dimension, so changing the embedding model never mixes spaces', async () => {
    const r = await call('POST', '/api/vectors/search', { targets: [{ scope: 'chat', scopeId: 'c1' }], vector: [1, 0, 0, 0], k: 10 })
    expect(r.body).toEqual([])
  })

  it('deletes one source, then a whole scope', async () => {
    expect((await call('DELETE', '/api/vectors/source?scope=chat&scopeId=c1&source=msg:2')).status).toBe(204)
    const left = await call('GET', '/api/vectors/sources?scope=chat&scopeId=c1')
    expect(left.body.map((s: { source: string }) => s.source)).toEqual(['msg:1'])
    expect((await call('DELETE', '/api/vectors/scope?scope=chat&scopeId=c1')).status).toBe(204)
    expect((await call('GET', '/api/vectors/sources?scope=chat&scopeId=c1')).body).toEqual([])
    const after = await call('POST', '/api/vectors/search', { targets: [{ scope: 'chat', scopeId: 'c1' }], vector: [1, 0], k: 5 })
    expect(after.body).toEqual([])
  })

  it('refuses bad input and drops unusable chunks', async () => {
    expect((await index('galaxy', '', 'x', [])).status).toBe(400)
    expect((await call('POST', '/api/vectors/index', { scope: 'global', chunks: [] })).status).toBe(400)
    expect((await call('POST', '/api/vectors/search', { targets: [{ scope: 'global' }], vector: 'nope' })).status).toBe(400)
    const r = await index('global', '', 'messy', [
      { text: '', vector: [1] },
      { text: 'no vector', vector: [] },
      { text: 'nan', vector: [Number.NaN] as unknown as number[] },
      { text: 'fine', vector: [1, 2] },
    ])
    expect(r.body.chunks).toBe(1)
  })

  it('removes a chat\'s memories when the chat is deleted', async () => {
    const character = (await call('POST', '/api/characters', { card: { name: 'M', description: '', personality: '', scenario: '', first_mes: 'hi', mes_example: '' } })).body
    const chat = (await call('POST', '/api/chats', { characterId: character.id, title: 't' })).body
    await index('chat', chat.id, 'msg:a', [{ text: 'remember', vector: [1, 0] }])
    await index('character', character.id, 'doc', [{ text: 'lore', vector: [1, 0] }])
    // A plain delete only moves a chat to the trash; the purge is what removes it for good.
    await call('DELETE', `/api/chats/${chat.id}`)
    expect((await call('GET', `/api/vectors/sources?scope=chat&scopeId=${chat.id}`)).body).toHaveLength(1)
    await call('DELETE', `/api/chats/${chat.id}/purge`)
    expect((await call('GET', `/api/vectors/sources?scope=chat&scopeId=${chat.id}`)).body).toEqual([])
    await call('DELETE', `/api/characters/${character.id}`)
    expect((await call('GET', `/api/vectors/sources?scope=character&scopeId=${character.id}`)).body).toEqual([])
  })

  it('travels with a backup and survives a restore', async () => {
    await index('global', '', 'kept', [{ text: 'kept text', vector: [0, 0, 1] }])
    const backup = (await call('GET', '/api/backup')).body
    expect(backup.data.vectorChunks.some((c: { text: string }) => c.text === 'kept text')).toBe(true)
    await call('DELETE', '/api/vectors/source?scope=global&source=kept')
    expect((await call('POST', '/api/vectors/search', { targets: [{ scope: 'global' }], vector: [0, 0, 1], minScore: 0.9 })).body).toEqual([])
    expect((await call('POST', '/api/restore', backup)).status).toBeLessThan(300)
    const back = await call('POST', '/api/vectors/search', { targets: [{ scope: 'global' }], vector: [0, 0, 1], minScore: 0.9 })
    expect(back.body.map((h: { text: string }) => h.text)).toContain('kept text')
  })
})
