import type { GiftItem, GiftRarity, WorldCard } from '@/lib/types'

// Gift-giving depth: the catalog, a recency log distinct from the lifetime `giftsGiven` tally,
// re-gift/mismatch reaction shaping, and character-initiated gift reciprocity.

export interface GiftLogEntry {
  giftId: string
  /** Turn counter unit — `messages.length`, same as `CharacterPlan.formedTurn`. */
  turn: number
}

/** How many recent gifts to remember — a rolling window, not a lifetime history. */
export const GIFT_LOG_CAP = 8

/** Appends one gift-give event, trimming the log back to `GIFT_LOG_CAP`, keeping the most recent. */
export function appendGiftLog(log: GiftLogEntry[] | undefined, giftId: string, turn: number): GiftLogEntry[] {
  const next = [...(log ?? []), { giftId, turn }]
  return next.length > GIFT_LOG_CAP ? next.slice(next.length - GIFT_LOG_CAP) : next
}

/** How many times, most recently and back-to-back, this exact gift has just been given. `0` if a different gift broke the streak. Checked before this gift's own entry is appended. */
export function trailingSameGiftRun(log: GiftLogEntry[] | undefined, giftId: string): number {
  const entries = log ?? []
  let run = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].giftId === giftId) run++
    else break
  }
  return run
}

/** Scales a gift's positive warmth delta down the more repetitive it's become — full weight the first time, flattened toward hollow by the third-plus in a row. Never applied to an already-negative (mismatch) delta. */
export function giftRepetitionMultiplier(sameGiftRun: number): number {
  if (sameGiftRun <= 0) return 1
  if (sameGiftRun === 1) return 0.6
  if (sameGiftRun === 2) return 0.3
  return 0.1
}

/** Extra cost when a gift the character has an authored dislike for is given again after already missing once. `0` the first time (the base negative score already covers that miss). */
export function giftMismatchPenalty(preferenceScore: number, priorTimesGivenThisGift: number): number {
  if (preferenceScore >= -0.5) return 0
  return priorTimesGivenThisGift > 0 ? -1 : 0
}

export interface GiftTaste {
  rarity: GiftRarity
  preferenceScore: number
}

/** A cheap/mid gift that scores as a genuine favorite. */
function isThoughtfulNotExpensive(taste: GiftTaste): boolean {
  return (taste.rarity === 'common' || taste.rarity === 'uncommon') && taste.preferenceScore >= 2
}

/** An expensive gift that lands as merely neutral rather than genuinely wanted. */
function isExpensiveNotThoughtful(taste: GiftTaste): boolean {
  return (taste.rarity === 'rare' || taste.rarity === 'epic') && taste.preferenceScore >= -0.5 && taste.preferenceScore < 2
}

/** One-shot reaction steer for the reply turn right after a gift lands. `undefined` for the common case (first-time, well-matched gift) where `buildGiftTasteNote` already covers it. */
export function giftReactionGuidance(
  charName: string,
  userName: string,
  giftName: string,
  sameGiftRun: number,
  isMismatch: boolean,
  priorTimesGivenThisGift: number,
  taste?: GiftTaste,
): string | undefined {
  if (isMismatch && priorTimesGivenThisGift > 0) {
    return `This isn't the first time ${userName} has given ${charName} something like this even though it's never really landed for them. ${charName} can be genuinely gracious without pretending this is exactly what they wanted — a real reaction, not a performance of delight.`
  }
  if (sameGiftRun >= 2) {
    return `${userName} has now given ${charName} a ${giftName} several times in a row with nothing else in between. By now it can read as a little repetitive or hollow to ${charName} rather than landing with the same delight as the very first time — let that show honestly, without it becoming a real conflict.`
  }
  if (sameGiftRun === 1) {
    return `${userName} just gave ${charName} another ${giftName}, the same gift as last time. Still sweet, but ${charName} can notice the repeat rather than reacting exactly as freshly as the first time.`
  }
  if (taste && isThoughtfulNotExpensive(taste)) {
    return `The ${giftName} isn't a lavish or expensive gift, but it happens to be exactly ${charName}'s taste. Let that land as genuinely touching precisely because of how well-chosen and personal it is — the thought and the fit are what's moving here, not the price tag.`
  }
  if (taste && isExpensiveNotThoughtful(taste)) {
    return `The ${giftName} is a genuinely lavish, expensive gift, but it isn't really ${charName}'s taste. ${charName} can be sincerely appreciative of the gesture and the generosity without it landing as deeply personal — impressive is not the same feeling as truly wanted, and it's fine for the reaction to reflect that honestly.`
  }
  return undefined
}

