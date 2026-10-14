// Vector storage: text chunks with their embeddings, searched by cosine similarity. The browser makes the embeddings; the server keeps and searches them so a query never ships every vector back.

import express from 'express'
import { db, newId, vectorChunkStore } from './db.ts'

export const VECTOR_SCOPES = ['global', 'character', 'chat'] as const
type Scope = (typeof VECTOR_SCOPES)[number]

const MAX_CHUNKS_PER_REQUEST = 2000
const MAX_DIMENSIONS = 4096
const CACHE_LIMIT = 24

interface Cached {
  id: string
  source: string
  sourceName: string
  text: string
  vec: Float32Array
  norm: number
}

const cache = new Map<string, Cached[]>()
const keyOf = (scope: string, scopeId: string) => `${scope}:${scopeId}`

const isScope = (v: unknown): v is Scope => typeof v === 'string' && (VECTOR_SCOPES as readonly string[]).includes(v)
const scopeIdOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '_')

function norm(vec: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < vec.length; i += 1) sum += vec[i] * vec[i]
  return Math.sqrt(sum)
}

/** Every chunk of one scope, with its vector ready for comparing. Kept in memory until that scope changes. */
function load(scope: string, scopeId: string): Cached[] {
  const key = keyOf(scope, scopeId)
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const rows = vectorChunkStore.list({ where: 'scope = ? AND scopeId = ?', params: [scope, scopeId] })
  const chunks: Cached[] = rows.flatMap((r) => {
    const vector = r.vector
    if (!Array.isArray(vector) || vector.length === 0) return []
    const vec = Float32Array.from(vector as number[])
    return [{ id: r.id as string, source: String(r.source), sourceName: String(r.sourceName ?? r.source), text: String(r.text ?? ''), vec, norm: norm(vec) }]
  })
  cache.set(key, chunks)
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  return chunks
}

const forget = (scope: string, scopeId: string) => void cache.delete(keyOf(scope, scopeId))

/** After a restore replaced the table underneath the cache. */
export const forgetAllVectors = () => cache.clear()

/** Removes everything stored for a chat or a character that is being deleted. */
export function purgeVectors(scope: Scope, scopeId: string): void {
  for (const row of vectorChunkStore.list({ where: 'scope = ? AND scopeId = ?', params: [scope, scopeId] })) vectorChunkStore.remove(row.id as string)
  forget(scope, scopeId)
}

export interface VectorHit {
  id: string
  text: string
  score: number
  source: string
  sourceName: string
  scope: string
}

/** Cosine similarity of a query against every chunk of the given scopes, best first. Chunks of another dimension (a different embedding model) are skipped. */
export function searchVectors(
  targets: { scope: string; scopeId: string }[],
  query: number[],
  opts: { k?: number; minScore?: number; excludeSources?: string[] } = {},
): VectorHit[] {
  const q = Float32Array.from(query)
  const qNorm = norm(q)
  if (!q.length || qNorm === 0) return []
  const exclude = new Set(opts.excludeSources ?? [])
  const hits: VectorHit[] = []
  for (const t of targets) {
    for (const c of load(t.scope, t.scopeId)) {
      if (c.vec.length !== q.length || c.norm === 0 || exclude.has(c.source)) continue
      let dot = 0
      for (let i = 0; i < q.length; i += 1) dot += q[i] * c.vec[i]
      const score = dot / (qNorm * c.norm)
      if (score >= (opts.minScore ?? 0)) hits.push({ id: c.id, text: c.text, score, source: c.source, sourceName: c.sourceName, scope: t.scope })
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(opts.k ?? 5, 50)))
}

