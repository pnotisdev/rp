import fs from 'node:fs'
import path from 'node:path'
import { avatarsDir } from './db.ts'

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

// A generous ceiling for a single avatar/sprite/background/CG image — well above anything a
// real portrait needs, but small enough that one oversized upload can't fill the disk or blow
// past the request in a way that's hard to diagnose. Applies to the decoded (raw) byte size, not
// the base64 text length (which runs ~33% larger).
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Parses a `data:<mime>;base64,<data>` URL, rejecting anything that isn't one of the image
 * mime types this app actually serves as static files, or that decodes larger than
 * `MAX_IMAGE_BYTES`. Returns the extension to save under and the decoded buffer.
 */
function decodeImageDataUrl(dataUrl: string): { ext: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
  if (!match) throw new Error('Malformed image data URL.')
  const [, mime, base64] = match
  const ext = EXT_BY_MIME[mime]
  if (!ext) {
    throw new Error(`Unsupported image type "${mime}" — expected PNG, JPEG, WebP, or GIF.`)
  }
  // Every 4 base64 characters decode to 3 bytes (minus 1-2 for trailing '=' padding) — cheap to
  // check before actually allocating the buffer.
  const approxBytes = Math.floor((base64.length * 3) / 4)
  if (approxBytes > MAX_IMAGE_BYTES) {
    throw new Error(`Image is too large (max ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))}MB).`)
  }
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image is too large (max ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))}MB).`)
  }
  return { ext, buffer }
}

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
  const { ext, buffer } = decodeImageDataUrl(avatarDataUrl)
  const dir = path.join(avatarsDir, kind)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${id}.${ext}`)
  fs.writeFileSync(filePath, buffer)
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

// Keys here are fixed expression/background ids (src/lib/vn/expressions.ts, backgrounds.ts) chosen
// from a dropdown, never freeform user text — still validated since they end up in a filename.
const SAFE_KEY_RE = /^[a-z0-9][a-z0-9-]{0,40}$/i

/**
 * Same idea as resolveAvatar, but for a whole map of tagged images at once (e.g. one
 * sprite per expression, or one background per scene tag). Each entry is resolved
 * independently; entries with an invalid key or unresolvable value are dropped.
 */
export function resolveAvatarMap(kind: string, id: string, map: unknown): Record<string, string> | undefined {
  if (!UUID_RE.test(id)) throw new Error('Invalid id')
  if (!map || typeof map !== 'object') return undefined
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
    if (!SAFE_KEY_RE.test(key) || typeof value !== 'string' || !value) continue
    if (!value.startsWith('data:')) {
      result[key] = value // already a resolved /avatars/... URL from a previous save
      continue
    }
    let ext: string
    let buffer: Buffer
    try {
      ;({ ext, buffer } = decodeImageDataUrl(value))
    } catch (e) {
      throw new Error(`"${key}": ${e instanceof Error ? e.message : String(e)}`)
    }
    const dir = path.join(avatarsDir, kind)
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, `${id}_${key}.${ext}`)
    fs.writeFileSync(filePath, buffer)
    result[key] = `/avatars/${kind}/${id}_${key}.${ext}?t=${Date.now()}`
  }
  return result
}

export function removeAvatarMap(kind: string, id: string, keys: string[]): void {
  const dir = path.join(avatarsDir, kind)
  if (!fs.existsSync(dir)) return
  for (const key of keys) {
    if (!SAFE_KEY_RE.test(key)) continue
    for (const ext of Object.values(EXT_BY_MIME)) {
      const filePath = path.join(dir, `${id}_${key}.${ext}`)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }
  }
}
