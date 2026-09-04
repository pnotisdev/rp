/**
 * Ambient *scene* moods — the emotional weather of a moment, distinct from a character's
 * `expression` (a face) and a `SceneFlag` (a milestone event). The model tags each VN reply with
 * the closest one (when a world has music for it), and it selects the background track. A small,
 * evocative set: enough to cover the emotional range without asking the model to split hairs.
 */
export interface SceneMood {
  id: string
  label: string
  /** Shown under the upload slot so an author knows what a track for this mood is for. */
  hint: string
}

export const SCENE_MOODS: SceneMood[] = [
  { id: 'tender', label: 'Tender', hint: 'Closeness, vulnerability, a quiet confession' },
  { id: 'romantic', label: 'Romantic', hint: 'The charged, swaying kind — a first kiss, a slow dance' },
  { id: 'cheerful', label: 'Cheerful', hint: 'Light, easy, everything is going well' },
  { id: 'playful', label: 'Playful', hint: 'Teasing, banter, a game between the two of you' },
  { id: 'lively', label: 'Lively', hint: 'A festival, a crowd, somewhere loud and moving' },
  { id: 'calm', label: 'Calm', hint: 'Slice-of-life, an ordinary afternoon, nothing at stake' },
  { id: 'dreamy', label: 'Dreamy', hint: 'Wistful, hazy, a rooftop at dusk' },
  { id: 'tense', label: 'Tense', hint: 'An argument, a confrontation, something about to break' },
  { id: 'somber', label: 'Somber', hint: 'Grief, a goodbye, a heavy silence' },
]

export const SCENE_MOOD_IDS = SCENE_MOODS.map((m) => m.id)

/** The extra slot every music-carrying world should fill — played whenever no mood-specific track applies. */
export const BGM_DEFAULT_KEY = 'default'

/** All keys a world's `music` map may use. */
export const BGM_KEYS = [BGM_DEFAULT_KEY, ...SCENE_MOOD_IDS]
