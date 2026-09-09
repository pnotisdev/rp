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

/**
 * A `styleGuidance` line prompting a scene change past the threshold; `''` otherwise.
 *
 * Written as a *transition* rather than a topic change, because that is what it actually is here: a
 * new background, and in VN mode a visible cut. Naming the character keeps it from reading as an
 * instruction to the author rather than a beat in the story.
 */
export function sceneProgressionNudge(
  staticTurns: number,
  opts: { scheduleLocation?: string; alternateBackgroundLabels?: string[]; charName?: string },
): string {
  if (staticTurns < STATIC_SCENE_THRESHOLD) return ''
  const who = opts.charName ?? 'your character'
  const suggestion = opts.scheduleLocation
    ? ` ${who}'s own routine would normally have them at ${opts.scheduleLocation} around now, which is the easiest direction to drift if nothing better suggests itself.`
    : opts.alternateBackgroundLabels?.length
      ? ` Places that would fit: ${opts.alternateBackgroundLabels.join(', ')}.`
      : ''
  return (
    `The scene has stayed in the same place for a while now, and a background that never changes is how a story starts to feel like it has stopped. If the moment can carry it, move: ${who} suggesting somewhere else, a short skip forward and picking up after, or the two of them simply talking while they walk. Land the change in a line or two rather than narrating the journey.` +
    suggestion +
    " Don't force it if the scene is still clearly building toward something right here, but default to moving on rather than lingering indefinitely in one spot."
  )
}
