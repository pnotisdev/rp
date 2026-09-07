import { slugifyId } from '@/lib/text/slugify'

export interface BackgroundOption {
  id: string
  label: string
}

/** Default scene locations offered to every world so the LLM has somewhere to place the moment even
 *  with no custom art uploaded. Each can optionally have a night-lighting variant — see
 *  `WorldCard.backgroundsNight` and `calendar.ts`'s `isNightPhase`. */
export const DEFAULT_BACKGROUNDS: BackgroundOption[] = [
  // school
  { id: 'classroom', label: 'Classroom' },
  { id: 'school-hallway', label: 'School hallway' },
  { id: 'school-rooftop', label: 'School rooftop' },
  { id: 'school-gate', label: 'School gate' },
  { id: 'school-courtyard', label: 'School courtyard' },
  { id: 'library', label: 'Library' },
  { id: 'club-room', label: 'Club room' },
  { id: 'gymnasium', label: 'Gymnasium' },
  { id: 'school-nurse-office', label: 'School nurse office' },
  { id: 'cafeteria', label: 'Cafeteria' },
  // town
  { id: 'city-street', label: 'City street' },
  { id: 'train-station', label: 'Train station' },
  { id: 'convenience-store', label: 'Convenience store' },
  { id: 'restaurant', label: 'Restaurant' },
  { id: 'cafe', label: 'Café' },
  { id: 'karaoke', label: 'Karaoke' },
  { id: 'movie-theater', label: 'Movie theater' },
  { id: 'hospital', label: 'Hospital' },
  { id: 'rooftop', label: 'Rooftop' },
  // outdoors
  { id: 'park', label: 'Park' },
  { id: 'forest', label: 'Forest' },
  { id: 'beach', label: 'Beach' },
  { id: 'shrine', label: 'Shrine' },
  { id: 'onsen', label: 'Onsen' },
  { id: 'festival', label: 'Festival' },
  { id: 'fireworks-viewing', label: 'Fireworks viewing' },
  // home / work
  { id: 'living-room', label: 'Living room' },
  { id: 'bedroom', label: 'Bedroom' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'shower', label: 'Shower' },
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

/**
 * Deterministic, no-model fallback for tagging a chat's opening scene: matches greeting text
 * against candidate background labels/ids by keyword, so VN mode still opens on something
 * plausible even when there's no client to run `detectGreetingScene`'s model-based pass (or it
 * declined to answer). Longest matching needle wins so a more specific label beats a generic one;
 * returns `undefined` when nothing in the text matches.
 */
export function matchBackgroundKeyword(text: string, candidates: { id: string; label: string }[]): string | undefined {
  const lower = text.toLowerCase()
  let best: { id: string; length: number } | undefined
  for (const c of candidates) {
    const needles = new Set([c.label.toLowerCase(), c.id.replace(/-/g, ' ').toLowerCase()])
    for (const needle of needles) {
      if (needle.length < 4) continue // skip needles too short to mean much ("bar" inside "barely")
      if (lower.includes(needle) && (!best || needle.length > best.length)) best = { id: c.id, length: needle.length }
    }
  }
  return best?.id
}

/** The human-readable label for a background id — one of the 12 defaults, or a world's own custom
 *  one. Falls back to the raw id (title-cased) for one that's been removed from both lists since it
 *  was set, rather than showing nothing. */
export function backgroundLabel(id: string, world?: { customBackgrounds?: CustomBackground[] }): string {
  const found = DEFAULT_BACKGROUNDS.find((b) => b.id === id) ?? world?.customBackgrounds?.find((b) => b.id === id)
  if (found) return found.label
  return id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
