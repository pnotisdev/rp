import {
  Bookmark,
  Brush,
  Cake,
  Clover,
  Coffee,
  Feather,
  Gem,
  Gift,
  Heart,
  Music,
  PartyPopper,
  Sparkles,
  Ticket,
  type LucideIcon,
} from 'lucide-react'
import type { GiftRarity } from '@/lib/types'

// Shared visual vocabulary for anything sold or carried — gifts, items, toys. Purely derived from
// data the catalogs already carry (`rarity`, `tags`), so a world author gets a distinct-looking
// shop without authoring any art.

/**
 * A catalog entry's colour family: its rarity, or `intimate` for the toy catalog, which is gated by
 * warmth rather than priced by rarity and so has no rarity of its own to colour by.
 */
export type CatalogTone = GiftRarity | 'intimate'

/** Per-tone tint, built only from existing theme tokens so it survives a custom theme. */
export const RARITY_TONE: Record<CatalogTone, { text: string; ring: string; tile: string }> = {
  common: { text: 'text-text-muted', ring: 'ring-border', tile: 'bg-bg-sunken text-text-muted' },
  uncommon: { text: 'text-success', ring: 'ring-success/30', tile: 'bg-success/10 text-success' },
  rare: { text: 'text-accent', ring: 'ring-accent/30', tile: 'bg-accent/10 text-accent' },
  epic: { text: 'text-romance', ring: 'ring-romance/35', tile: 'bg-romance/12 text-romance' },
  intimate: { text: 'text-romance', ring: 'ring-romance/25', tile: 'bg-romance/10 text-romance' },
}

/** Tag -> icon, first match wins. Ordered most-specific first so `romance` beats a generic `sweet`. */
const TAG_ICONS: [string, LucideIcon][] = [
  ['romance', Heart],
  ['event', PartyPopper],
  ['elegant', Gem],
  ['luck', Clover],
  ['music', Music],
  ['book', Bookmark],
  ['creative', Brush],
  ['sweet', Cake],
  ['comfort', Coffee],
  ['cute', Sparkles],
  ['personal', Feather],
  ['thoughtful', Feather],
  ['ticket', Ticket],
  ['casual', Coffee],
]

/** The icon for a catalog entry, from its tags. `Gift` when nothing matches — never an empty tile. */
export function catalogIcon(tags: string[] | undefined, fallback: LucideIcon = Gift): LucideIcon {
  const lower = (tags ?? []).map((t) => t.toLowerCase())
  for (const [tag, icon] of TAG_ICONS) {
    if (lower.includes(tag)) return icon
  }
  return fallback
}

/** Epic/rare read as "special"; used to decide whether a card earns extra emphasis. */
export function isPremiumRarity(rarity: GiftRarity): boolean {
  return rarity === 'rare' || rarity === 'epic'
}
