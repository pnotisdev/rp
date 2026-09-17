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

/** Stardew's "one gift a day", generalized to a turn window rather than the world clock's actual
 *  day — the clock only advances when the player deliberately spends a day-planner action or a
 *  date/event, not with real elapsed turns, so a literal day-bound cap would rarely ever engage,
 *  and wouldn't apply at all to a chat with no bound world. A turn window achieves the same "don't
 *  gift-spam" goal for every chat, using data (`GiftLogEntry.turn`) already tracked. */
export const GIFT_CADENCE_WINDOW_TURNS = 6

/** How many gifts (any kind, not just a repeat of the one being given) landed within the last
 *  `GIFT_CADENCE_WINDOW_TURNS` turns — read before this gift's own log entry is appended, same
 *  convention `trailingSameGiftRun` already follows. */
export function recentGiftCount(log: GiftLogEntry[] | undefined, currentTurn: number): number {
  return (log ?? []).filter((e) => currentTurn - e.turn <= GIFT_CADENCE_WINDOW_TURNS).length
}

/** Diminishing returns the more gifts have landed recently, regardless of which ones — full weight
 *  for the first in the window, roughly halved for a second, heavily discounted beyond that. Never
 *  applied to an already-negative delta, same rule `giftRepetitionMultiplier` follows. */
export function giftCadenceMultiplier(recentCount: number): number {
  if (recentCount <= 0) return 1
  if (recentCount === 1) return 0.5
  return 0.2
}

/** Stardew's single biggest gift multiplier: a positive gift given on the character's actual
 *  birthday (`Character.birthday`, `world/calendar.ts`) is a special occasion regardless of
 *  whether this exact gift was just given yesterday — so it bypasses `giftRepetitionMultiplier`
 *  entirely rather than stacking with it. */
export const BIRTHDAY_GIFT_MULTIPLIER = 8

/** Replaces the normal repetition-based scaling with a flat `BIRTHDAY_GIFT_MULTIPLIER` on the
 *  character's actual birthday. Never amplifies an already-negative (mismatch) `baseDelta` —
 *  a birthday doesn't make a bad gift good, it just isn't punished extra either
 *  (`giftMismatchPenalty` still applies on top of this, same as any other day). */
export function giftBirthdayMultiplier(baseDelta: number, isBirthdayToday: boolean, sameGiftRun: number): number {
  if (baseDelta <= 0) return baseDelta
  return isBirthdayToday ? baseDelta * BIRTHDAY_GIFT_MULTIPLIER : baseDelta * giftRepetitionMultiplier(sameGiftRun)
}

/** One-shot reaction steer for a gift given on the character's actual birthday — replaces (not
 *  appends to) `giftReactionGuidance`'s taste-based read, since the occasion itself supersedes it:
 *  a birthday gift is a big deal regardless of whether it happens to be exactly their taste. */
