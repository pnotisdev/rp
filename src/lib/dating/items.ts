import type { ItemDef, ItemEffect, WorldCard } from '@/lib/types'

/**
 * The baseline item catalog every chat gets, mirroring `gifts.ts`'s `DEFAULT_GIFT_CATALOG`.
 *
 * There wasn't one before — `getItemCatalog` was `world?.items ?? []`, which meant the whole
 * `ItemEffect` engine, the Bag panel and the Shop's Items section were invisible on a fresh install
 * unless a world author sat down and wrote items by hand. A gift is a gesture the character reacts
 * to; an item is a thing the player *uses*, with a stated effect. Both need to exist out of the box
 * for the difference between them to be legible at all.
 *
 * Prices sit inside the real coin economy: milestones pay +15, an accepted commitment ask +25, a
 * completed objective +12, and a date scores `affection delta × 2`, from a starting 24. So a common
 * is 3-8, an uncommon 9-14, a rare 15-22.
 */
export const DEFAULT_ITEM_CATALOG: ItemDef[] = [
  // --- Everyday consumables: the low band, where a small specific gesture is the whole point. ---
  {
    id: 'canned-coffee',
    name: 'Canned Coffee',
    rarity: 'common',
    price: 4,
    tags: ['comfort', 'casual'],
    description: 'Hot from the machine. Handed over without being asked for.',
    effect: { kind: 'relationship', dimension: 'comfort', amount: 3 },
  },
  {
    id: 'shared-umbrella',
    name: 'Convenience Store Umbrella',
    rarity: 'common',
    price: 5,
    tags: ['comfort', 'casual'],
    description: "You only bought the one. That's the point.",
    effect: { kind: 'relationship', dimension: 'comfort', amount: 4 },
  },
  {
    id: 'hand-warmer',
    name: 'Hand Warmer',
    rarity: 'common',
    price: 4,
    tags: ['comfort', 'thoughtful'],
    description: 'Shaken awake in your pocket before you hand it over.',
    effect: { kind: 'relationship', dimension: 'comfort', amount: 3 },
  },
  {
    id: 'spare-hair-tie',
    name: 'Spare Hair Tie',
    rarity: 'common',
    price: 3,
    tags: ['thoughtful', 'personal'],
    description: 'Small enough to be nothing. Specific enough to say you noticed.',
    effect: { kind: 'relationship', dimension: 'trust', amount: 3 },
  },
  {
    id: 'clean-notes',
    name: "Someone's Clean Notes",
    rarity: 'common',
    price: 5,
    tags: ['book', 'thoughtful'],
    description: 'The one gesture here that reads as competence rather than affection.',
    effect: { kind: 'relationship', dimension: 'respect', amount: 4 },
  },
  {
    id: 'melon-bread',
    name: 'Melon Bread',
    rarity: 'common',
    price: 4,
    tags: ['sweet', 'casual'],
    description: 'Still warm. Cheap enough to become a habit.',
    effect: { kind: 'relationship', dimension: 'comfort', amount: 3 },
  },
  {
    id: 'throat-lozenges',
    name: 'Throat Lozenges',
    rarity: 'common',
    price: 4,
    tags: ['comfort', 'thoughtful'],
    description: 'For after the karaoke, or after the crying.',
    effect: { kind: 'relationship', dimension: 'trust', amount: 3 },
  },

  // --- Repair. `tension` is the one dimension where down is the good direction, and nothing else
  //     in the app moves it deliberately — these are the closest thing to a potion this should have,
  //     which is why the effective one is expensive enough to think about. ---
  {
    id: 'apology-cake',
    name: 'Apology Cake',
    rarity: 'uncommon',
    price: 9,
    tags: ['sweet', 'thoughtful'],
    description: 'Carried the whole way without being put down once.',
    effect: { kind: 'relationship', dimension: 'tension', amount: -8 },
  },
  {
    id: 'long-walk',
    name: 'A Long Walk Home',
    rarity: 'uncommon',
    price: 10,
    tags: ['casual', 'comfort'],
    description: 'The long way round, so neither of you has to say anything yet.',
    effect: {
      kind: 'multi',
      effects: [
        { kind: 'relationship', dimension: 'tension', amount: -6 },
        { kind: 'relationship', dimension: 'comfort', amount: 3 },
      ],
    },
  },
  {
    id: 'honest-letter',
    name: 'An Honest Letter',
    rarity: 'rare',
    price: 16,
    tags: ['personal', 'thoughtful'],
    description: 'Written badly, three times, before this one.',
    effect: { kind: 'relationship', dimension: 'trust', amount: 8 },
  },

  // --- Flag setters. A flag is a permission rather than a stat — it gates gallery CGs, outfits and
  //     intimacy entries — so these are the most consequential purchases in the catalog. ---
  {
    id: 'festival-tickets',
    name: 'Festival Ticket Pair',
    rarity: 'uncommon',
    price: 12,
    tags: ['event', 'ticket'],
    description: 'Two tickets. Asking is the hard part.',
    effect: { kind: 'flag', flag: 'first_date' },
  },
  {
    id: 'matching-keychain',
    name: 'Matching Keychain',
    rarity: 'rare',
    price: 18,
    tags: ['cute', 'romance'],
    description: 'Buying it is the gesture. Handing it over is just the delivery.',
    effect: { kind: 'flag', flag: 'promise' },
  },
  {
    id: 'sealed-letter',
    name: 'Sealed Confession Letter',
    rarity: 'epic',
    price: 28,
    tags: ['romance', 'personal'],
    description: 'Sealed, so you cannot reread it and change your mind again.',
    effect: { kind: 'flag', flag: 'confession' },
  },

  // --- Income. A zero-price item is a job, not a purchase: the shop's one tap that pays in. ---
  {
    id: 'part-time-shift',
    name: 'A Picked-Up Shift',
    rarity: 'common',
    price: 0,
    tags: ['casual'],
    description: 'Someone called in sick. Tiring, but it pays.',
    effect: { kind: 'currency', amount: 12 },
  },
]

/** The active item catalog: the bound world's own items if it authored any, else the defaults. Same precedence rule as `getGiftCatalog`. */
export function getItemCatalog(world?: WorldCard): ItemDef[] {
  return world?.items?.length ? world.items : DEFAULT_ITEM_CATALOG
}

export function itemById(id: string, world?: WorldCard): ItemDef | undefined {
  return getItemCatalog(world).find((i) => i.id === id)
}

/** One effect, without the "when used" suffix — so a `multi` can join several of these. */
function describeEffect(e: ItemEffect): string {
  if (e.kind === 'currency') return `+${e.amount} coins`
  if (e.kind === 'flag') return `sets "${e.flag.replace(/_/g, ' ')}"`
  if (e.kind === 'multi') return e.effects.map(describeEffect).join(', ')
  return `${e.amount > 0 ? '+' : ''}${e.amount} ${e.dimension}`
}

/** One-line player-facing read of what an item does when used — shared by the shop and the Bag. */
export function itemEffectSummary(item: ItemDef): string {
  const e = item.effect
  // The one-effect wordings are load-bearing (they're asserted, and they read better than the
  // generic join), so they stay verbatim; only `multi` composes.
  if (e.kind === 'currency') return `+${e.amount} coins when used`
  if (e.kind === 'flag') return `Sets "${e.flag.replace(/_/g, ' ')}"`
  if (e.kind === 'multi') {
    const parts = describeEffect(e)
    return `${parts.charAt(0).toUpperCase()}${parts.slice(1)} when used`
  }
  return `${e.amount > 0 ? '+' : ''}${e.amount} ${e.dimension} when used`
}
