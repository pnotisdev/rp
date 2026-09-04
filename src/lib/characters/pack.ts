import { charactersApi, worldsApi } from '@/lib/api/client'
import { fileToDataUrl } from './importExport'
import type { Character, CharacterCardData, GalleryEntry, Lorebook, RelationshipStarter, SocialConnection } from './cardSpec'
import type { CustomSceneFlag, GiftItem, ItemDef, WorldCard } from '@/lib/types'
import type { CustomExpression } from '@/lib/vn/expressions'
import type { ScheduleEntry, WeatherPreferences } from '@/lib/world/calendar'

const PACK_KIND = 'rp-character-pack'
const PACK_VERSION = 1

export interface CharacterPackV1 {
  kind: typeof PACK_KIND
  version: typeof PACK_VERSION
  character: {
    card: CharacterCardData
    avatarDataUrl?: string
    sprites?: Record<string, string>
    spriteUnlocks?: Record<string, number>
    customExpressions?: CustomExpression[]
    giftPreferences?: Record<string, number>
    giftLikes?: string[]
    giftDislikes?: string[]
    loveLanguage?: string
    weatherPreferences?: WeatherPreferences
    schedule?: ScheduleEntry[]
    gallery?: GalleryEntry[]
    relationshipStarters?: RelationshipStarter[]
    voice?: Character['voice']
    sfxWords?: string[]
    occupation?: string
    workplace?: string
    homeLocation?: string
    frequentedLocations?: string[]
    likes?: string[]
    goals?: string[]
    boundaries?: string[]
    socialConnections?: SocialConnection[]
    dateModeOptOut?: boolean
  }
  world?: {
    name: string
    description: string
    rules?: string
    template?: WorldCard['template']
    lorebook: Lorebook
    avatarDataUrl?: string
    backgrounds?: Record<string, string>
    backgroundUnlocks?: Record<string, number>
    music?: Record<string, string>
    gifts?: GiftItem[]
    items?: ItemDef[]
    customSceneFlags?: CustomSceneFlag[]
    relationshipThresholds?: WorldCard['relationshipThresholds']
  }
}

/** Fetches a same-origin `/avatars/...` URL and inlines it as a data URL; passes data URLs through unchanged. */
export async function urlToDataUrl(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined
  if (url.startsWith('data:')) return url
  const res = await fetch(url)
  if (!res.ok) return undefined
  return fileToDataUrl(await res.blob())
}

async function mapToDataUrls(map: Record<string, string> | undefined): Promise<Record<string, string> | undefined> {
  if (!map || Object.keys(map).length === 0) return undefined
  const entries = await Promise.all(Object.entries(map).map(async ([k, v]) => [k, await urlToDataUrl(v)] as const))
  const result: Record<string, string> = {}
  for (const [k, v] of entries) if (v) result[k] = v
  return result
}

/**
 * Bundles a character — and, if given, its bound world — into one self-contained, portable
 * pack, inlining every server-hosted image (avatar, sprites, gallery CGs, backgrounds) as a
 * data URL. Unlike the bare card export, nothing that makes this a VN character gets dropped.
 */
