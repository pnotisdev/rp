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
/**
 * Item 4(b)'s "thoughtful vs. expensive" distinction — passed only for an ordinary first-time,
 * non-mismatched gift (see the call site below), since a repeat or a real dislike already has its
 * own, stronger-signal framing above. `rarity` is the gift's own catalog tier; `preferenceScore` is
 * the same authored -2..3 score `useChatSession.ts` already reads for the base delta. Neither
 * `giftPreferences` alone (already reflected in the base stat delta) nor `rarity` alone currently
 * shapes the character's own *reaction text* — this is the gap: a cheap gift that happens to be
 * exactly this character's taste should read as more touching than an expensive one that leaves them
 * cold, which the delta math already gets right but the reaction guidance never said out loud.
 */
export interface GiftTaste {
  rarity: GiftRarity
  preferenceScore: number
}

/** A cheap/mid gift that scores as a genuine favorite (`giftMismatchPenalty`'s own bar is -0.5 for a miss; this is the mirror-image "clearly loved" bar). */
function isThoughtfulNotExpensive(taste: GiftTaste): boolean {
  return (taste.rarity === 'common' || taste.rarity === 'uncommon') && taste.preferenceScore >= 2
}

/** An expensive gift that lands as merely neutral (never negative — that's a mismatch, handled above) rather than genuinely wanted. */
function isExpensiveNotThoughtful(taste: GiftTaste): boolean {
  return (taste.rarity === 'rare' || taste.rarity === 'epic') && taste.preferenceScore >= -0.5 && taste.preferenceScore < 2
}

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

/** A modest starter inventory drawn from whichever catalog is active, so it never references a gift id that doesn't exist in it. */
export function defaultGiftInventory(world?: WorldCard): Record<string, number> {
  const catalog = [...getGiftCatalog(world)].sort((a, b) => a.price - b.price)
  const starters = catalog.slice(0, 2)
  const inventory: Record<string, number> = {}
  for (const gift of starters) inventory[gift.id] = 1
  return inventory
}

/**
 * Item 4(a): `suggestDateEvent` (`relationshipAssist.ts`) drafts an event card with zero awareness of
 * gift history, so a suggestion can never plausibly build on one ("a shared restaurant after a
 * favorite-novel gift"). This is the bridge: the most recent gift on `giftLog` that scored as a real,
 * authored favorite (`>= 2`, the same bar `useChatSession.ts` already uses for the durable-memory
 * hook right after a gift lands), by name, ready to fold into that prompt. Undefined for the common
 * case of a relationship with no such gift yet on record — this only ever looks backward at what
 * genuinely happened, never invents one.
 */
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

/**
 * Item 6: character-initiated gift reciprocity — a lightweight, narrative nudge, deliberately not a
 * parallel gift economy (no new inventory/coin plumbing). Same "turn-stamped, decaying window" shape
 * `dating/rebuff.ts`'s `RecentRebuff` and `dating/aftercare.ts`'s `Afterglow` already use for a cue
 * that should color a handful of turns and then quietly stop mattering, rather than either firing
 * once and vanishing or nagging forever. Stored per relationship (`RelationshipTrack.reciprocityCue`).
 * `null` clears it, same convention as `Afterglow`/`RecentRebuff`.
 */
export const RECIPROCITY_WINDOW_TURNS = 4

/** What actually earned the cue — read back into the guidance text so the reason given fits what really happened. */
export type ReciprocityReason = 'gift_received' | 'milestone'

export interface ReciprocityCue {
  /** `messages.length` when the cue was set — the same turn unit `GiftLogEntry.turn` already uses (gift-giving isn't scoped to the character's own reply count the way `Afterglow`/`RecentRebuff` are). */
  startedAtTurn: number
  reason: ReciprocityReason
}

export function isReciprocityCueActive(cue: ReciprocityCue | undefined | null, currentTurn: number): boolean {
  if (!cue) return false
  const since = currentTurn - cue.startedAtTurn
  return since >= 0 && since < RECIPROCITY_WINDOW_TURNS
}

/**
 * The `styleGuidance` line for the still-live window — permits, never requires, a small reciprocal
 * gesture. Deliberately narrative only: the character can "reciprocate" with a small in-character
 * gift/gesture the model writes into the scene, not a mechanical grant of coins/inventory. Real
 * names, no `{{macros}}` (see `mindGuidance.ts`'s own note on why).
 */
export function reciprocityGuidance(charName: string, userName: string, reason: ReciprocityReason): string {
  const because =
    reason === 'gift_received'
      ? `${userName} gave them something not long ago that genuinely landed`
      : `things between them have genuinely deepened to a new point lately`
  return `Right now, ${because} — it would be earned, not forced, for ${charName} to reciprocate in some small way of their own: a small gift, a thoughtful gesture, something they made or picked out, or simply showing up with something in hand. This is an option, not an obligation — ${charName} doesn't have to act on it this exact turn, and if they do, it should come from who they are rather than read as a mechanical tit-for-tat.`
}