export function birthdayGiftGuidance(charName: string, giftName: string): string {
  return `Today is ${charName}'s actual birthday, which makes ${giftName} land as a much bigger deal than an ordinary gift — genuine warmth, real delight that it's today of all days, and it's fair for ${charName} to actually thank the giver for remembering. This holds regardless of whether ${giftName} would otherwise have been exactly their taste.`
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

/** A short, player-facing read of a gift's discovered preference score, for the Shop tab's
 *  progressive taste reveal — only the two tiers this file already treats as meaningful elsewhere
 *  (`isThoughtfulNotExpensive`'s `>= 2` "beloved" cutoff, `isMismatch`'s `<= -0.5` cutoff
 *  elsewhere in `useChatSession.ts`); `''` for anything in-between, meaning "no badge — nothing
 *  learned worth showing yet". The caller gates this on the gift having actually been given at
 *  least once (`RelationshipTrack.giftsGiven`) — this function itself doesn't know "discovered". */
export function giftTasteLabel(charName: string, preferenceScore: number): string {
  if (preferenceScore >= 2) return `${charName} loves this`
  if (preferenceScore <= -0.5) return `Not really ${charName}'s taste`
  return ''
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
  /** Gifts of any kind within the recent turn window (`recentGiftCount`) — the soft cadence cap's own narrative counterpart. */
  recentGiftCount: number,
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
  if (recentGiftCount >= 2) {
    return `${userName} has been giving ${charName} gifts in quick succession lately. However this one lands on its own merits, it can also register as a little much in such a short span — each gift doesn't quite get to be its own moment when they're stacked this close together.`
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
/**
 * Twenty gifts across fourteen tags, sized so **every tag in `catalogVisuals.ts`'s `TAG_ICONS` has
 * at least two entries**. That's not decoration: `giftPreferences` scores a gift per character and
 * the shop only reveals a taste once one has actually been given, so with six gifts across nine
 * tags an authored preference had almost nothing to discriminate between — and
 * `giftRepetitionMultiplier` started flattening repeats before there was an alternative to switch
 * to. Two per tag is the floor at which "they like thoughtful things, not flashy ones" becomes a
 * readable pattern rather than a coin flip.
 */
export const DEFAULT_GIFT_CATALOG: GiftItem[] = [
  // common — the everyday register, cheap enough to give often
  { id: 'flower-bouquet', name: 'Flower Bouquet', rarity: 'common', price: 6, tags: ['romance', 'sweet'] },
  { id: 'handmade-charm', name: 'Handmade Charm', rarity: 'common', price: 7, tags: ['personal', 'cute'] },
  { id: 'omamori-charm', name: 'Omamori Charm', rarity: 'common', price: 5, tags: ['luck', 'cute'] },
  { id: 'mixtape', name: 'A Made Playlist', rarity: 'common', price: 6, tags: ['music', 'personal'] },
  { id: 'convenience-snacks', name: 'Armful of Convenience-Store Snacks', rarity: 'common', price: 4, tags: ['casual', 'sweet'] },
  { id: 'plush-keepsake', name: 'Ridiculous Plush', rarity: 'common', price: 5, tags: ['cute', 'comfort'] },
  // uncommon
  { id: 'artisan-chocolate', name: 'Artisan Chocolate', rarity: 'uncommon', price: 10, tags: ['sweet', 'comfort'] },
  { id: 'favorite-novel', name: 'Favorite Novel', rarity: 'uncommon', price: 12, tags: ['book', 'thoughtful'] },
  { id: 'four-leaf-clover', name: 'Pressed Four-Leaf Clover', rarity: 'uncommon', price: 9, tags: ['luck', 'personal'] },
  { id: 'aquarium-pass', name: 'Aquarium Day Pass', rarity: 'uncommon', price: 11, tags: ['ticket', 'casual'] },
  { id: 'sketchbook', name: 'Good Sketchbook', rarity: 'uncommon', price: 10, tags: ['creative', 'thoughtful'] },
  { id: 'paint-set', name: 'Small Paint Set', rarity: 'uncommon', price: 12, tags: ['creative', 'personal'] },
  { id: 'poetry-collection', name: 'Worn Poetry Collection', rarity: 'uncommon', price: 11, tags: ['book', 'elegant'] },
  // rare
  { id: 'silver-pendant', name: 'Silver Pendant', rarity: 'rare', price: 18, tags: ['romance', 'elegant'] },
  { id: 'concert-ticket', name: 'Concert Ticket', rarity: 'rare', price: 17, tags: ['music', 'ticket', 'event'] },
  { id: 'fountain-pen', name: 'Fountain Pen', rarity: 'rare', price: 16, tags: ['elegant', 'thoughtful'] },
  { id: 'knit-scarf', name: 'Hand-Knit Scarf', rarity: 'rare', price: 15, tags: ['personal', 'comfort', 'romance'] },
  { id: 'star-projector', name: 'Star Projector', rarity: 'rare', price: 19, tags: ['romance', 'thoughtful'] },
  // epic — the two things you save up for, and they say different things
  { id: 'festival-kimono', name: 'Festival Kimono', rarity: 'epic', price: 28, tags: ['event', 'romance'] },
  { id: 'couple-ring', name: 'Simple Couple Ring', rarity: 'epic', price: 30, tags: ['romance', 'elegant'] },
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
