// Extension service + REST router: bundles, files, grants, and per-scope key-value data.

import express from 'express'
import { db, extensionDataStore, extensionFileStore, extensionStore, transaction } from './db.ts'
import {
  LIMITS,
  fileByteLength,
  isPermission,
  isSafePath,
  isTextPath,
  cleanSettings,
  mimeForPath,
  normalizeGrants,
  validateBundle,
  validateManifest,
  type BundleFile,
  type ExtensionBundle,
  type ExtensionRecord,
  type ExtensionSource,
  type Permission,
} from '../src/lib/extensions/manifest.ts'
import { lintBundle, type LintFinding } from '../src/lib/extensions/lint.ts'

type Row = Record<string, unknown>
export type KvScope = 'global' | 'chat' | 'character' | 'world'
const KV_SCOPES: KvScope[] = ['global', 'chat', 'character', 'world']
const ID_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

function httpError(status: number, message: string, details?: string[]) {
  return Object.assign(new Error(message), { status, details })
}

const fileRowId = (extId: string, path: string) => `${extId}::${path}`
const kvRowId = (extId: string, scope: string, scopeId: string, key: string) => `${extId}|${scope}|${scopeId}|${key}`

function toRecord(row: Row): ExtensionRecord {
  return {
    id: row.id as string,
    manifest: row.manifest as ExtensionRecord['manifest'],
    enabled: row.enabled === true,
    grants: (row.grants as Permission[]) ?? [],
    settings: (row.settings as ExtensionRecord['settings']) ?? {},
    source: (row.source as ExtensionSource) ?? 'local',
    rev: (row.rev as number) ?? 1,
    fileCount: (row.fileCount as number) ?? 0,
    totalBytes: (row.totalBytes as number) ?? 0,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
  }
}

export function listExtensions(): ExtensionRecord[] {
  return extensionStore
    .list()
    .map(toRecord)
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
}

export function getExtension(id: string): ExtensionRecord | undefined {
  const row = extensionStore.get(id)
  return row ? toRecord(row) : undefined
}

function requireExtension(id: string): ExtensionRecord {
  const rec = getExtension(id)
  if (!rec) throw httpError(404, `No extension "${id}"`)
  return rec
}

function fileRows(id: string): Row[] {
  return extensionFileStore.list({ where: 'extId = ?', params: [id], orderBy: 'id' })
}

export function readBundle(id: string): ExtensionBundle | undefined {
  const rec = getExtension(id)
  if (!rec) return undefined
  const files: Record<string, BundleFile> = Object.create(null)
  for (const row of fileRows(id)) {
    const path = row.path as string
    files[path] = row.encoding === 'base64' ? { base64: row.content as string, mime: row.mime as string | undefined } : (row.content as string)
  }
  return { format: 'rp-extension', version: 1, manifest: rec.manifest, files }
}

function insertFile(extId: string, path: string, file: BundleFile, now: number): void {
  const binary = typeof file !== 'string'
  extensionFileStore.insert({
    id: fileRowId(extId, path),
    extId,
    updatedAt: now,
    path,
    content: binary ? file.base64 : file,
    encoding: binary ? 'base64' : 'utf8',
    mime: binary ? (file.mime ?? mimeForPath(path)) : mimeForPath(path),
  })
}

/** Refreshes file totals after a code change and bumps `rev` so running copies reload. */
function touchTotals(id: string): ExtensionRecord {
  const rows = fileRows(id)
  const total = rows.reduce((sum, r) => sum + fileByteLength(r.encoding === 'base64' ? { base64: r.content as string } : (r.content as string)), 0)
  const rev = ((extensionStore.get(id)?.rev as number | undefined) ?? 0) + 1
  const updated = extensionStore.update(id, { fileCount: rows.length, totalBytes: total, rev, updatedAt: Date.now() })
  return toRecord(updated as Row)
}

export interface InstallResult {
  record: ExtensionRecord
  created: boolean
  newPermissions: Permission[]
  warnings: string[]
}

