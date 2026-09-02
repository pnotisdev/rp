import fs from 'node:fs'
import path from 'node:path'
import { avatarsDir } from './db.ts'

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `avatarDataUrl` from the client is either a fresh `data:...;base64,...` upload (write
 * it to disk and return a servable path) or an already-served `/avatars/...` path from a
 * previous save (nothing changed — keep it as-is). Anything else (undefined, cleared) is
 * passed through untouched.
 */
export function resolveAvatar(kind: string, id: string, avatarDataUrl: unknown): string | undefined {
  if (typeof avatarDataUrl !== 'string' || !avatarDataUrl.startsWith('data:')) {
    return avatarDataUrl as string | undefined
  }
  // `id` reaches here from a URL param — every id in this app is server-generated via
  // crypto.randomUUID(), so a non-UUID value is never legitimate. Reject it before it
  // can reach a filesystem path (route params can carry '\', which path.join treats as
  // a separator on Windows, allowing writes outside data/avatars).
  if (!UUID_RE.test(id)) {
    throw new Error('Invalid id')
  }
  const match = avatarDataUrl.match(/^data:([^;]+);base64,(.+)$/s)
  if (!match) return undefined
  const [, mime, base64] = match
  const ext = EXT_BY_MIME[mime] ?? 'png'
  const dir = path.join(avatarsDir, kind)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${id}.${ext}`)
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
  return `/avatars/${kind}/${id}.${ext}?t=${Date.now()}`
}

export function removeAvatar(kind: string, id: string): void {
  const dir = path.join(avatarsDir, kind)
  if (!fs.existsSync(dir)) return
  for (const ext of Object.values(EXT_BY_MIME)) {
    const filePath = path.join(dir, `${id}.${ext}`)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  }
}
