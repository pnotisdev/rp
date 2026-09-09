import { BODY_REGIONS, regionLabel, type ArousalState, type BodyRegion } from '@/lib/dating/arousal'
import type { ClothingState } from '@/lib/dating/clothing'
import type { IntimacyScene } from '@/lib/dating/intimacyScene'

// The scene as a shared entity rather than one relationship's private state. Two characters in one
// scene used to mean two `IntimacyScene`s advancing independently, which guarantees they eventually
// disagree about what is happening; there is now exactly one scene, one stage, one contact graph, and
// one meter per participant.
//
// Relationship *stats* stay per-relationship — they are a fact about a pair, not about a scene, and
// the group-chat code already tracks them separately. Only the scene state is shared.
//
// Storage deliberately has no migration step: the scene still lives on the relationship track of its
// *owner* (`participants[0]`, whoever's click started it), the owner's own arousal/clothing stay in
// the scene's original single-character fields, and every additional participant gets an entry in the
// maps here. So one participant means byte-identical state to before this existed, and nothing
// persisted needs rewriting. `isSceneOwner` is the only place that split is expressed.
//
// The import of `IntimacyScene` is type-only by design: the value dependency runs the other way, the
// same arrangement `arousal.ts` uses, so the two never form a runtime cycle.

/** The player's side of a contact edge. Character ids are opaque strings, so this reserved token keeps the two apart. */
export const SCENE_PLAYER = 'player'

/** A character in the scene, by id, or `SCENE_PLAYER`. */
export type SceneActor = string

/**
 * One live contact: who is touching whom, where. This is what generalises cleanly from two
 * participants to N — and what makes a group scene tractable at all, since the model is *told* the
 * contact graph rather than asked to remember it across turns.
 */
export interface ContactEdge {
  actor: SceneActor
  target: SceneActor
  region: BodyRegion
  /** Turn this contact was first established, so the state block can say how long it has been held. */
  sinceTurn: number
}

/** One contact the judge observed this turn — the same shape without the bookkeeping the engine owns. */
export interface ObservedContact {
  actor: SceneActor
  target: SceneActor
  region: BodyRegion
}

/** Contacts held at once before the oldest are dropped. A graph longer than this is noise in the prompt, not continuity. */
const MAX_CONTACT_EDGES = 12

/** Validates the judge's raw contact read. Anything unrecognised is dropped rather than guessed at. */
export function parseObservedContact(raw: unknown): ObservedContact[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const contacts: ObservedContact[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { actor, target, region } = entry as Record<string, unknown>
    if (typeof actor !== 'string' || typeof target !== 'string' || !actor.trim() || !target.trim()) continue
    // Self-contact is not a relationship between two participants, and it is the shape a confused
    // judge produces most often.
    if (actor === target) continue
    if (!BODY_REGIONS.includes(region as BodyRegion)) continue
    const key = `${actor}>${target}:${region}`
    if (seen.has(key)) continue
    seen.add(key)
    contacts.push({ actor, target, region: region as BodyRegion })
  }
  return contacts
}

function contactKey(edge: ObservedContact): string {
  return `${edge.actor}>${edge.target}:${edge.region}`
}

/**
 * Folds a turn's observed contact into the graph. A contact that was already there keeps its original
 * `sinceTurn` — that is the whole point, since "her hands have been at your hips for three turns" is
 * exactly the fact a model loses. A turn that described no contact at all leaves the graph standing
 * rather than blanking it, matching how the single-character anchor has always behaved.
 */
export function advanceContact(
  prev: ContactEdge[] | undefined,
  observed: readonly ObservedContact[],
  charReplyCount: number,
  participants?: readonly string[],
): ContactEdge[] {
  const existing = prev ?? []
  const allowed = participants?.length ? new Set<string>([...participants, SCENE_PLAYER]) : undefined
  const usable = allowed ? observed.filter((c) => allowed.has(c.actor) && allowed.has(c.target)) : observed
  if (!usable.length) return existing
  const held = new Map(existing.map((edge) => [contactKey(edge), edge]))
  const next = usable.map((contact) => ({ ...contact, sinceTurn: held.get(contactKey(contact))?.sinceTurn ?? charReplyCount }))
  return next.length > MAX_CONTACT_EDGES ? next.slice(next.length - MAX_CONTACT_EDGES) : next
}