/** Installs a new extension or replaces an existing one's files. New installs start disabled with nothing granted. */
export function installBundle(raw: unknown, source: ExtensionSource = 'local'): InstallResult {
  const report = validateBundle(raw)
  if (!report.ok || !report.value) throw httpError(400, 'Invalid extension bundle', report.errors)
  const bundle = report.value
  const id = bundle.manifest.id
  const existing = getExtension(id)
  const now = Date.now()
  transaction(() => {
    for (const row of fileRows(id)) extensionFileStore.remove(row.id as string)
    for (const [path, file] of Object.entries(bundle.files)) insertFile(id, path, file, now)
    if (existing) {
      extensionStore.update(id, {
        manifest: bundle.manifest,
        grants: normalizeGrants(bundle.manifest.permissions, existing.grants),
        settings: cleanSettings(bundle.manifest, existing.settings),
        updatedAt: now,
      })
    } else {
      extensionStore.insert({
        id,
        manifest: bundle.manifest,
        enabled: false,
        grants: [],
        settings: {},
        source,
        rev: 0,
        fileCount: 0,
        totalBytes: 0,
        createdAt: now,
        updatedAt: now,
      })
    }
  })
  const record = touchTotals(id)
  const newPermissions = bundle.manifest.permissions.filter((p) => !(existing?.grants ?? []).includes(p))
  return { record, created: !existing, newPermissions, warnings: report.warnings }
}

export function updateExtension(id: string, patch: { enabled?: unknown; grants?: unknown; settings?: unknown }): ExtensionRecord {
  const rec = requireExtension(id)
  const next: Row = { updatedAt: Date.now() }
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') throw httpError(400, '"enabled" must be a boolean')
    next.enabled = patch.enabled
  }
  if (patch.grants !== undefined) {
    if (!Array.isArray(patch.grants) || !patch.grants.every(isPermission)) throw httpError(400, '"grants" must be an array of known permissions')
    const outside = patch.grants.filter((g) => !rec.manifest.permissions.includes(g))
    if (outside.length) throw httpError(400, `Cannot grant permissions the manifest does not request: ${outside.join(', ')}`)
    next.grants = normalizeGrants(rec.manifest.permissions, patch.grants)
  }
  if (patch.settings !== undefined) next.settings = { ...rec.settings, ...cleanSettings(rec.manifest, patch.settings) }
  return toRecord(extensionStore.update(id, next) as Row)
}

export function removeExtension(id: string): void {
  requireExtension(id)
  transaction(() => {
    for (const row of fileRows(id)) extensionFileStore.remove(row.id as string)
    db.prepare('DELETE FROM extension_data WHERE extId = ?').run(id)
    extensionStore.remove(id)
  })
}

export function listFiles(id: string): { path: string; size: number; mime: string }[] {
  requireExtension(id)
  return fileRows(id).map((r) => ({
    path: r.path as string,
    size: fileByteLength(r.encoding === 'base64' ? { base64: r.content as string } : (r.content as string)),
    mime: (r.mime as string) ?? mimeForPath(r.path as string),
  }))
}

export function readFile(id: string, path: string): { path: string; content: string; encoding: 'utf8' | 'base64'; mime: string } {
  requireExtension(id)
  const row = isSafePath(path) ? extensionFileStore.get(fileRowId(id, path)) : undefined
  if (!row) throw httpError(404, `No file "${path}" in "${id}"`)
  return { path, content: row.content as string, encoding: row.encoding as 'utf8' | 'base64', mime: row.mime as string }
}

export function writeFile(id: string, path: unknown, content: unknown, base64?: unknown): ExtensionRecord {
  const rec = requireExtension(id)
  if (!isSafePath(path)) throw httpError(400, `"${String(path)}" is not a safe relative path`)
  if (path === 'manifest.json') throw httpError(400, 'Change the manifest with PUT /manifest, not as a file')
  const binary = typeof base64 === 'string'
  if (!binary && typeof content !== 'string') throw httpError(400, 'Provide "content" (text) or "base64" (binary)')
  if (binary && isTextPath(path)) throw httpError(400, 'Text files must be sent as "content"')
  const file: BundleFile = binary ? { base64: base64 as string } : (content as string)
  if (fileByteLength(file) > LIMITS.fileBytes) throw httpError(400, `File is over the ${LIMITS.fileBytes} byte limit`)
  const previous = extensionFileStore.get(fileRowId(id, path))
  if (!previous && rec.fileCount >= LIMITS.files) throw httpError(400, `At most ${LIMITS.files} files per extension`)
  const oldSize = previous ? fileByteLength(previous.encoding === 'base64' ? { base64: previous.content as string } : (previous.content as string)) : 0
  if (rec.totalBytes - oldSize + fileByteLength(file) > LIMITS.bundleBytes) throw httpError(400, `Extension would exceed ${LIMITS.bundleBytes} bytes in total`)
  const now = Date.now()
  transaction(() => {
    if (previous) extensionFileStore.remove(fileRowId(id, path))
    insertFile(id, path, file, now)
  })
  return touchTotals(id)
}

