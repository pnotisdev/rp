import type { ItemDef, WorldCard } from '@/lib/types'

/** No built-in default catalog the way `gifts.ts` has one — items are opt-in per world, not a baseline every character gets. */
export function getItemCatalog(world?: WorldCard): ItemDef[] {
  return world?.items ?? []
}

export function itemById(id: string, world?: WorldCard): ItemDef | undefined {
  return getItemCatalog(world).find((i) => i.id === id)
}