/** Built-in fallback catalog, used by any character not living in a world with its own gifts. */
export const DEFAULT_GIFT_CATALOG: GiftItem[] = [
  { id: 'flower-bouquet', name: 'Flower Bouquet', rarity: 'common', price: 6, tags: ['romance', 'sweet'] },
  { id: 'handmade-charm', name: 'Handmade Charm', rarity: 'common', price: 7, tags: ['personal', 'cute'] },
  { id: 'artisan-chocolate', name: 'Artisan Chocolate', rarity: 'uncommon', price: 10, tags: ['sweet', 'comfort'] },
  { id: 'favorite-novel', name: 'Favorite Novel', rarity: 'uncommon', price: 12, tags: ['book', 'thoughtful'] },
  { id: 'silver-pendant', name: 'Silver Pendant', rarity: 'rare', price: 18, tags: ['romance', 'elegant'] },
  { id: 'festival-kimono', name: 'Festival Kimono', rarity: 'epic', price: 28, tags: ['event', 'romance'] },
]

const RARITY_MULTIPLIER: Record<GiftRarity, number> = {
  common: 1,
  uncommon: 1.25,
  rare: 1.6,
  epic: 2,
}

/** The active gift catalog for a character: the bound world's own gifts if it set any, else the default catalog. */
export function getGiftCatalog(world?: WorldCard): GiftItem[] {
  return world?.gifts?.length ? world.gifts : DEFAULT_GIFT_CATALOG
}

export function giftById(id: string, world?: WorldCard): GiftItem | undefined {
  return getGiftCatalog(world).find((g) => g.id === id)
}

export function giftImpactBase(id: string, world?: WorldCard): number {
  const item = giftById(id, world)
  if (!item) return 0
  return RARITY_MULTIPLIER[item.rarity]
}

/** A modest starter inventory drawn from whichever catalog is active. */
export function defaultGiftInventory(world?: WorldCard): Record<string, number> {
  const catalog = [...getGiftCatalog(world)].sort((a, b) => a.price - b.price)
  const starters = catalog.slice(0, 2)
  const inventory: Record<string, number> = {}
  for (const gift of starters) inventory[gift.id] = 1
  return inventory
}

/** The most recent gift on `giftLog` that scored as a real, authored favorite (`>= 2`), by name — for `suggestDateEvent` to plausibly build on ("a shared restaurant after a favorite-novel gift"). Undefined if no such gift is on record. */
export function recentMeaningfulGiftName(
  log: GiftLogEntry[] | undefined,
  giftPreferences: Record<string, number> | undefined,
  world?: WorldCard,
): string | undefined {
  const entries = log ?? []
  for (let i = entries.length - 1; i >= 0; i--) {
    const score = giftPreferences?.[entries[i].giftId] ?? 0
    if (score >= 2) {
      const gift = giftById(entries[i].giftId, world)
      if (gift) return gift.name
    }
  }
  return undefined
}

/** Character-initiated gift reciprocity — a narrative nudge only, no new inventory/coin plumbing. Same decaying-window shape as `rebuff.ts`'s `RecentRebuff`/`aftercare.ts`'s `Afterglow`. `null` clears it. */
export const RECIPROCITY_WINDOW_TURNS = 4

export type ReciprocityReason = 'gift_received' | 'milestone'

export interface ReciprocityCue {
  /** `messages.length` when the cue was set. */
  startedAtTurn: number
  reason: ReciprocityReason
}

export function isReciprocityCueActive(cue: ReciprocityCue | undefined | null, currentTurn: number): boolean {
  if (!cue) return false
  const since = currentTurn - cue.startedAtTurn
  return since >= 0 && since < RECIPROCITY_WINDOW_TURNS
}

/** Permits, never requires, a small in-character reciprocal gesture — narrative only, not a mechanical grant. */
export function reciprocityGuidance(charName: string, userName: string, reason: ReciprocityReason): string {
  const because =
    reason === 'gift_received'
      ? `${userName} gave them something not long ago that genuinely landed`
      : `things between them have genuinely deepened to a new point lately`
  return `Right now, ${because} — it would be earned, not forced, for ${charName} to reciprocate in some small way of their own: a small gift, a thoughtful gesture, something they made or picked out, or simply showing up with something in hand. This is an option, not an obligation — ${charName} doesn't have to act on it this exact turn, and if they do, it should come from who they are rather than read as a mechanical tit-for-tat.`
}