export function deleteFile(id: string, path: string): ExtensionRecord {
  const rec = requireExtension(id)
  if (!isSafePath(path) || !extensionFileStore.get(fileRowId(id, path))) throw httpError(404, `No file "${path}" in "${id}"`)
  const m = rec.manifest
  const used = m.panels.some((p) => p.entry === path) || m.script === path || m.theme?.css === path
  if (used) throw httpError(400, `"${path}" is referenced by the manifest. Update the manifest first`)
  extensionFileStore.remove(fileRowId(id, path))
  return touchTotals(id)
}

/** Replaces the manifest after checking that every file it references exists. */
export function setManifest(id: string, raw: unknown): ExtensionRecord {
  const rec = requireExtension(id)
  const report = validateManifest(raw)
  if (!report.ok || !report.value) throw httpError(400, 'Invalid manifest', report.errors)
  const m = report.value
  if (m.id !== id) throw httpError(400, `The manifest id must stay "${id}"`)
  const have = new Set(fileRows(id).map((r) => r.path as string))
  const missing = [...m.panels.map((p) => p.entry), ...(m.script ? [m.script] : []), ...(m.theme ? [m.theme.css] : [])].filter((p) => !have.has(p))
  if (missing.length) throw httpError(400, 'The manifest references files that do not exist', missing.map((p) => `missing file: ${p}`))
  return toRecord(
    extensionStore.update(id, {
      manifest: m,
      grants: normalizeGrants(m.permissions, rec.grants),
      settings: cleanSettings(m, rec.settings),
      rev: rec.rev + 1,
      updatedAt: Date.now(),
    }) as Row,
  )
}

export function lintExtension(id: string): LintFinding[] {
  const bundle = readBundle(id)
  if (!bundle) throw httpError(404, `No extension "${id}"`)
  return lintBundle(bundle)
}

// ---- Key-value data ----

function checkScope(scope: unknown, scopeId: unknown): { scope: KvScope; scopeId: string } {
  if (!KV_SCOPES.includes(scope as KvScope)) throw httpError(400, `"scope" must be one of ${KV_SCOPES.join(', ')}`)
  if (scope === 'global') return { scope: 'global', scopeId: '' }
  if (typeof scopeId !== 'string' || !scopeId || scopeId.length > 80) throw httpError(400, `"scopeId" is required for scope "${String(scope)}"`)
  return { scope: scope as KvScope, scopeId }
}

export function kvList(id: string, scopeIn: unknown, scopeIdIn: unknown): Record<string, unknown> {
  requireExtension(id)
  const { scope, scopeId } = checkScope(scopeIn, scopeIdIn)
  const out: Record<string, unknown> = {}
  for (const row of extensionDataStore.list({ where: 'extId = ? AND scope = ? AND scopeId = ?', params: [id, scope, scopeId] })) {
    out[row.key as string] = row.value
  }
  return out
}

export function kvSet(id: string, scopeIn: unknown, scopeIdIn: unknown, key: unknown, value: unknown): void {
  requireExtension(id)
  const { scope, scopeId } = checkScope(scopeIn, scopeIdIn)
  if (typeof key !== 'string' || !key || key.length > LIMITS.kvKeyLength) throw httpError(400, `"key" must be 1-${LIMITS.kvKeyLength} characters`)
  const json = JSON.stringify(value ?? null)
  if (json === undefined || json.length > LIMITS.kvValueBytes) throw httpError(400, `Value must be JSON and at most ${LIMITS.kvValueBytes} bytes`)
  const rowId = kvRowId(id, scope, scopeId, key)
  const exists = !!extensionDataStore.get(rowId)
  if (!exists) {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM extension_data WHERE extId = ?').get(id) as { n: number }
    if (n >= LIMITS.kvKeys) throw httpError(400, `At most ${LIMITS.kvKeys} stored keys per extension`)
  }
  const row = { id: rowId, extId: id, scope, scopeId, updatedAt: Date.now(), key, value: JSON.parse(json) as unknown }
  if (exists) extensionDataStore.update(rowId, row)
  else extensionDataStore.insert(row)
}

