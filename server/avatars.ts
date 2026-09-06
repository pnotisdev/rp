/**
 * Reads/writes avatar, sprite, gallery, background, and world-music files under data/avatars/.
 * Handles data: URL decoding, size limits, and pruning stale files on re-upload/delete.
 */

import fs from 'node:fs'
import path from 'node:path'
import { avatarsDir } from './db.ts'

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

// Max decoded byte size for a single avatar/sprite/background/CG image.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Parses a `data:<mime>;base64,<data>` URL into an extension + decoded buffer, enforcing MAX_IMAGE_BYTES. */
function decodeImageDataUrl(dataUrl: string): { ext: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
  if (!match) throw new Error('Malformed image data URL.')
  const [, mime, base64] = match
  const ext = EXT_BY_MIME[mime]
  if (!ext) {
    throw new Error(`Unsupported image type "${mime}" — expected PNG, JPEG, WebP, or GIF.`)
  }
  // Cheap approx check (base64 -> bytes) before allocating the buffer.
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

export type AvatarEntityKind = 'characters' | 'personas' | 'worlds'
export type AvatarMapSubKind = 'sprites' | 'gallery' | 'backgrounds'

const AUDIO_EXT_BY_MIME: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
}

// Larger cap for BGM tracks (a few minutes of compressed audio).
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

/** Per-entity folder: data/avatars/<kind>/<id>/. Personas are the exception — a flat data/avatars/personas/<id>.<ext>. */
function entityDir(kind: AvatarEntityKind, id: string): string {
  return path.join(avatarsDir, kind, id)
}

