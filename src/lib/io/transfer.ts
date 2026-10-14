// Download/pick helpers and the JSON envelope used to move personas and worlds between installs.

const KIND_PREFIX = 'rp-'

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function safeFilename(name: string, fallback = 'export'): string {
  return (name || fallback).replace(/[^a-z0-9-_ ]/gi, '').trim() || fallback
}

export function downloadJsonFile(data: unknown, name: string) {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${safeFilename(name)}.json`)
}

export async function readJsonFile(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text())
  } catch {
    throw new Error(`${file.name} is not valid JSON`)
  }
}

export type TransferKind = 'persona' | 'world'

/** Wraps a record as `{ kind, version, data }`, without its identity and timestamps. */
export function toEnvelope(kind: TransferKind, record: object) {
  const { id: _id, createdAt: _c, updatedAt: _u, ...data } = record as Record<string, unknown>
  return { kind: `${KIND_PREFIX}${kind}`, version: 1, data }
}

/** Unwraps an envelope from `toEnvelope`; throws a readable error for anything else. */
export function fromEnvelope(kind: TransferKind, raw: unknown): Record<string, unknown> {
  const o = raw as { kind?: unknown; data?: unknown } | null
  if (!o || o.kind !== `${KIND_PREFIX}${kind}` || !o.data || typeof o.data !== 'object') {
    throw new Error(`Not an rp ${kind} file`)
  }
  return o.data as Record<string, unknown>
}

/** Creates one record per file; reports successes and per-file errors instead of stopping at the first. */
export async function importEnvelopes(kind: TransferKind, files: File[], create: (data: Record<string, unknown>) => Promise<unknown>) {
  let created = 0
  const failed: string[] = []
  for (const file of files) {
    try {
      await create(fromEnvelope(kind, await readJsonFile(file)))
      created++
    } catch (e) {
      failed.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { created, failed }
}