export function kvRemove(id: string, scopeIn: unknown, scopeIdIn: unknown, key: unknown): void {
  requireExtension(id)
  const { scope, scopeId } = checkScope(scopeIn, scopeIdIn)
  if (typeof key !== 'string' || !key) throw httpError(400, '"key" is required')
  extensionDataStore.remove(kvRowId(id, scope, scopeId, key))
}

/** Drops every extension's data stored against a chat/character/world that no longer exists. */
export function purgeScopeData(scope: Exclude<KvScope, 'global'>, scopeId: string): void {
  db.prepare('DELETE FROM extension_data WHERE scope = ? AND scopeId = ?').run(scope, scopeId)
}

/** Copies every extension's data from one scope owner to another (a forked chat). */
export function cloneScopeData(scope: Exclude<KvScope, 'global'>, fromId: string, toId: string): void {
  for (const row of extensionDataStore.list({ where: 'scope = ? AND scopeId = ?', params: [scope, fromId] })) {
    const extId = row.extId as string
    const key = row.key as string
    extensionDataStore.insert({ id: kvRowId(extId, scope, toId, key), extId, scope, scopeId: toId, updatedAt: Date.now(), key, value: row.value })
  }
}

// ---- Router ----

type Handler = (req: express.Request, res: express.Response) => void

function route(fn: Handler): express.RequestHandler {
  return (req, res) => {
    try {
      fn(req, res)
    } catch (e) {
      const err = e as Error & { status?: number; details?: string[] }
      res.status(err.status ?? 400).json({ error: err.message, ...(err.details ? { details: err.details } : {}) })
    }
  }
}

function idParam(req: express.Request): string {
  const id = String(req.params.id)
  if (!ID_RE.test(id)) throw httpError(404, `No extension "${id}"`)
  return id
}

export function extensionsRouter(): express.Router {
  const r = express.Router()

  r.get('/', route((_req, res) => void res.json(listExtensions())))

  r.post('/validate', route((req, res) => {
    const isBundle = !!req.body && typeof req.body === 'object' && 'manifest' in req.body && 'files' in req.body
    if (isBundle) {
      const report = validateBundle(req.body)
      res.json({ ok: report.ok, errors: report.errors, warnings: report.warnings, lint: report.value ? lintBundle(report.value) : [] })
    } else {
      const report = validateManifest(req.body)
      res.json({ ok: report.ok, errors: report.errors, warnings: report.warnings, lint: [] })
    }
  }))

  r.post('/install', route((req, res) => {
    const source = (['local', 'example', 'import', 'agent'] as const).find((s) => s === req.query.source) ?? 'local'
    const result = installBundle(req.body, source)
    res.status(result.created ? 201 : 200).json(result)
  }))

  r.get('/:id', route((req, res) => void res.json(requireExtension(idParam(req)))))
  r.put('/:id', route((req, res) => void res.json(updateExtension(idParam(req), req.body ?? {}))))
  r.delete('/:id', route((req, res) => {
    removeExtension(idParam(req))
    res.status(204).end()
  }))

  r.get('/:id/bundle', route((req, res) => {
    const bundle = readBundle(idParam(req))
    if (!bundle) throw httpError(404, 'No such extension')
    res.json(bundle)
  }))
  r.get('/:id/lint', route((req, res) => void res.json(lintExtension(idParam(req)))))
  r.get('/:id/files', route((req, res) => void res.json(listFiles(idParam(req)))))
  r.get('/:id/file', route((req, res) => void res.json(readFile(idParam(req), String(req.query.path ?? '')))))
  r.put('/:id/file', route((req, res) => void res.json(writeFile(idParam(req), req.body?.path, req.body?.content, req.body?.base64))))
  r.delete('/:id/file', route((req, res) => void res.json(deleteFile(idParam(req), String(req.query.path ?? '')))))
  r.put('/:id/manifest', route((req, res) => void res.json(setManifest(idParam(req), req.body))))

  r.get('/:id/data', route((req, res) => void res.json(kvList(idParam(req), req.query.scope, req.query.scopeId))))
  r.put('/:id/data', route((req, res) => {
    kvSet(idParam(req), req.body?.scope, req.body?.scopeId, req.body?.key, req.body?.value)
    res.status(204).end()
  }))
  r.delete('/:id/data', route((req, res) => {
    kvRemove(idParam(req), req.query.scope, req.query.scopeId, req.query.key)
    res.status(204).end()
  }))

  return r
}
