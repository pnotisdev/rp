import type { GiftItem, GiftRarity, WorldCard } from '@/lib/types'

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
