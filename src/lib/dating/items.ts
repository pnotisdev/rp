import type { ItemDef, WorldCard } from '@/lib/types'

/** No built-in default catalog the way `gifts.ts` has one — items are opt-in per world, not a baseline every character gets. */
export function getItemCatalog(world?: WorldCard): ItemDef[] {
  return world?.items ?? []
}

export function itemById(id: string, world?: WorldCard): ItemDef | undefined {
  return getItemCatalog(world).find((i) => i.id === id)
}

/** One-line player-facing read of what an item does when used — shared by the shop and the Bag. */
export function itemEffectSummary(item: ItemDef): string {
  const e = item.effect
  if (e.kind === 'currency') return `+${e.amount} coins when used`
  if (e.kind === 'flag') return `Sets "${e.flag.replace(/_/g, ' ')}"`
  return `${e.amount > 0 ? '+' : ''}${e.amount} ${e.dimension} when used`
}