/**
 * Regions of *this* participant's own body that the graph says are being touched. Arousal is scored
 * against the body being touched, so this is the per-participant equivalent of the two-party
 * `regionsTouched` — a participant nobody is touching gains nothing from contact this turn.
 */
export function contactRegionsFor(contact: readonly ContactEdge[] | undefined, who: SceneActor): BodyRegion[] {
  return [...new Set((contact ?? []).filter((edge) => edge.target === who).map((edge) => edge.region))]
}

/** Everyone in this scene, its owner first. Empty on a scene persisted before scenes carried a roster. */
export function sceneParticipants(scene: Pick<IntimacyScene, 'participants'>): string[] {
  return scene.participants ?? []
}

/**
 * Whether this character's own per-turn state lives in the scene's original single-character fields
 * rather than a participant map. True for the scene's owner, and for every character in a scene from
 * before rosters existed — such a scene has exactly one participant by definition.
 */
export function isSceneOwner(scene: Pick<IntimacyScene, 'participants'>, charId: string): boolean {
  const roster = sceneParticipants(scene)
  return roster.length === 0 || roster[0] === charId
}

/**
 * Whether this character is actually in the scene. A scene with a roster names its participants
 * outright; one without has exactly one, its owner. Worth keeping distinct from "the chat has a live
 * scene": a character standing in the same room as a scene they are not part of must not be handed
 * its physical state or told to write continuously with it.
 */
export function isSceneParticipant(scene: Pick<IntimacyScene, 'participants'>, charId: string, ownerId: string): boolean {
  const roster = sceneParticipants(scene)
  return roster.length ? roster.includes(charId) : ownerId === charId
}

/** Whether more than one character is actually in this scene — the only case any of the maps here are populated. */
export function isMultiParticipantScene(scene: Pick<IntimacyScene, 'participants'>): boolean {
  return sceneParticipants(scene).length > 1
}

/** A non-owner participant's meter, or `undefined` when nothing is on record for them yet. */
export function participantArousal(
  scene: Pick<IntimacyScene, 'participantArousal'>,
  charId: string,
): ArousalState | undefined {
  return scene.participantArousal?.[charId]
}

/** The map with one participant's meter replaced. */
export function withParticipantArousal(
  scene: Pick<IntimacyScene, 'participantArousal'>,
  charId: string,
  state: ArousalState,
): Record<string, ArousalState> {
  return { ...scene.participantArousal, [charId]: state }
}

/** A non-owner participant's clothing ledger, or `undefined` when nothing has come off yet. */
export function participantClothing(
  scene: Pick<IntimacyScene, 'participantClothing'>,
  charId: string,
): ClothingState | undefined {
  return scene.participantClothing?.[charId]
}

/** The map with one participant's ledger replaced. */
export function withParticipantClothing(
  scene: Pick<IntimacyScene, 'participantClothing'>,
  charId: string,
  state: ClothingState,
): Record<string, ClothingState> {
  return { ...scene.participantClothing, [charId]: state }
}

/** Adds a character to the scene's roster, keeping the owner first and never duplicating. */
export function withParticipant(scene: Pick<IntimacyScene, 'participants'>, charId: string, ownerId: string): string[] {
  const roster = sceneParticipants(scene)
  const base = roster.length ? roster : [ownerId]
  return base.includes(charId) ? base : [...base, charId]
}

/** How this actor reads as the subject of a sentence. */
function subjectOf(who: SceneActor, nameOf: (id: string) => string): string {
  return who === SCENE_PLAYER ? 'You' : nameOf(who)
}

/** How this actor reads as the owner of a body part. */
function possessiveOf(who: SceneActor, nameOf: (id: string) => string): string {
  return who === SCENE_PLAYER ? 'your' : `${nameOf(who)}'s`
}

/**
 * The contact graph as the state block's own line — the continuity anchor against hands silently
 * relocating between turns. How long a contact has been held is included, because a contact three
 * turns old is exactly the one a reply is most likely to re-establish as if it were new.
 */
export function describeContact(
  contact: readonly ContactEdge[] | undefined,
  nameOf: (id: string) => string,
  charReplyCount: number,
): string {
  if (!contact?.length) return ''
  return contact
    .map((edge) => {
      const held = charReplyCount - edge.sinceTurn
      const duration = held >= 2 ? ` (${held} turns)` : ''
      return `${subjectOf(edge.actor, nameOf)} touching ${possessiveOf(edge.target, nameOf)} ${regionLabel(edge.region)}${duration}`
    })
    .join(', ')
}
