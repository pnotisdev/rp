import type { GiftItem, GiftRarity, WorldCard } from '@/lib/types'

/**
 * Item 3's gifting depth: history, re-gifting, and a real (not just flavor-text) cost for a clear
 * mismatch. `Chat.giftsGiven`/`RelationshipTrack.giftsGiven` already tally a lifetime count per gift
 * id, but that's a bare total with no sense of *recency* — it can't tell "gave this once, ages ago"
 * from "just gave this again, and again before that". `GiftLogEntry`/`RelationshipTrack.giftLog`
 * (a small, bounded, append-only log, same shape idea as `CharacterPlan`'s own small persisted
 * lists) is that recency signal, kept separate from the lifetime tally rather than replacing it.
 *
 * The actual "gift history is legible to the model" half of item 3 (c) deliberately does NOT invent
 * a parallel reference-tracking system: a gift that lands as genuinely meaningful gets hooked into
 * the existing remembered-facts system (`ChatFact`, via `chatFactsApi` in `useChatSession.ts`),
 * which already reaches the prompt every turn — see that call site's own comment for why.
 */
export interface GiftLogEntry {
  giftId: string
  /** The turn counter unit this app already uses for a short-lived persisted list (`CharacterPlan.formedTurn` uses the same `messages.length` unit) — not char-reply-counted like `Afterglow`, since gift-giving isn't scoped to an intimate scene's own window. */
  turn: number
}

/** How many recent gifts to remember at all — a rolling window, not a lifetime history (that's what the separate `giftsGiven` tally is for). */
export const GIFT_LOG_CAP = 8

/** Appends one gift-give event, trimming the log back to `GIFT_LOG_CAP`, keeping the most recent. */
export function appendGiftLog(log: GiftLogEntry[] | undefined, giftId: string, turn: number): GiftLogEntry[] {
  const next = [...(log ?? []), { giftId, turn }]
  return next.length > GIFT_LOG_CAP ? next.slice(next.length - GIFT_LOG_CAP) : next
}

/**
 * How many times, most recently and back-to-back with nothing else in between, this exact gift has
 * just been given — the "obvious pattern, no variety" signal (item 3a). `0` the first time, or any
 * time a *different* gift broke the streak since. Checked against the log *before* this gift's own
 * new entry is appended, so "giving it now" is turn N+1 of the run, not counted twice.
 */
export function trailingSameGiftRun(log: GiftLogEntry[] | undefined, giftId: string): number {
  const entries = log ?? []
  let run = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].giftId === giftId) run++
    else break
  }
  return run
}

/**
 * Scales a gift's positive warmth delta by how repetitive it's become: full weight the first time,
 * still mostly sweet the second time running, and flattened toward a token/hollow reading by the
 * third-plus time in a row with no variety in between — matching the brief almost verbatim ("sweet
 * the first few times, hollow if it becomes an obvious pattern with no variety"). `sameGiftRun` is
 * `trailingSameGiftRun`'s own count, taken *before* this gift's new entry — so `0` means "not a
 * repeat right now" and gets full weight regardless of the gift's lifetime `giftsGiven` total.
 * Never applied to an already-negative delta (an authored dislike) — that's `giftMismatchPenalty`'s
 * job instead, and softening a delta that's already a miss would read backwards.
 */
export function giftRepetitionMultiplier(sameGiftRun: number): number {
  if (sameGiftRun <= 0) return 1
  if (sameGiftRun === 1) return 0.6
  if (sameGiftRun === 2) return 0.3
  return 0.1
}

/**
 * A small, real extra cost (item 3b) when a gift the character has an authored dislike for
 * (`Character.giftPreferences[id]` scored negative) is given *again* after already having missed
 * once — a repeated, clearly-mismatched gift reads as not paying attention, not just "meh" again.
 * `preferenceScore` is the same -2..3 authored score `useChatSession.ts` already reads for the base
 * delta; `-0.5` as the cutoff catches an authored dislike (`-1`/`-2`) without also penalizing a
 * merely-neutral `0`. Returns `0` the first time this specific gift was given (the base negative
 * score already covers that single miss) and every time for a gift with no real dislike on record.
 */
export function giftMismatchPenalty(preferenceScore: number, priorTimesGivenThisGift: number): number {
  if (preferenceScore >= -0.5) return 0
  return priorTimesGivenThisGift > 0 ? -1 : 0
}

/**
 * A `styleGuidance`-style line for the character's reply turn right after a gift lands — folded into
 * `extraStyleGuidance` the same one-shot way `intimacyActionDirective` already steers the turn right
 * after an intimacy action, so a re-gift or a mismatch reads differently in the actual prose, not
 * only in the stat math. Real names — never macro-substituted (see `mindGuidance.ts`'s own note).
 * Returns `undefined` on an ordinary first-time, well-matched gift — the common case, where the
 * existing gift-taste guidance (`buildGiftTasteNote`) already says everything that needs saying.
 */
export function giftReactionGuidance(
  charName: string,
  userName: string,
  giftName: string,
  sameGiftRun: number,
  isMismatch: boolean,
  priorTimesGivenThisGift: number,
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

/** A modest starter inventory drawn from whichever catalog is active, so it never references a gift id that doesn't exist in it. */
export function defaultGiftInventory(world?: WorldCard): Record<string, number> {
  const catalog = [...getGiftCatalog(world)].sort((a, b) => a.price - b.price)
  const starters = catalog.slice(0, 2)
  const inventory: Record<string, number> = {}
  for (const gift of starters) inventory[gift.id] = 1
  return inventory
}
