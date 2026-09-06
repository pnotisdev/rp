import type { SceneTag } from '@/lib/vn/sceneTag'

/**
 * Nudges the model to move the scene along once it's stayed in the same background for too long
 * — ordinary chat has no other push to do this, unlike a hangout/date event.
 */
const STATIC_SCENE_THRESHOLD = 6

/** Counts consecutive trailing char turns sharing the latest scene background. `count: 0` if untagged. */
export function countStaticSceneTurns(
  messages: { role: string; scene?: SceneTag | null }[],
): { count: number; currentBackground?: string } {
  const tagged = messages.filter((m): m is { role: string; scene: SceneTag } => m.role === 'char' && !!m.scene?.background)
  if (tagged.length === 0) return { count: 0 }
  const current = tagged[tagged.length - 1].scene.background
  let count = 0
  for (let i = tagged.length - 1; i >= 0; i--) {
    if (tagged[i].scene.background !== current) break
    count++
  }
  return { count, currentBackground: current }
}

/** A `styleGuidance` line prompting a scene change past the threshold; `''` otherwise. */
export function sceneProgressionNudge(
  staticTurns: number,
  opts: { scheduleLocation?: string; alternateBackgroundLabels?: string[] },
): string {
  if (staticTurns < STATIC_SCENE_THRESHOLD) return ''
  const suggestion = opts.scheduleLocation
    ? ` Your character's own routine has them normally at ${opts.scheduleLocation} around now — a natural direction to drift toward if nothing better fits.`
    : opts.alternateBackgroundLabels?.length
      ? ` A few places that would fit: ${opts.alternateBackgroundLabels.join(', ')}.`
      : ''
  return (
    "The scene has stayed in the same place for a while now. If it genuinely fits this moment, let it move — your character suggesting a change of scenery, time passing and picking up somewhere else, or simply continuing the scene while walking/traveling together are all fine." +
    suggestion +
    " Don't force it if the scene is still clearly building toward something right here, but default to moving on rather than lingering indefinitely in one spot."
  )
}