export async function buildCharacterPack(character: Character, world?: WorldCard): Promise<CharacterPackV1> {
  const [avatarDataUrl, sprites, gallery] = await Promise.all([
    urlToDataUrl(character.avatarDataUrl),
    mapToDataUrls(character.sprites),
    Promise.all(
      (character.gallery ?? []).map(async (g) => ({ ...g, imageUrl: (await urlToDataUrl(g.imageUrl)) ?? g.imageUrl })),
    ),
  ])

  const pack: CharacterPackV1 = {
    kind: PACK_KIND,
    version: PACK_VERSION,
    character: {
      card: character.card,
      avatarDataUrl,
      sprites,
      spriteUnlocks: character.spriteUnlocks,
      customExpressions: character.customExpressions,
      giftPreferences: character.giftPreferences,
      giftLikes: character.giftLikes,
      giftDislikes: character.giftDislikes,
      loveLanguage: character.loveLanguage,
      weatherPreferences: character.weatherPreferences,
      schedule: character.schedule,
      gallery: gallery.length ? gallery : undefined,
      relationshipStarters: character.relationshipStarters,
      voice: character.voice,
      sfxWords: character.sfxWords,
      occupation: character.occupation,
      workplace: character.workplace,
      homeLocation: character.homeLocation,
      frequentedLocations: character.frequentedLocations,
      likes: character.likes,
      goals: character.goals,
      boundaries: character.boundaries,
      socialConnections: character.socialConnections,
      dateModeOptOut: character.dateModeOptOut,
    },
  }

  if (world) {
    const [worldAvatarDataUrl, backgrounds, music] = await Promise.all([
      urlToDataUrl(world.avatarDataUrl),
      mapToDataUrls(world.backgrounds),
      mapToDataUrls(world.music),
    ])
    pack.world = {
      name: world.name,
      description: world.description,
      rules: world.rules,
      template: world.template,
      lorebook: world.lorebook,
      avatarDataUrl: worldAvatarDataUrl,
      backgrounds,
      backgroundUnlocks: world.backgroundUnlocks,
      music,
      gifts: world.gifts,
      items: world.items,
      customSceneFlags: world.customSceneFlags,
      relationshipThresholds: world.relationshipThresholds,
    }
  }

  return pack
}

export function characterPackFilename(name: string): string {
  const safe = (name || 'character').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'character'
  return `${safe}.rppack.json`
}

export function downloadCharacterPack(pack: CharacterPackV1) {
  const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = characterPackFilename(pack.character.card.name)
  a.click()
  URL.revokeObjectURL(url)
}

export async function parseCharacterPackFile(file: File): Promise<CharacterPackV1> {
  const text = await file.text()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Not a valid JSON file.')
  }
  if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>).kind !== PACK_KIND) {
    throw new Error('Not a recognized character pack file (expected a .rppack.json exported from this app).')
  }
  return raw as CharacterPackV1
}

/** Recreates a character — and its bundled world, if present — from a pack, as brand-new records. */
export async function importCharacterPack(pack: CharacterPackV1): Promise<{ character: Character; world?: WorldCard }> {
  let world: WorldCard | undefined
  if (pack.world) {
    world = await worldsApi.create({
      name: pack.world.name,
      description: pack.world.description,
      rules: pack.world.rules,
      template: pack.world.template,
      lorebook: pack.world.lorebook,
      avatarDataUrl: pack.world.avatarDataUrl,
      backgrounds: pack.world.backgrounds,
      backgroundUnlocks: pack.world.backgroundUnlocks,
      music: pack.world.music,
      gifts: pack.world.gifts,
      items: pack.world.items,
      customSceneFlags: pack.world.customSceneFlags,
      relationshipThresholds: pack.world.relationshipThresholds,
    })
  }
  const character = await charactersApi.create({
    card: pack.character.card,
    avatarDataUrl: pack.character.avatarDataUrl,
    sprites: pack.character.sprites,
    spriteUnlocks: pack.character.spriteUnlocks,
    customExpressions: pack.character.customExpressions,
    giftPreferences: pack.character.giftPreferences,
    giftLikes: pack.character.giftLikes,
    giftDislikes: pack.character.giftDislikes,
    loveLanguage: pack.character.loveLanguage,
    weatherPreferences: pack.character.weatherPreferences,
    schedule: pack.character.schedule,
    gallery: pack.character.gallery,
    relationshipStarters: pack.character.relationshipStarters,
    voice: pack.character.voice,
    sfxWords: pack.character.sfxWords,
    occupation: pack.character.occupation,
    workplace: pack.character.workplace,
    homeLocation: pack.character.homeLocation,
    frequentedLocations: pack.character.frequentedLocations,
    likes: pack.character.likes,
    goals: pack.character.goals,
    boundaries: pack.character.boundaries,
    socialConnections: pack.character.socialConnections,
    dateModeOptOut: pack.character.dateModeOptOut,
    worldId: world?.id,
  })
  return { character, world }
}