/** Writes a fresh `data:` upload to disk and returns its servable path; passes through anything else (already-resolved path, undefined) untouched. */
export function resolveAvatar(kind: AvatarEntityKind, id: string, avatarDataUrl: unknown): string | undefined {
  if (typeof avatarDataUrl !== 'string' || !avatarDataUrl.startsWith('data:')) {
    return avatarDataUrl as string | undefined
  }
  // ids are always server-generated UUIDs; reject anything else before it reaches a filesystem path.
  if (!UUID_RE.test(id)) {
    throw new Error('Invalid id')
  }
  const { ext, buffer } = decodeImageDataUrl(avatarDataUrl)
  // Re-uploading in a different format writes a new file rather than overwriting; delete the stale one below.
  const staleExts = Object.values(EXT_BY_MIME).filter((e) => e !== ext)
  if (kind === 'personas') {
    const dir = path.join(avatarsDir, 'personas')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${id}.${ext}`), buffer)
    for (const staleExt of staleExts) {
      const stale = path.join(dir, `${id}.${staleExt}`)
      if (fs.existsSync(stale)) fs.unlinkSync(stale)
    }
    return `/avatars/personas/${id}.${ext}?t=${Date.now()}`
  }
  const dir = entityDir(kind, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `avatar.${ext}`), buffer)
  for (const staleExt of staleExts) {
    const stale = path.join(dir, `avatar.${staleExt}`)
    if (fs.existsSync(stale)) fs.unlinkSync(stale)
  }
  return `/avatars/${kind}/${id}/avatar.${ext}?t=${Date.now()}`
}

/**
 * Deletes every file in `dir` whose name isn't in `keep` — used right after (re)writing a set of
 * image files, so a stale one left behind by a format change (re-uploading the same slot as a
 * different mime type, e.g. png -> jpg) or a dropped map key (an unlocked-then-removed gallery
 * CG/sprite) doesn't linger on disk forever; nothing here ever deletes a file that's still
 * referenced by the map/avatar just resolved.
 */
function pruneUnreferencedFiles(dir: string, keep: Set<string>): void {
  if (!fs.existsSync(dir)) return
  for (const file of fs.readdirSync(dir)) {
    if (!keep.has(file)) fs.unlinkSync(path.join(dir, file))
  }
}

/** Removes every image belonging to this entity — for characters/worlds that's the whole per-entity folder (avatar + sprites/gallery or backgrounds together), for a persona just its one flat file. */
export function removeAvatar(kind: AvatarEntityKind, id: string): void {
  if (kind === 'personas') {
    const dir = path.join(avatarsDir, 'personas')
    if (!fs.existsSync(dir)) return
    for (const ext of Object.values(EXT_BY_MIME)) {
      const filePath = path.join(dir, `${id}.${ext}`)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }
    return
  }
  fs.rmSync(entityDir(kind, id), { recursive: true, force: true })
}

// Keys here are fixed expression/background ids (src/lib/vn/expressions.ts, backgrounds.ts) or a
// gallery entry's own id, chosen from a dropdown or generated locally — never freeform user text —
// still validated since they end up in a filename.
// Length only bounds the filename; what actually prevents traversal is the character class, which
// admits no `/`, `\`, or `.` and so cannot express `..` or any path segment. Raised from 40 to 90
// for outfit sprites (`src/lib/vn/outfits.ts`), whose keys are a composite `<outfitId>--<expression>`
// — two ids that are each independently capped at 40 by `slugifyId`, so 82 is the real worst case.
const SAFE_KEY_RE = /^[a-z0-9][a-z0-9-]{0,89}$/i

/**
 * Same idea as resolveAvatar, but for a whole tagged set of images at once — one sprite per
 * expression, one CG per gallery entry, one background per scene tag. Each lives under the owning
 * entity's own folder, in a subfolder named for what it is
 * (data/avatars/<kind>/<id>/<subKind>/<key>.<ext>). Each entry is resolved independently; entries
 * with an invalid key or unresolvable value are dropped.
 */
export function resolveAvatarMap(
  kind: AvatarEntityKind,
  subKind: AvatarMapSubKind,
  id: string,
  map: unknown,
): Record<string, string> | undefined {
  return resolveMediaMap(kind, subKind, id, map, decodeImageDataUrl)
}

/**
 * Same tagged-set handling as `resolveAvatarMap`, but for audio — the per-mood background-music
 * tracks on `WorldCard.music`. Lives under `data/avatars/worlds/<id>/music/<key>.<ext>` so the
 * existing recursive backup walk and per-world folder delete cover it for free.
 */
export function resolveWorldMusicMap(id: string, map: unknown): Record<string, string> | undefined {
  return resolveMediaMap('worlds', 'music', id, map, decodeAudioDataUrl)
}

function decodeAudioDataUrl(dataUrl: string): { ext: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
  if (!match) throw new Error('Malformed audio data URL.')
  const [, mime, base64] = match
  const ext = AUDIO_EXT_BY_MIME[mime.toLowerCase()]
  if (!ext) throw new Error(`Unsupported audio type "${mime}" — expected MP3, OGG, WAV, WebM, AAC, or M4A.`)
  const max = Math.floor(MAX_AUDIO_BYTES / (1024 * 1024))
  if (Math.floor((base64.length * 3) / 4) > MAX_AUDIO_BYTES) throw new Error(`Audio is too large (max ${max}MB).`)
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length > MAX_AUDIO_BYTES) throw new Error(`Audio is too large (max ${max}MB).`)
  return { ext, buffer }
}

function resolveMediaMap(
  kind: AvatarEntityKind,
  subKind: string,
  id: string,
  map: unknown,
  decode: (dataUrl: string) => { ext: string; buffer: Buffer },
): Record<string, string> | undefined {
  if (!UUID_RE.test(id)) throw new Error('Invalid id')
  if (!map || typeof map !== 'object') return undefined
  const result: Record<string, string> = {}
  const dir = path.join(entityDir(kind, id), subKind)
  for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
    if (!SAFE_KEY_RE.test(key) || typeof value !== 'string' || !value) continue
    if (!value.startsWith('data:')) {
      result[key] = value // already a resolved /avatars/... URL from a previous save
      continue
    }
    let ext: string
    let buffer: Buffer
    try {
      ;({ ext, buffer } = decode(value))
    } catch (e) {
      throw new Error(`"${key}": ${e instanceof Error ? e.message : String(e)}`)
    }
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${key}.${ext}`), buffer)
    result[key] = `/avatars/${kind}/${id}/${subKind}/${key}.${ext}?t=${Date.now()}`
  }
  // This map fully replaces whatever was here before (a dropped key means the caller no longer
  // wants that entry at all — e.g. a removed gallery CG or custom expression), and a changed
  // extension leaves the old-format file behind under `dir` isn't referenced by `result` at all,
  // so anything not in the freshly-resolved set is safe to delete — this whole directory belongs
  // to just this one entity/subKind.
  pruneUnreferencedFiles(
    dir,
    new Set(Object.values(result).map((url) => url.split('/').pop()!.split('?')[0])),
  )
  return result
}
