import { extractCardAssets, normalizeCardJson, wrapCardV2, type CharacterCardData } from './cardSpec'
import type { CustomExpression } from '@/lib/vn/expressions'
import { readCharacterFromPng, writeCharacterToPng } from './png'

export async function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export interface ImportResult {
  card: CharacterCardData
  avatarDataUrl?: string
  /** Character Card V3 `emotion` assets, mapped to expression ids — empty for a plain V1/V2 card. */
  sprites?: Record<string, string>
  /** Expression ids from V3 assets that aren't in the built-in set. */
  customExpressions?: CustomExpression[]
}

/** Imports a SillyTavern / Character-Card-V3 card from a .png (embedded metadata) or .json file. */
export async function importCharacterFile(file: File): Promise<ImportResult> {
  if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
    const raw = await readCharacterFromPng(file)
    const card = normalizeCardJson(raw)
    const assets = extractCardAssets(raw)
    // The PNG's own pixels are the portrait (a V3 `icon` asset is usually `ccdefault:` = "this image").
    const avatarDataUrl = await fileToDataUrl(file)
    return { card, avatarDataUrl, sprites: assets.sprites, customExpressions: assets.customExpressions }
  }
  const text = await file.text()
  const raw = JSON.parse(text)
  const card = normalizeCardJson(raw)
  const assets = extractCardAssets(raw)
  return {
    card,
    avatarDataUrl: assets.avatarDataUrl,
    sprites: assets.sprites,
    customExpressions: assets.customExpressions,
  }
}

export function downloadJson(card: CharacterCardData) {
  const blob = new Blob([JSON.stringify(wrapCardV2(card), null, 2)], { type: 'application/json' })
  triggerDownload(blob, `${sanitizeFilename(card.name)}.json`)
}

export async function downloadPng(card: CharacterCardData, avatarDataUrl?: string) {
  const avatarBlob = avatarDataUrl
    ? await (await fetch(avatarDataUrl)).blob()
    : await blankAvatarBlob()
  const pngBlob = await writeCharacterToPng(avatarBlob, wrapCardV2(card))
  triggerDownload(pngBlob, `${sanitizeFilename(card.name)}.png`)
}

function sanitizeFilename(name: string): string {
  return (name || 'character').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'character'
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function blankAvatarBlob(): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 600
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#3a3a3a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
}
