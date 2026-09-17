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
 * Phrases beyond a background's own label/id that indicate it. A greeting almost never says
 * "school hallway" outright — it says lockers, or the corridor — which is why the label-only match
 * this replaces so rarely fired, leaving VN mode on a bare placeholder for the opening scene.
 * Default backgrounds only; a world's custom background still matches on its own label/id, which is
 * all this app knows about it.
 */
const BACKGROUND_ALIASES: Record<string, string[]> = {
  classroom: ['class room', 'homeroom', 'blackboard', 'chalkboard', 'her desk', 'his desk', 'the desks', 'after class', 'during class', 'lesson'],
  'school-hallway': ['hallway', 'corridor', 'lockers', 'locker', 'the halls'],
  'school-rooftop': ['school roof', 'roof of the school', 'rooftop of the school'],
  'school-gate': ['school gates', 'front gate', 'the gates'],
  'school-courtyard': ['courtyard', 'schoolyard', 'quad'],
  library: ['bookshelves', 'the shelves', 'the stacks', 'reading room', 'study room', 'librarian', 'media room', 'card catalog', 'card-catalog'],
  'club-room': ['clubroom', 'club house', 'clubhouse'],
  gymnasium: ['the gym', 'sports hall', 'basketball court', 'volleyball court'],
  'school-nurse-office': ['infirmary', 'nurse office', "nurse's office", 'sick bay'],
  cafeteria: ['lunchroom', 'canteen', 'dining hall'],
  'city-street': ['the street', 'downtown', 'sidewalk', 'crosswalk', 'busy street', 'city sidewalk', 'shopping district'],
  'train-station': ['the platform', 'train platform', 'the subway', 'subway station', 'ticket gate', 'last train'],
  'convenience-store': ['konbini', 'corner store', 'the register', 'supermarket', 'grocery store'],
  restaurant: ['the diner', 'a diner', 'the table for two', 'ramen shop', 'izakaya', 'dinner out'],
  cafe: ['coffee shop', 'coffee house', 'the counter', 'latte', 'espresso'],
  karaoke: ['karaoke box', 'karaoke room', 'the microphone'],
  'movie-theater': ['cinema', 'the movies', 'movie theatre', 'the screen dims', 'back row'],
  hospital: ['hospital room', 'hospital bed', 'the ward', 'waiting room', 'emergency room'],
  rooftop: ['the roof', 'up on the roof', 'roof access'],
  park: ['the bench', 'park bench', 'playground', 'the fountain', 'garden path'],
  forest: ['the woods', 'the trees', 'treeline', 'woodland', 'the grove'],
  beach: ['the shore', 'the sand', 'shoreline', 'the waves', 'seaside', 'ocean'],
  shrine: ['torii', 'the temple', 'shrine grounds', 'offering box', 'the omikuji'],
  onsen: ['hot spring', 'hot springs', 'the bath house', 'bathhouse'],
  festival: ['summer festival', 'the stalls', 'food stalls', 'festival grounds', 'yukata', 'matsuri'],
  'fireworks-viewing': ['the fireworks', 'firework display', 'hanabi'],
  'living-room': ['the couch', 'the sofa', 'the coffee table', 'the tv', 'her apartment', 'his apartment', 'her place', 'his place'],
  bedroom: ['her room', 'his room', 'my room', 'your room', 'the bed', 'her bed', 'his bed', 'futon', 'the sheets', 'bedside'],
  kitchen: ['the stove', 'the counter top', 'countertop', 'the fridge', 'cooking', 'the kettle'],
  shower: ['the bathroom', 'bath tub', 'bathtub', 'under the water', 'the steam'],
  office: ['the desk job', 'her office', 'his office', 'meeting room', 'the cubicle', 'break room', 'overtime'],
}

/** Whole-word (or whole-phrase) containment, so "cafe" doesn't fire inside "cafeteria" and "park" doesn't fire inside "parking". */
function containsPhrase(haystack: string, needle: string): boolean {
  const i = haystack.indexOf(needle)
  if (i === -1) return false
  const before = i === 0 ? '' : haystack[i - 1]
  const after = haystack[i + needle.length] ?? ''
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)
}

/**
 * Deterministic, no-model fallback for tagging a scene's location: matches narration against
 * candidate background labels/ids and their `BACKGROUND_ALIASES`, so VN mode still opens on
 * something plausible even with no client to run `detectGreetingScene` (or when it declined).
 * Longest matching phrase wins, so a specific label beats a generic alias; returns `undefined`
 * when nothing in the text matches, which is what keeps a genuinely unplaceable scene unplaced
 * rather than guessed at.
 */
export function matchBackgroundKeyword(text: string, candidates: { id: string; label: string }[]): string | undefined {
  const lower = text.toLowerCase()
  let best: { id: string; length: number } | undefined
  for (const c of candidates) {
    const needles = new Set([
      c.label.toLowerCase(),
      c.id.replace(/-/g, ' ').toLowerCase(),
      ...(BACKGROUND_ALIASES[c.id] ?? []),
    ])
    for (const needle of needles) {
      if (needle.length < 4) continue // skip needles too short to mean much ("bar" inside "barely")
      if (containsPhrase(lower, needle) && (!best || needle.length > best.length)) best = { id: c.id, length: needle.length }
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
