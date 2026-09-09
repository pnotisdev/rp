import { describeClothingSide, type ClothingState } from '@/lib/dating/clothing'
import { AROUSAL_BAND_PHRASE, regionLabel, type ArousalBand, type BodyRegion } from '@/lib/dating/arousal'
import { describeContact, SCENE_PLAYER, type ContactEdge } from '@/lib/dating/sceneParticipants'

// A terse, engine-rendered ledger of what is physically true right now, injected late (it rides in
// `styleGuidance`, which the builder places in the post-history block just before generation). Every
// line is state the app already holds, so none of it is the model's to invent or drift from.
//
// Deliberately not prose: the authored guidance in `intimacyScene.ts` says *how to write*, and this
// says *what is true*. A short structured block is both cheaper and much harder to skim past than the
// same facts spread through a paragraph.

/** One character in a multi-participant scene, as the block needs to state them. */
export interface SceneStateParticipant {
  id: string
  name: string
  clothing?: ClothingState
  arousalBand?: ArousalBand
}

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
  /** The current `countCharReplies` value — the scale `ContactEdge.sinceTurn` is stamped on, so how long a contact has been held can be stated. */
  turnNow?: number
  clothing?: ClothingState
  /** Regions currently in contact, from the last turn's observation — the anchor that stops hands relocating silently. */
  contactRegions?: BodyRegion[]
  /** The character's arousal band. The player's isn't tracked, so only one side is ever stated. */
  arousalBand?: ArousalBand
  /**
   * Everyone in the scene besides the speaking character, when there is more than one
   * (`sceneParticipants.ts`). Each gets their own clothing and arousal line, because in a group scene
   * "who is where, and how far along" is precisely what a model cannot hold on its own.
   */
  participants?: SceneStateParticipant[]
  /** The contact graph — who is touching whom, where. Replaces `contactRegions` whenever it's present. */
  contact?: ContactEdge[]
}

/** Clothing for everyone the block knows about, on one line each, so no side is left for the model to guess. */
function clothingLines(facts: SceneStateFacts): string {
  const own = facts.clothing
  const sides: string[] = []
  if (own && (own.char?.length || own.user?.length)) {
    sides.push(`${facts.charName}: ${describeClothingSide(own, 'char')}`, `${facts.userName}: ${describeClothingSide(own, 'user')}`)
  }
  for (const participant of facts.participants ?? []) {
    if (participant.clothing?.char?.length) sides.push(`${participant.name}: ${describeClothingSide(participant.clothing, 'char')}`)
  }
  return sides.length ? `Clothing — ${sides.join('. ')}.` : ''
}

/** Every tracked character's band on one line. Asymmetry is the point: one at the edge while another is warming is a scene beat. */
function arousalLine(facts: SceneStateFacts): string {
  const reads: string[] = []
  if (facts.arousalBand) reads.push(`${facts.charName} is ${AROUSAL_BAND_PHRASE[facts.arousalBand]}`)
  for (const participant of facts.participants ?? []) {
    if (participant.arousalBand) reads.push(`${participant.name} is ${AROUSAL_BAND_PHRASE[participant.arousalBand]}`)
  }
  return reads.join('. ')
}

/**
 * The block, or `''` when there's nothing concrete to state — same "contributes nothing when unknown"
 * contract every other guidance line here follows.
 */
export function sceneStateBlock(facts: SceneStateFacts): string {
  const whereWhen = [facts.location, facts.timePhase, facts.day !== undefined ? `Day ${facts.day}` : '']
    .filter(Boolean)
    .join(', ')
  // A named roster matters in a group scene: the model has to know who is actually in the room before
  // any of the per-person lines below mean anything.
  const present = facts.participants?.length
    ? `Present: ${[facts.charName, ...facts.participants.map((p) => p.name), facts.userName].join(', ')}`
    : ''
  const nameOf = (id: string) =>
    id === SCENE_PLAYER ? facts.userName : (facts.participants?.find((p) => p.id === id)?.name ?? facts.charName)
  // The graph supersedes the flat region list — it says whose body each contact is on, which the
  // list cannot once more than two people are involved.
  const contactLine = facts.contact?.length
    ? `In contact: ${describeContact(facts.contact, nameOf, facts.turnNow ?? 0)}`
    : facts.contactRegions?.length
      ? `In contact: ${facts.contactRegions.map(regionLabel).join(', ')}`
      : ''
  const lines = [
    whereWhen ? `Location: ${whereWhen}` : '',
    present,
    facts.activity
      ? `Physically: ${facts.activity}${facts.sceneTurns && facts.sceneTurns > 0 ? ` (turn ${facts.sceneTurns} of this scene)` : ''}`
      : '',
    clothingLines(facts),
    contactLine,
    arousalLine(facts),
  ].filter(Boolean)
  if (!lines.length) return ''
  return `[SCENE STATE]\n${lines.join('\n')}\nThis is what is true right now. Don't contradict any line above, and don't re-describe something it says has already happened.`
}
