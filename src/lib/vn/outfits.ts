import { slugifyId } from '@/lib/text/slugify'

/**
 * Outfits: a second axis on the sprite grid, so a character can have a school uniform, a swimsuit,
 * and an undressed state, each with its own expression set. An outfit is a complete alternate
 * sprite (not layered/composited art) selected by a second id, stored as a composite key
 * (`outfit--expression`) in the existing `sprites` map so no migration or new storage is needed —
 * the base outfit keeps using the bare expression id every character already stores.
 */

/** Separates the outfit id from the expression id in a composite sprite key. Safe because neither id (hardcoded defaults or `slugifyId` output) can itself contain `--`. */
export const OUTFIT_SEPARATOR = '--'

/** The unprefixed outfit — the art a character already had before outfits existed. Always present; never appears in `Character.outfits`. */
export const BASE_OUTFIT_ID = 'base'

/** A wardrobe state for a character. The base outfit is implicit and never stored as one of these. */
export interface Outfit {
  id: string
  label: string
  /** Affection gate, same convention/default as `Character.spriteUnlocks`. */
  unlockAffection?: number
  /** Every one of these scene flags must be set before the outfit unlocks. */
  requiredFlags?: string[]
  /** Withheld from the model's scene-tag menu even when unlocked — for a state only ever entered deliberately (app or player), never auto-picked. */
  manualOnly?: boolean
  /** The wardrobe state an explicit intimacy action switches this character into (one-way; the story tags its way back out via a later `outfit=`). */
  intimate?: boolean
}

/** The outfit an explicit intimacy action should switch to, if the character has one and it's unlocked. */
export function intimateOutfitFor(
  outfits: Outfit[] | undefined,
  sprites: Record<string, string> | undefined,
  affection: number,
  flags: ReadonlySet<string> = new Set(),
): string | undefined {
  return (outfits ?? []).find(
    (o) => o.intimate && isOutfitUnlocked(o, affection, flags) && expressionIdsForOutfit(sprites, o.id).length > 0,
  )?.id
}

/** The storage key for one expression of one outfit. The base outfit is unprefixed, which is exactly the pre-outfit format. */
export function spriteKey(outfitId: string | undefined, expressionId: string): string {
  if (!outfitId || outfitId === BASE_OUTFIT_ID) return expressionId
  return `${outfitId}${OUTFIT_SEPARATOR}${expressionId}`
}

/** Inverse of `spriteKey`. A key with no separator is a base-outfit key. */
export function parseSpriteKey(key: string): { outfitId: string; expressionId: string } {
  const idx = key.indexOf(OUTFIT_SEPARATOR)
  if (idx === -1) return { outfitId: BASE_OUTFIT_ID, expressionId: key }
  return {
    outfitId: key.slice(0, idx),
    expressionId: key.slice(idx + OUTFIT_SEPARATOR.length),
  }
}

/** Turns a free-typed outfit name into a safe id, deduplicated against existing outfits and the reserved base id. */
export function slugifyOutfitId(label: string, existingIds: string[]): string {
  return slugifyId(label, [...existingIds, BASE_OUTFIT_ID], 'outfit')
}

/** Which expression ids this outfit actually has art for. */
export function expressionIdsForOutfit(sprites: Record<string, string> | undefined, outfitId: string): string[] {
  return Object.keys(sprites ?? {})
    .map(parseSpriteKey)
    .filter((k) => k.outfitId === outfitId)
    .map((k) => k.expressionId)
}

/** How many of `expressionIds` this outfit has drawn, for the editor's coverage line. */
export function outfitCoverage(
  sprites: Record<string, string> | undefined,
  outfitId: string,
  expressionIds: string[],
): { drawn: number; total: number } {
  const have = new Set(expressionIdsForOutfit(sprites, outfitId))
  return { drawn: expressionIds.filter((id) => have.has(id)).length, total: expressionIds.length }
}

/** Whether an outfit's affection/flag gates are satisfied. Ignores `manualOnly`, which only governs model auto-selection. */
export function isOutfitUnlocked(outfit: Outfit, affection: number, flags: ReadonlySet<string>): boolean {
  if (affection < Number(outfit.unlockAffection ?? 0)) return false
  return (outfit.requiredFlags ?? []).every((f) => flags.has(f))
}

/** The outfits the model may tag right now: unlocked, not `manualOnly`, with at least one sprite drawn. Always includes `BASE_OUTFIT_ID`. */
export function selectableOutfitIds(
  outfits: Outfit[] | undefined,
  sprites: Record<string, string> | undefined,
  affection: number,
  flags: ReadonlySet<string> = new Set(),
): string[] {
  const usable = (outfits ?? [])
    .filter((o) => !o.manualOnly)
    .filter((o) => isOutfitUnlocked(o, affection, flags))
    .filter((o) => expressionIdsForOutfit(sprites, o.id).length > 0)
    .map((o) => o.id)
  return [BASE_OUTFIT_ID, ...usable]
}

/**
 * What the character is wearing as of the latest reply: the most recent `outfit` any stored scene
 * tag set, scanning backwards. Outfits are sticky — an absent tag means "unchanged", not "base" —
 * so this is the last *explicit* outfit, not whatever the newest message happens to carry.
 * Typed structurally (not against `StoredMessage`) so this module stays free of the app's chat types.
 */
export function currentOutfitFrom(
  messages: readonly { role: string; scene?: { outfit?: string }; swipeScenes?: ({ outfit?: string } | undefined)[]; activeSwipe?: number }[],
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    // Not filtered to role === 'char': a player's intimacy action stamps an outfit onto their own message too (see `intimateOutfitFor`).
    const scene = m.swipeScenes?.[m.activeSwipe ?? 0] ?? m.scene
    if (scene?.outfit) return scene.outfit
  }
  return BASE_OUTFIT_ID
}

/** Coerces a model-supplied outfit tag to something safe to render: anything unknown, locked, `manualOnly`, or artless collapses to the base outfit. */
export function sanitizeOutfitId(
  tagged: string | undefined,
  outfits: Outfit[] | undefined,
  sprites: Record<string, string> | undefined,
  affection: number,
  flags: ReadonlySet<string> = new Set(),
): string {
  if (!tagged) return BASE_OUTFIT_ID
  const id = tagged.trim().toLowerCase()
  return selectableOutfitIds(outfits, sprites, affection, flags).includes(id) ? id : BASE_OUTFIT_ID
}
