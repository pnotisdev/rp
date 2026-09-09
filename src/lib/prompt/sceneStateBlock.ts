import { describeClothingSide, type ClothingState } from '@/lib/dating/clothing'
import { regionLabel, type ArousalBand, type BodyRegion } from '@/lib/dating/arousal'

// A terse, engine-rendered ledger of what is physically true right now, injected late (it rides in
// `styleGuidance`, which the builder places in the post-history block just before generation). Every
// line is state the app already holds, so none of it is the model's to invent or drift from.
//
// Deliberately not prose: the authored guidance in `intimacyScene.ts` says *how to write*, and this
// says *what is true*. A short structured block is both cheaper and much harder to skim past than the
// same facts spread through a paragraph.

export interface SceneStateFacts {
  charName: string
  userName: string
  /** Where the scene is, e.g. "Bedroom". */
  location?: string
  /** "Sunday night" — the same phrase `sceneContinuityNote` renders. */
  timePhase?: string
  /** In-world day number, when the world tracks a calendar. */
  day?: number
  /** What's physically happening, from the active catalog entry's resolved prompt note. */
  activity?: string
  /** Turns the current scene has been running. */
  sceneTurns?: number
  clothing?: ClothingState
  /** Regions currently in contact, from the last turn's observation — the anchor that stops hands relocating silently. */
  contactRegions?: BodyRegion[]
  /** The character's arousal band. The player's isn't tracked, so only one side is ever stated. */
  arousalBand?: ArousalBand
}

/** How each band reads to the model — the band name alone is engine jargon. */
const BAND_PHRASING: Record<ArousalBand, string> = {
  baseline: 'not yet worked up',
  warming: 'warming up',
  engaged: 'well into it',
  edge: 'close to the edge',
  over: 'right at the edge',
}

/**
 * The block, or `''` when there's nothing concrete to state — same "contributes nothing when unknown"
 * contract every other guidance line here follows.
 */
export function sceneStateBlock(facts: SceneStateFacts): string {
  const whereWhen = [facts.location, facts.timePhase, facts.day !== undefined ? `Day ${facts.day}` : '']
    .filter(Boolean)
    .join(', ')
  const lines = [
    whereWhen ? `Location: ${whereWhen}` : '',
    facts.activity
      ? `Physically: ${facts.activity}${facts.sceneTurns && facts.sceneTurns > 0 ? ` (turn ${facts.sceneTurns} of this scene)` : ''}`
      : '',
    facts.clothing && (facts.clothing.char?.length || facts.clothing.user?.length)
      ? `Clothing — ${facts.charName}: ${describeClothingSide(facts.clothing, 'char')}. ${facts.userName}: ${describeClothingSide(facts.clothing, 'user')}.`
      : '',
    facts.contactRegions?.length ? `In contact: ${facts.contactRegions.map(regionLabel).join(', ')}` : '',
    facts.arousalBand ? `${facts.charName} is ${BAND_PHRASING[facts.arousalBand]}` : '',
  ].filter(Boolean)
  if (!lines.length) return ''
  return `[SCENE STATE]\n${lines.join('\n')}\nThis is what is true right now. Don't contradict any line above, and don't re-describe something it says has already happened.`
}
