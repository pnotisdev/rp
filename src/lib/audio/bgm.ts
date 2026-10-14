import type { SceneTag } from '@/lib/vn/sceneTag'
import type { WorldCard } from '@/lib/types'
import { BGM_DEFAULT_KEY, SCENE_MOOD_IDS } from '@/lib/vn/moods'

/** A loose location -> mood fallback, used only when the model didn't tag a mood (an older reply, a backend that doesn't follow the… */
const BACKGROUND_MOOD_FALLBACK: Record<string, string> = {
  bedroom: 'tender',
  beach: 'dreamy',
  rooftop: 'dreamy',
  park: 'calm',
  forest: 'calm',
  cafe: 'calm',
  'living-room': 'calm',
  office: 'tense',
}

/** Picks the background-music track for the current moment, in priority order: 1. */
export function resolveBgmTrack(world: WorldCard | undefined, scene: SceneTag | undefined): string | undefined {
  const music = world?.music
  if (!music || Object.keys(music).length === 0) return undefined

  const mood = scene?.mood && SCENE_MOOD_IDS.includes(scene.mood) ? scene.mood : undefined
  if (mood && music[mood]) return music[mood]

  const fallbackMood = scene?.background ? BACKGROUND_MOOD_FALLBACK[scene.background] : undefined
  if (fallbackMood && music[fallbackMood]) return music[fallbackMood]

  return music[BGM_DEFAULT_KEY] || undefined
}
