import type { SceneTag } from '@/lib/vn/sceneTag'

/**
 * How many consecutive turns (from the end backward) share the current scene's background before
 * `sceneProgressionNudge` starts saying anything — long enough that a real scene (a date, a tense
 * conversation) isn't interrupted mid-beat, short enough that "the whole roleplay is stuck in the
 * library" is felt within one sitting, not just eventually.
 */
const STATIC_SCENE_THRESHOLD = 6

/**
 * Counts how many of the most recent character turns, walking backward, share the same scene
 * background as the latest tagged one — `count: 0` if the latest character turn has no background
 * tag at all (nothing to compare against, e.g. a chat that's never used VN mode/scene tags).
 */
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
 * A `styleGuidance` line nudging the model to actually move the scene once it's been static for a
 * while — ordinary chat has no such push otherwise: the scene-tag instruction (`sceneTag.ts`'s
 * `buildSceneInstruction`) only ever asks the model to *label* whichever setting the story is
 * already in, never to progress it, and only a hangout/date event (a `DateEventCard`) injects a
 * genuinely new premise. This closes that gap for ordinary chat the same way — a deterministic
 * trigger (a turn count), with the model still writing the actual transition, same split as
 * `slowBurnPacing`/`intimacyGuidance`. Returns `''` below the threshold, so a chat that's already
 * moving around fine pays nothing for this.
 *
 * `scheduleLocation`, when given, is preferred over `alternateBackgroundLabels` — a character's own
 * authored routine ("she should be at the café about now") is a more in-world, specific reason to
 * move than a generic list of unlocked backgrounds, and reusing it doubles up on state the world
 * already tracks rather than inventing a parallel "where should the scene go" system.
 */
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