export function vectorsRouter(): express.Router {
  const router = express.Router()

  // Replaces whatever the source had before, so re-indexing a document or edited message never leaves stale chunks behind.
  router.post('/api/vectors/index', (req, res) => {
    const { scope, source } = req.body ?? {}
    const scopeId = scopeIdOf(req.body?.scopeId)
    if (!isScope(scope) || typeof source !== 'string' || !source) return void res.status(400).json({ error: 'scope and source are required' })
    const chunks = Array.isArray(req.body?.chunks) ? (req.body.chunks as unknown[]) : []
    if (chunks.length > MAX_CHUNKS_PER_REQUEST) return void res.status(400).json({ error: `At most ${MAX_CHUNKS_PER_REQUEST} chunks per request` })
    const clean: { text: string; vector: number[] }[] = []
    for (const c of chunks) {
      const o = c as { text?: unknown; vector?: unknown }
      if (typeof o?.text !== 'string' || !o.text.trim() || !Array.isArray(o.vector) || o.vector.length === 0 || o.vector.length > MAX_DIMENSIONS) continue
      if (!o.vector.every((n) => typeof n === 'number' && Number.isFinite(n))) continue
      clean.push({ text: o.text, vector: o.vector as number[] })
    }
    const sourceName = typeof req.body?.sourceName === 'string' && req.body.sourceName.trim() ? req.body.sourceName.trim() : source
    db.exec('BEGIN')
    try {
      for (const row of vectorChunkStore.list({ where: 'scope = ? AND scopeId = ? AND source = ?', params: [scope, scopeId, source] })) vectorChunkStore.remove(row.id as string)
      const now = Date.now()
      clean.forEach((c, i) =>
        vectorChunkStore.insert({ id: newId(), scope, scopeId, source, createdAt: now + i, sourceName, text: c.text, vector: c.vector, dim: c.vector.length }),
      )
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    forget(scope, scopeId)
    res.json({ chunks: clean.length })
  })

  router.get('/api/vectors/sources', (req, res) => {
    if (!isScope(req.query.scope)) return void res.status(400).json({ error: 'scope is required' })
    const scopeId = scopeIdOf(req.query.scopeId)
    const bySource = new Map<string, { source: string; sourceName: string; chunks: number; dim: number; createdAt: number }>()
    for (const row of vectorChunkStore.list({ where: 'scope = ? AND scopeId = ?', params: [req.query.scope, scopeId], orderBy: 'createdAt' })) {
      const key = String(row.source)
      const entry = bySource.get(key) ?? { source: key, sourceName: String(row.sourceName ?? key), chunks: 0, dim: Number(row.dim ?? 0), createdAt: Number(row.createdAt) }
      entry.chunks += 1
      bySource.set(key, entry)
    }
    res.json([...bySource.values()])
  })

  router.delete('/api/vectors/source', (req, res) => {
    if (!isScope(req.query.scope) || typeof req.query.source !== 'string') return void res.status(400).json({ error: 'scope and source are required' })
    const scopeId = scopeIdOf(req.query.scopeId)
    for (const row of vectorChunkStore.list({ where: 'scope = ? AND scopeId = ? AND source = ?', params: [req.query.scope, scopeId, req.query.source] })) vectorChunkStore.remove(row.id as string)
    forget(req.query.scope, scopeId)
    res.status(204).end()
  })

  router.delete('/api/vectors/scope', (req, res) => {
    if (!isScope(req.query.scope)) return void res.status(400).json({ error: 'scope is required' })
    purgeVectors(req.query.scope, scopeIdOf(req.query.scopeId))
    res.status(204).end()
  })

  router.post('/api/vectors/search', (req, res) => {
    const targets = (Array.isArray(req.body?.targets) ? (req.body.targets as unknown[]) : []).flatMap((t) => {
      const o = t as { scope?: unknown; scopeId?: unknown }
      return isScope(o?.scope) ? [{ scope: o.scope as string, scopeId: scopeIdOf(o.scopeId) }] : []
    })
    const query = Array.isArray(req.body?.vector) && req.body.vector.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)) ? (req.body.vector as number[]) : null
    if (!query || query.length > MAX_DIMENSIONS) return void res.status(400).json({ error: 'vector must be an array of numbers' })
    const excludeSources = Array.isArray(req.body?.excludeSources) ? (req.body.excludeSources as unknown[]).filter((s): s is string => typeof s === 'string') : []
    res.json(
      searchVectors(targets, query, {
        k: typeof req.body?.k === 'number' ? req.body.k : undefined,
        minScore: typeof req.body?.minScore === 'number' ? req.body.minScore : undefined,
        excludeSources,
      }),
    )
  })

  return router
}
