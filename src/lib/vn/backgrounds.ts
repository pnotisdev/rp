import { slugifyId } from '@/lib/text/slugify'

export interface BackgroundOption {
  id: string
  label: string
}

/** Default scene locations offered to every world so the LLM has somewhere to place the moment even with no custom art uploaded. */
export const DEFAULT_BACKGROUNDS: BackgroundOption[] = [
  { id: 'bedroom', label: 'Bedroom' },
  { id: 'living-room', label: 'Living room' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'cafe', label: 'Café' },
  { id: 'classroom', label: 'Classroom' },
  { id: 'school-hallway', label: 'School hallway' },
  { id: 'park', label: 'Park' },
  { id: 'city-street', label: 'City street' },
  { id: 'beach', label: 'Beach' },
  { id: 'forest', label: 'Forest' },
  { id: 'rooftop', label: 'Rooftop' },
  { id: 'office', label: 'Office' },
]

export const DEFAULT_BACKGROUND_IDS = DEFAULT_BACKGROUNDS.map((b) => b.id)

/**
 * A world-specific scene location beyond the 12 defaults — e.g. "the abandoned shrine" or "her
 * family's bookshop." Mirrors `CustomExpression` (`vn/expressions.ts`) exactly: same shape, same
 * "author extends a fixed default set per-subject" pattern, just for `WorldCard.backgrounds`
 * instead of `Character.sprites`.
 */
export interface CustomBackground {
  id: string
  label: string
}

export function slugifyBackgroundId(label: string, existingIds: string[]): string {
  return slugifyId(label, existingIds, 'location')
}

/** The human-readable label for a background id — one of the 12 defaults, or a world's own custom
 *  one. Falls back to the raw id (title-cased) for one that's been removed from both lists since it
 *  was set, rather than showing nothing. */
export function backgroundLabel(id: string, world?: { customBackgrounds?: CustomBackground[] }): string {
  const found = DEFAULT_BACKGROUNDS.find((b) => b.id === id) ?? world?.customBackgrounds?.find((b) => b.id === id)
  if (found) return found.label
  return id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
