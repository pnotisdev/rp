import { slugifyId } from '@/lib/text/slugify'

/**
 * Outfits: a second axis on the sprite grid.
 *
 * `Character.sprites` was a flat `expressionId -> url` map — one image per expression, and no way
 * for what the player *sees* to change as a scene does. A story could move anywhere narratively
 * while the sprite stayed in the same clothes. This adds the missing axis, so a character can have
 * a school uniform, a swimsuit, and an undressed state, each with its own expression set.
 *
 * **Not image compositing.** "Layered sprites" in the VN world usually means stacking transparent
 * body/clothing/expression PNGs at authored offsets. That needs art authored as layers, which is
 * not what card packs in this ecosystem actually ship, and it would make every existing character
 * unrepresentable. An outfit here is a complete alternate sprite — the same thing VN packs already
 * distribute — selected by a second id. Cheaper, and it works with art people actually have.
 *
 * ## Storage: composite keys in the existing map, so nothing migrates
 *
 * The base outfit keeps using the bare expression id (`blush`), which is byte-for-byte what every
 * character already stores — so every existing card is already a valid one-outfit character with
 * no migration, no new column, and no backfill. A named outfit prefixes its id (`swimsuit--blush`).
 *
 * `--` is an unambiguous separator, not a guess: every id on both sides is produced by either
 * `DEFAULT_EXPRESSION_IDS` (hardcoded, no hyphen runs) or `slugifyId`, which collapses every run
 * of non-alphanumerics to a *single* `-` and strips leading/trailing ones. So no id can contain
 * `--`, and splitting on the first occurrence is exact even when both halves contain single
 * hyphens (`school-uniform--half-smile` parses correctly).
 *
 * Keeping it inside `sprites` also means the whole server-side media pipeline works unchanged:
 * `resolveAvatarMap` writes each key to its own file, `pruneUnreferencedFiles` deletes an outfit's
 * art the moment its keys stop being sent, and backup/restore and character-delete already walk
 * the same per-entity folder. A nested `Record<outfit, Record<expression, url>>` would have needed
 * all four of those touched, and a per-outfit subdirectory would have put an author-supplied id
 * into a filesystem path — the exact shape `SAFE_KEY_RE` exists to prevent.
 */

/** Separates the outfit id from the expression id in a composite sprite key. See this module's doc comment for why two hyphens is unambiguous. */
export const OUTFIT_SEPARATOR = '--'

/**
 * The unprefixed outfit — the art a character already had before outfits existed. Reserved: it is
 * always present, never appears in `Character.outfits`, and `slugifyOutfitId` refuses to mint it.
 */
export const BASE_OUTFIT_ID = 'base'

/** A wardrobe state for a character. The base outfit is implicit and never stored as one of these. */
export interface Outfit {
  id: string
  label: string
  /**
   * Affection gate, same convention and default (`0`) as `Character.spriteUnlocks`. An outfit that
   * isn't unlocked is never offered to the model and never resolves, so a "swimsuit" can be real
   * art sitting on disk from turn one without showing up before the story earns it.
   */
  unlockAffection?: number
  /** Every one of these scene flags must be set before the outfit unlocks. Empty/unset = no flag gate. */
  requiredFlags?: string[]
  /**
   * Withheld from the model's scene-tag menu even when unlocked — for a state that should only
   * ever be entered deliberately (by the app during an intimate scene, or by the player), not
   * picked because a reply happened to read as suggestive.
   */
  manualOnly?: boolean
  /**
   * The wardrobe state an explicit intimacy action puts this character into. When the player uses
   * an explicit-tier option from the Relationship panel (a position, a toy, an activity — never a
   * kissing spot), the app switches to this outfit itself rather than hoping the model tags it.
   *
   * That direction is deliberately one-way. Entering is a discrete, unambiguous, player-initiated
   * act, which is exactly the kind of thing this app resolves deterministically; *leaving* is a
   * narrative judgement with no comparable signal, so the story tags its way back out via an
   * ordinary `outfit=` on a later reply. Pairs naturally with `manualOnly`, which stops the model
   * putting anyone here on its own — but the two stay independent, since a world may reasonably
   * want an intimate outfit the model can also select.
   */
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

/** Turns a free-typed outfit name into a safe id, deduplicated against existing outfits and against the reserved base id. */
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

/** How many of `expressionIds` this outfit has drawn — for the editor's per-outfit coverage line. */
export function outfitCoverage(
  sprites: Record<string, string> | undefined,
  outfitId: string,
  expressionIds: string[],
): { drawn: number; total: number } {
  const have = new Set(expressionIdsForOutfit(sprites, outfitId))
  return { drawn: expressionIds.filter((id) => have.has(id)).length, total: expressionIds.length }
}

/**
 * Whether an outfit's gates are currently satisfied. `manualOnly` is deliberately NOT considered
 * here — it controls whether the *model* may pick an outfit, not whether the outfit is available
 * at all, so the app and the player can still select one that's unlocked but withheld.
 */
export function isOutfitUnlocked(outfit: Outfit, affection: number, flags: ReadonlySet<string>): boolean {
  if (affection < Number(outfit.unlockAffection ?? 0)) return false
  return (outfit.requiredFlags ?? []).every((f) => flags.has(f))
}

/**
 * The outfits the model may tag right now: unlocked, not `manualOnly`, and actually holding at
 * least one sprite — offering an id with no art behind it would just spend prompt tokens to
 * produce a tag that resolves straight back to the base outfit.
 *
 * Always includes `BASE_OUTFIT_ID`, since the base art is what every character has and is the
 * thing an outfit-tagged scene needs to be able to return *to*.
 */
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
 * tag actually set, scanning backwards.
 *
 * Outfits are sticky by design. A model that simply doesn't repeat the field on the next turn
 * shouldn't undress anyone, so an absent tag means "unchanged" rather than "back to base" — which
 * makes the answer the last *explicit* outfit, not whatever the newest message happens to carry.
 *
 * Typed structurally rather than against `StoredMessage` so this module stays free of the app's
 * chat types; every caller (the VN stage, the reactive portrait, the prompt builder) passes real
 * stored messages.
 */
export function currentOutfitFrom(
  messages: readonly { role: string; scene?: { outfit?: string }; swipeScenes?: ({ outfit?: string } | undefined)[]; activeSwipe?: number }[],
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    // Deliberately not filtered to `role === 'char'`: a player's explicit intimacy action stamps
    // an outfit onto their *own* message (see `intimateOutfitFor`), and it has to take effect from
    // that moment rather than waiting for the reply to agree. Nothing else ever writes a scene tag
    // to a user message, so this reads identically for every ordinary chat.
    const scene = m.swipeScenes?.[m.activeSwipe ?? 0] ?? m.scene
    if (scene?.outfit) return scene.outfit
  }
  return BASE_OUTFIT_ID
}

/**
 * Coerces a model-supplied outfit tag to something safe to render. Anything unknown, locked,
 * `manualOnly`, or artless collapses to the base outfit rather than being honoured — the same
 * "the model proposes, the app disposes" contract the relationship judge and scene flags follow.
 */
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
