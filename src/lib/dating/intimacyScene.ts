import {
  advanceArousal,
  arousalBandFor,
  BAND_FLOORS,
  BODY_REGIONS,
  emptyArousalState,
  habituatedRegion,
  isConsentTension,
  regionLabel,
} from '@/lib/dating/arousal'
import type { ArousalContext, ArousalState, BodyRegion } from '@/lib/dating/arousal'
import type { KinkValence } from '@/lib/dating/kinks'
import { applyClothingRemovals, parseClothingRemovals } from '@/lib/dating/clothing'
import type { SceneResolveSnapshot } from '@/lib/dating/aftercare'
import type { ClothingRemoval, ClothingState } from '@/lib/dating/clothing'
import {
  advanceContact,
  contactRegionsFor,
  isSceneOwner,
  parseObservedContact,
  participantArousal,
  participantClothing,
  sceneParticipants,
  withParticipantArousal,
  withParticipantClothing,
} from '@/lib/dating/sceneParticipants'
import type { ContactEdge, ObservedContact } from '@/lib/dating/sceneParticipants'
import type { IntimacyCategory } from '@/lib/dating/intimacyCatalog'
import {
  buildPendingChoice,
  choiceDefaultDue,
  DEFAULT_SCENARIO,
  eligibleChoiceEdges,
  nextAutoEdge,
  phaseForStageKind,
  resolveEdge,
  RESOLVE_STAGE,
  stageById,
  stageFloorsMet,
  stageOverstayed,
} from '@/lib/dating/intimacyStages'
import type { IntimacyStage, PendingChoice, ScenarioGraph, StageContext } from '@/lib/dating/intimacyStages'
import type { CharacterMood } from '@/lib/prompt/mindGuidance'

export { BODY_REGIONS }
export type { BodyRegion }
export { RESOLVE_STAGE }

// Persisted state machine for where an active intimate scene stands (building/peak) and what's
// physically happening, so the model is told rather than left to infer it from scrollback. Sits
// before `aftercare.ts`'s Afterglow in a scene's lifecycle — once a scene resolves here, the
// already-open aftercare window carries the emotional aftermath.

export type IntimacyPhase = 'building' | 'peak'

/**
 * What the judge reports about the turn that just happened — bounded observations, never a phase
 * choice. The model is a sensor here; `advanceIntimacyScene` below is the only thing that decides
 * what state the scene moves to, so a judge that wants to leap to the end can't.
 */
export interface IntimacyTurnObservation {
  /** Did the reply engage the current activity at all, or drift/stall? */
  engagement: 'engaged' | 'stalled' | 'drifted'
  /** Direction of physical intensity this turn, not an absolute level. */
  intensityDelta: -1 | 0 | 1 | 2
  /** Did either party explicitly signal hesitation, a pause, or a check-in? */
  hesitationSignalled: boolean
  /** Did the reply narrate the scene reaching its natural completion? A vote, weighed below — not a decision. */
  stageCompleteSignalled: boolean
  /** Body regions the reply actually described contact with. The two-party shorthand: regions of the speaking character's own body. */
  regionsTouched: BodyRegion[]
  /** Clothing the reply actually described coming off, per side — the engine keeps the running total. */
  clothingRemoved: ClothingRemoval[]
  /**
   * Who touched whom, where, when more than two people are in the scene and `regionsTouched` can no
   * longer say whose body it means. Only asked for in a multi-participant scene; empty everywhere
   * else, where the two-party fields above carry the same information more cheaply.
   */
  contact?: ObservedContact[]
  /** Clothing coming off, keyed by character id, for participants `clothingRemoved`'s `char`/`user` sides cannot name. */
  participantClothingRemoved?: { who: string; layer: ClothingRemoval['layer'] }[]
}

/** Validates a raw judge object into an observation. `undefined` when nothing usable came back — the caller then holds the scene. */
export function parseIntimacyObservation(raw: unknown): IntimacyTurnObservation | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const engagement =
    obj.engagement === 'stalled' || obj.engagement === 'drifted' || obj.engagement === 'engaged' ? obj.engagement : undefined
  const rawDelta = Number(obj.intensityDelta)
  const intensityDelta = ([-1, 0, 1, 2] as const).find((d) => d === rawDelta)
  // A reply with no readable engagement read is not an observation at all; the rest have safe defaults.
  if (!engagement) return undefined
  const regionsTouched = Array.isArray(obj.regionsTouched)
    ? [...new Set(obj.regionsTouched.filter((r): r is BodyRegion => BODY_REGIONS.includes(r as BodyRegion)))]
    : []
  return {
    engagement,
    intensityDelta: intensityDelta ?? 0,
    hesitationSignalled: obj.hesitationSignalled === true,
    stageCompleteSignalled: obj.stageCompleteSignalled === true,
    regionsTouched,
    clothingRemoved: parseClothingRemovals(obj.clothingRemoved),
    contact: parseObservedContact(obj.contact),
    participantClothingRemoved: parseParticipantClothingRemovals(obj.participantClothingRemoved),
  }
}

/**
 * The per-character half of the clothing read. Same validation as `parseClothingRemovals`, except
 * `who` is a character id rather than one of the two fixed sides, so it can only be checked for
 * being a non-empty string here and is filtered against the actual roster at advance time.
 */
function parseParticipantClothingRemovals(raw: unknown): IntimacyTurnObservation['participantClothingRemoved'] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const removals: IntimacyTurnObservation['participantClothingRemoved'] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { who, layer } = entry as Record<string, unknown>
    if (typeof who !== 'string' || !who.trim()) continue
    // Reuse the layer vocabulary check rather than restating it — one parser owns what a layer is.
    const [validated] = parseClothingRemovals([{ who: 'char', layer }])
    if (!validated) continue
    const key = `${who}:${validated.layer}`
    if (seen.has(key)) continue
    seen.add(key)
    removals.push({ who, layer: validated.layer })
  }
  return removals
}

/** Stored per relationship (`RelationshipTrack.intimacyScene`). `undefined`/`null` = no active scene. */
export interface IntimacyScene {
  phase: IntimacyPhase
  /** Model-facing description of what's currently happening physically, from the clicked catalog entry's resolved prompt note. */
  activityLabel: string
  /** Catalog category of the current activity. */
  category: IntimacyCategory
  /** `countCharReplies` value when the scene last started or changed; used to detect staleness (rewind/fork). */
  updatedAtTurn: number
  /** Turn `phase` last actually changed, distinct from `updatedAtTurn` (which moves on every eval). */
  phaseSinceTurn?: number
  /** Ordered catalog categories this scene has moved through so far, e.g. `['kissing_spot', 'position', 'toy']`. */
  categoryHistory?: IntimacyCategory[]
  /**
   * The scene's arousal meter (`arousal.ts`) — engine-computed from each turn's observation, and the
   * sole input to the derived `phase`. Absent on scenes persisted before it existed; `arousalOf`
   * seeds those from whatever phase they were already in.
   */
  arousal?: ArousalState
  /** `arousalWeight` of the catalog entry currently driving the scene — how much this activity can deliver per turn. */
  activityWeight?: number
  /** The scene owner's stance on the active entry's kinks (`kinks.ts`), frozen at the click — a per-character multiplier on every gain. */
  activityValence?: KinkValence
  /**
   * The active entry's own kink ids. Stored because `activityValence` is one character's feelings
   * about the content, and in a shared scene every other participant has their own — the caller
   * scores these against each of their profiles rather than applying the owner's stance to everyone.
   */
  activityKinks?: string[]
  /** Turn this scene first started, surviving a mid-scene re-centering — the state block's "turn N of this scene". */
  startedAtTurn?: number
  /** The scenario this scene is running on (`scenarios.ts`). Absent on scenes persisted before scenarios existed — those fall back to the open scene. */
  scenarioId?: string
  /** Node of the scenario graph the scene is standing on (`intimacyStages.ts`). Absent on scenes persisted before stages existed. */
  stageId?: string
  /** Turn the scene entered its current stage — what `minTurns`/`softMaxTurns` are measured from. */
  stageSinceTurn?: number
  /** Stages this scene has been through, in order — the `stage_visited` condition reads this. */
  visitedStages?: string[]
  /** A branch the scene has reached and is waiting on the player for. While set, the stage cannot advance. */
  pendingChoice?: PendingChoice
  /** Layers removed so far this scene, per side (`clothing.ts`) — engine-tracked so the model never has to remember it. */
  clothing?: ClothingState
  /** Regions in contact as of the last turn — the state block's continuity anchor against hands silently relocating. */
  contactRegions?: BodyRegion[]
  /**
   * Every character in this scene, its owner first (`sceneParticipants.ts`). One scene is shared by
   * all of them rather than each keeping their own, so they can never disagree about what is
   * happening. Absent, or one entry, is the single-character scene: the owner's own arousal and
   * clothing stay in the fields above and the maps below are untouched.
   */
  participants?: string[]
  /** Every non-owner participant's own meter. Asymmetry is a feature here — one at the edge while another is warming is a scene beat. */
  participantArousal?: Record<string, ArousalState>
  /** Every non-owner participant's own clothing ledger. */
  participantClothing?: Record<string, ClothingState>
  /** Who is touching whom, where — the N-participant generalisation of `contactRegions`. */
  contact?: ContactEdge[]
  /** Scene-scoped flags a branch can set and a later condition can read, e.g. how a scene finished. */
  sceneFlags?: string[]
}

/**
 * The stage the scene is on, seeding a scene persisted before stages existed from the phase it was
 * already in: the first stage of the graph whose structural kind reads as that phase, and the entry
 * stage failing that. Never returns undefined, so a scene can't be stranded off the graph.
 */
export function stageOf(scene: IntimacyScene, graph: ScenarioGraph = DEFAULT_SCENARIO): IntimacyStage {
  const known = stageById(graph, scene.stageId)
  if (known) return known
  const byPhase = graph.stages.find((stage) => phaseForStageKind(stage.kind) === scene.phase)
  return byPhase ?? stageById(graph, graph.entryStage) ?? graph.stages[0]
}

/** How this character feels about the active content, for the judge's own hesitation read. `undefined` when they're neutral about it. */
export function stanceOfScene(scene: IntimacyScene): 'reluctant' | 'eager' | undefined {
  const valence = scene.activityValence ?? 0
  if (valence <= -1) return 'reluctant'
  return valence >= 2 ? 'eager' : undefined
}

/** Turns the scene has spent on its current stage. */
export function turnsInStage(scene: IntimacyScene, charReplyCount: number): number {
  return charReplyCount - (scene.stageSinceTurn ?? scene.startedAtTurn ?? scene.updatedAtTurn)
}

/**
 * What a scene looked like as it ended, for `aftercare.ts`'s earned-vs-rushed read. Taken from the
 * scene the caller still holds on the turn `advanceIntimacyScene` returns `null`, since the scene
 * state itself is discarded at that point.
 */
export function sceneResolveSnapshot(scene: IntimacyScene, charReplyCount: number): SceneResolveSnapshot {
  return {
    turns: Math.max(0, charReplyCount - (scene.startedAtTurn ?? scene.updatedAtTurn)),
    // The floor, not the owner's own: "did this scene actually get there" has to mean everyone in it.
    arousal: sceneArousalFloorValue(scene),
    stages: new Set(scene.visitedStages ?? [scene.stageId ?? 'building']).size,
  }
}

/**
 * A meter from the scene, seeding a scene persisted before arousal existed from the phase it was
 * already in. With no `charId` — or with the owner's — this is the scene's original single-character
 * meter, unchanged. With another participant's it is their own slot in the map, since two people in
 * one scene are not at the same place in it.
 */
export function arousalOf(scene: IntimacyScene, charId?: string): ArousalState {
  if (charId && !isSceneOwner(scene, charId)) {
    return participantArousal(scene, charId) ?? emptyArousalState(scene.startedAtTurn ?? scene.updatedAtTurn)
  }
  if (scene.arousal) return scene.arousal
  const seeded = scene.phase === 'peak' ? BAND_FLOORS.edge : 0
  return { value: seeded, regionExposure: {}, bandSinceTurn: scene.phaseSinceTurn ?? scene.updatedAtTurn }
}

/** A participant's clothing ledger — the owner's own lives in the scene's original field. */
export function clothingOf(scene: IntimacyScene, charId?: string): ClothingState | undefined {
  if (charId && !isSceneOwner(scene, charId)) return participantClothing(scene, charId)
  return scene.clothing
}

/**
 * The reading the engine gates on: the *least* aroused participant. Escalation is held to whoever in
 * the scene is furthest from ready, so nobody is carried past their own pace by someone else's — the
 * multi-participant form of the same principle that makes consent load-bearing for one. Identical to
 * the single meter when there is only one participant, so nothing about a solo scene changes.
 */
export function sceneArousalFloorValue(scene: IntimacyScene): number {
  const roster = sceneParticipants(scene)
  if (roster.length < 2) return arousalOf(scene).value
  return Math.min(...roster.map((id) => arousalOf(scene, id).value))
}

/** The band a participant is in right now — what the state block and the phase read off. Defaults to the scene owner's. */
export function sceneArousalBand(scene: IntimacyScene, charId?: string) {
  return arousalBandFor(arousalOf(scene, charId).value)
}

/** `peak` from the top two bands, `building` below. The only place a phase is ever decided. */
export function phaseForArousal(value: number): IntimacyPhase {
  return value >= BAND_FLOORS.edge ? 'peak' : 'building'
}

/** True when the scene's turn marker is ahead of the conversation — a rewind/fork artifact. */
export function isIntimacySceneStale(scene: IntimacyScene | undefined | null, charReplyCount: number): boolean {
  return !!scene && scene.updatedAtTurn > charReplyCount
}

/** Whether a scene is currently live and worth telling the model about. */
export function isIntimacySceneActive(scene: IntimacyScene | undefined | null, charReplyCount: number): boolean {
  return !!scene && !isIntimacySceneStale(scene, charReplyCount)
}

/**
 * Starts or re-centers a scene at `building` — a click mid-scene is the consent/renegotiation
 * checkpoint, so a new activity doesn't inherit the old one's intensity. `priorScene` (pass only
 * when live) extends its `categoryHistory` instead of resetting it.
 */
export function startOrShiftIntimacyScene(
  activityLabel: string,
  category: IntimacyCategory,
  charReplyCount: number,
  priorScene?: IntimacyScene | null,
  activityWeight?: number,
  graph: ScenarioGraph = DEFAULT_SCENARIO,
  activityValence?: KinkValence,
  /** The active entry's kink ids, so every participant's own stance on it can be scored (`activityKinks`). */
  activityKinks?: string[],
  /** Everyone in the scene, its owner first (`sceneParticipants.ts`). Omitted or one entry is the single-character scene. */
  participants?: string[],
): IntimacyScene {
  const categoryHistory = priorScene ? [...(priorScene.categoryHistory ?? [priorScene.category]), category] : [category]
  const prior = priorScene ? arousalOf(priorScene) : undefined
  // A mid-scene click keeps whoever is already in the scene unless the caller names a new roster —
  // adding a third person is a deliberate act, never a side effect of choosing a different activity.
  const roster = participants?.length ? participants : priorScene?.participants
  return {
    phase: 'building',
    activityLabel,
    category,
    updatedAtTurn: charReplyCount,
    phaseSinceTurn: charReplyCount,
    categoryHistory,
    activityWeight,
    activityValence,
    activityKinks,
    // A click mid-scene continues the same scene, so its start turn is kept rather than restarted.
    startedAtTurn: priorScene?.startedAtTurn ?? charReplyCount,
    // ...but it re-enters the graph at the top, the same renegotiation checkpoint the phase reset was.
    scenarioId: graph.id,
    stageId: graph.entryStage,
    stageSinceTurn: charReplyCount,
    visitedStages: [...(priorScene?.visitedStages ?? []), graph.entryStage],
    clothing: priorScene?.clothing,
    contactRegions: priorScene?.contactRegions,
    ...(roster ? { participants: roster } : {}),
    // The contact graph and everyone else's clothing carry across a re-centering for the same reason
    // the owner's do: it is one scene, and the same bodies are still in the same room.
    contact: priorScene?.contact,
    participantClothing: priorScene?.participantClothing,
    sceneFlags: priorScene?.sceneFlags,
    // A meter that reset to zero on every click would make a mid-scene choice read as amnesia, so it
    // carries — but capped back under the peak floor, since re-centering is the consent checkpoint
    // and the new activity has to earn its own way up again. Exposure carries whole: same bodies.
    arousal: prior
      ? { ...prior, value: Math.min(prior.value, BAND_FLOORS.edge - 1), bandSinceTurn: charReplyCount }
      : emptyArousalState(charReplyCount),
    // Every other participant's meter is capped back the same way the owner's is — the consent
    // checkpoint applies to all of them, not only to whoever's track happens to hold the scene.
    ...(priorScene?.participantArousal
      ? {
          participantArousal: Object.fromEntries(
            Object.entries(priorScene.participantArousal).map(([id, state]) => [
              id,
              { ...state, value: Math.min(state.value, BAND_FLOORS.edge - 1), bandSinceTurn: charReplyCount },
            ]),
          ),
        }
      : {}),
  }
}

/** Whether a character should escalate faster/slower than the generic curve, derived from mood/plans/boundaries. */
export type IntimacyPace = 'reserved' | 'eager' | 'neutral'

const RESERVED_MOODS: readonly CharacterMood[] = ['anxious', 'guarded', 'embarrassed', 'tense', 'exhausted']
const EAGER_MOODS: readonly CharacterMood[] = ['playful', 'excited', 'confident', 'affectionate']

/** Boundary count needed before that alone reads as "reserved by nature". */
const RESERVED_BOUNDARY_FLOOR = 2

export function intimacyPaceFor(mood: CharacterMood | undefined, isHoldingBackByPlan: boolean, boundaryCount: number): IntimacyPace {
  const reserved = isHoldingBackByPlan || boundaryCount >= RESERVED_BOUNDARY_FLOOR || (!!mood && RESERVED_MOODS.includes(mood))
  if (reserved) return 'reserved'
  if (mood && EAGER_MOODS.includes(mood)) return 'eager'
  return 'neutral'
}

/**
 * Everything the engine knows about this character and scene going into a turn. The top-level
 * arousal fields are the scene owner's; `participants` carries the same per-turn inputs for everyone
 * else, since sensitivity, pace, and how each of them feels about the content are all per-character.
 */
export interface IntimacySceneContext extends ArousalContext {
  /** The scenario the scene is running on. Defaults to the built-in open-scene graph. */
  graph?: ScenarioGraph
  /** Relationship state for the condition kinds shared with `world/triggers.ts`. */
  relationship?: StageContext['relationship']
  ownedItemIds?: StageContext['ownedItemIds']
  kinks?: StageContext['kinks']
  /** Per-participant arousal inputs, keyed by character id. Only read for non-owner participants. */
  participants?: Record<string, ArousalContext>
}

function stageContextFor(scene: IntimacyScene, arousalValue: number, ctx: IntimacySceneContext): StageContext {
  return {
    arousal: arousalValue,
    visitedStages: scene.visitedStages,
    ownedItemIds: ctx.ownedItemIds,
    kinks: ctx.kinks,
    relationship: ctx.relationship,
  }
}

/**
 * Runs the scene's transition from one turn's observation. The engine owns every decision: arousal
 * accumulates from what the reply actually did (`arousal.ts`), the stage moves only along an edge the
 * scenario graph actually has, and `phase` is derived from whichever stage the scene ends up on. A
 * stage's `minTurns`/`minArousal` floors are checked *before* `stageCompleteSignalled` is honoured, so
 * the judge's vote can never override them — it can neither jump a scene to its climax nor conclude
 * one that never got there. `null` = resolved, and `aftercare.ts`'s already-open window takes over.
 * A missing or unreadable observation holds the scene where it is.
 *
 * `choice`-mode edges are never traversed here: they wait to be offered to the player, and until that
 * surface exists the scene simply holds its stage rather than deadlocking.
 */
export function advanceIntimacyScene(
  scene: IntimacyScene,
  obs: IntimacyTurnObservation | undefined,
  charReplyCount: number,
  ctx: IntimacySceneContext = {},
): IntimacyScene | null {
  const phaseSinceTurn = scene.phaseSinceTurn ?? scene.updatedAtTurn
  if (!obs) return { ...scene, updatedAtTurn: charReplyCount, phaseSinceTurn }

  const graph = ctx.graph ?? DEFAULT_SCENARIO
  const stage = stageOf(scene, graph)
  const contact = advanceContact(scene.contact, obs.contact ?? [], charReplyCount, sceneParticipants(scene))
  const arousal = advanceMeters(scene, obs, ctx, stage, contact, charReplyCount)

  const stageCtx = stageContextFor(scene, arousal.floor, ctx)
  const floorsMet = stageFloorsMet(stage, turnsInStage(scene, charReplyCount), arousal.floor)

  // A branch already raised holds everything until it's answered. The meter still moves — the scene
  // is still being played — but the stage does not, which is the whole point of gating a branch here
  // rather than asking the model nicely not to cross it.
  if (scene.pendingChoice) {
    const stillOffered = eligibleChoiceEdges(stage, stageCtx).some((edge) =>
      scene.pendingChoice!.options.some((option) => option.edgeTo === edge.to),
    )
    if (stillOffered && !choiceDefaultDue(scene.pendingChoice, charReplyCount)) {
      return { ...heldScene(scene, arousal, obs, contact, charReplyCount), pendingChoice: scene.pendingChoice }
    }
    // Either the branch stopped being answerable (state moved under it) or nobody answered in time.
    const fallback = stillOffered ? scene.pendingChoice.defaultEdgeTo : undefined
    // A default that ends the scene is the ordinary case at a closing branch, and `resolve` is not a
    // stage in the graph — without this it reads as a target that doesn't exist, the branch is merely
    // cleared, and the same decision is re-raised a few turns later forever.
    if (fallback === RESOLVE_STAGE) return null
    const taken = fallback ? stageById(graph, fallback) : undefined
    return taken
      ? enterStage(heldScene(scene, arousal, obs, contact, charReplyCount), stage, taken, charReplyCount)
      : { ...heldScene(scene, arousal, obs, contact, charReplyCount), pendingChoice: undefined }
  }
  // Ending the scene needs both: floors clear, an edge the scenario actually has, and a reply the
  // judge saw finish. A resolve edge never fires on its own.
  if (floorsMet && obs.stageCompleteSignalled && resolveEdge(stage, stageCtx)) return null

  // A real branch outranks any auto edge out of the same stage: the whole reason to gate one is that
  // the scene must not cross it on its own.
  const raised = floorsMet ? buildPendingChoice(stage, stageCtx, charReplyCount) : undefined
  if (raised) return { ...heldScene(scene, arousal, obs, contact, charReplyCount), pendingChoice: raised }

  const edge = floorsMet ? nextAutoEdge(stage, stageCtx) : undefined
  const nextStage = edge ? (stageById(graph, edge.to) ?? stage) : stage
  return enterStage(heldScene(scene, arousal, obs, contact, charReplyCount), stage, nextStage, charReplyCount)
}

/** Every participant's meter after a turn, plus the single reading the stage gates on. */
interface SceneMeters {
  /** The scene owner's own — the scene's original single-character field. */
  owner: ArousalState
  /** Every other participant's, keyed by character id. Absent for a single-participant scene. */
  participants?: Record<string, ArousalState>
  /** What `stageFloorsMet` and the stage conditions read: the least aroused participant (`sceneArousalFloorValue`). */
  floor: number
}

/** One participant's own view of the turn: their body's regions, not the scene's as a whole. */
function observationFor(obs: IntimacyTurnObservation, regions: BodyRegion[]): IntimacyTurnObservation {
  return { ...obs, regionsTouched: regions }
}

/**
 * Runs every participant's meter over the same turn. Each gets their own inputs — sensitivity, pace,
 * how they feel about the content — and their own body's share of the contact graph, so the same turn
 * is worth genuinely different amounts to each of them and the scene develops asymmetrically.
 */
function advanceMeters(
  scene: IntimacyScene,
  obs: IntimacyTurnObservation,
  ctx: IntimacySceneContext,
  stage: IntimacyStage,
  contact: ContactEdge[],
  charReplyCount: number,
): SceneMeters {
  const roster = sceneParticipants(scene)
  const ownerId = roster[0]
  // The owner's own body: the two-party read, plus anything the contact graph says targets them.
  const ownerRegions = ownerId
    ? [...new Set([...obs.regionsTouched, ...contactRegionsFor(contact, ownerId)])]
    : obs.regionsTouched
  const owner = advanceArousal(
    arousalOf(scene),
    observationFor(obs, ownerRegions),
    {
      ...ctx,
      activityWeight: ctx.activityWeight ?? scene.activityWeight,
      kinkValence: ctx.kinkValence ?? scene.activityValence,
      passiveGain: stage.passiveGain ?? ctx.passiveGain,
    },
    charReplyCount,
  )
  if (roster.length < 2) return { owner, floor: owner.value }

  const participants: Record<string, ArousalState> = {}
  for (const id of roster.slice(1)) {
    const own = ctx.participants?.[id] ?? {}
    participants[id] = advanceArousal(
      arousalOf(scene, id),
      // Only what the graph says is happening to *them* — a participant nobody is touching this turn
      // gains nothing from contact, which is what lets one of them lag behind on purpose.
      observationFor(obs, contactRegionsFor(contact, id)),
      {
        ...own,
        activityWeight: own.activityWeight ?? scene.activityWeight,
        // Deliberately no fallback to `scene.activityValence`: that is the *owner's* stance on the
        // content, and applying it to someone else would make one character's enthusiasm speed up a
        // participant who does not share it. Unsupplied means neutral, not "feels the same".
        passiveGain: stage.passiveGain ?? own.passiveGain,
      },
      charReplyCount,
    )
  }
  return { owner, participants, floor: Math.min(owner.value, ...Object.values(participants).map((s) => s.value)) }
}

/** A turn's removals split by whose ledger they belong in — the owner's own field, or a participant map. */
function nextClothing(
  scene: IntimacyScene,
  obs: IntimacyTurnObservation,
): { own: ClothingState; participants: Record<string, ClothingState> | undefined } {
  const roster = sceneParticipants(scene)
  // The two-party channel is always the owner's and the player's.
  let own = applyClothingRemovals(scene.clothing, obs.clothingRemoved)
  if (roster.length < 2) return { own, participants: scene.participantClothing }
  let participants = scene.participantClothing
  for (const { who, layer } of obs.participantClothingRemoved ?? []) {
    // A character who isn't in the scene has no ledger to write to at all.
    if (!roster.includes(who)) continue
    // The owner has exactly one place their layers live. A judge that named them by id rather than
    // using the `char` side still gets the removal recorded — dropping it would lose real state and
    // then let `continuityGuard.ts` wave through a reply undressing them a second time.
    if (isSceneOwner(scene, who)) {
      own = applyClothingRemovals(own, [{ who: 'char', layer }])
      continue
    }
    participants = withParticipantClothing(
      { participantClothing: participants },
      who,
      applyClothingRemovals(participantClothing({ participantClothing: participants }, who), [{ who: 'char', layer }]),
    )
  }
  return { own, participants }
}

/** Everything a turn updates that has nothing to do with which stage the scene is on. */
function heldScene(
  scene: IntimacyScene,
  arousal: SceneMeters,
  obs: IntimacyTurnObservation,
  contact: ContactEdge[],
  charReplyCount: number,
): IntimacyScene {
  const clothing = nextClothing(scene, obs)
  return {
    ...scene,
    arousal: arousal.owner,
    ...(arousal.participants
      ? { participantArousal: Object.entries(arousal.participants).reduce<Record<string, ArousalState>>(
          (acc, [id, state]) => withParticipantArousal({ participantArousal: acc }, id, state),
          scene.participantArousal ?? {},
        ) }
      : {}),
    clothing: clothing.own,
    participantClothing: clothing.participants,
    // A turn that described no contact leaves the previous anchor standing rather than blanking it.
    contactRegions: obs.regionsTouched.length ? obs.regionsTouched : scene.contactRegions,
    contact,
    updatedAtTurn: charReplyCount,
  }
}

/** Lands a scene on a stage, stamping the move (and deriving the phase) only when it actually moved. */
function enterStage(scene: IntimacyScene, from: IntimacyStage, to: IntimacyStage, charReplyCount: number): IntimacyScene {
  const moved = to.id !== from.id
  const phase = phaseForStageKind(to.kind)
  const phaseSinceTurn = scene.phaseSinceTurn ?? scene.updatedAtTurn
  return {
    ...scene,
    phase,
    stageId: to.id,
    stageSinceTurn: moved ? charReplyCount : (scene.stageSinceTurn ?? scene.startedAtTurn ?? scene.updatedAtTurn),
    visitedStages: moved ? [...(scene.visitedStages ?? [from.id]), to.id] : (scene.visitedStages ?? [from.id]),
    pendingChoice: undefined,
    phaseSinceTurn: phase !== scene.phase ? charReplyCount : phaseSinceTurn,
  }
}

/**
 * The player answering a branch. Returns the scene on the chosen stage with the branch cleared, or
 * `null` when the choice was to end the scene. Unknown or no-longer-offered targets leave the scene
 * exactly where it is rather than jumping it somewhere the graph never offered.
 */
export function resolveIntimacyChoice(
  scene: IntimacyScene,
  edgeTo: string,
  charReplyCount: number,
  graph: ScenarioGraph = DEFAULT_SCENARIO,
): IntimacyScene | null {
  if (!scene.pendingChoice?.options.some((option) => option.edgeTo === edgeTo)) return scene
  if (edgeTo === RESOLVE_STAGE) return null
  const from = stageOf(scene, graph)
  const to = stageById(graph, edgeTo)
  if (!to) return { ...scene, pendingChoice: undefined }
  return enterStage({ ...scene, updatedAtTurn: charReplyCount }, from, to, charReplyCount)
}

/** `pace`-specific addition to the phase's own pacing line — empty for `neutral`. */
function paceClauseFor(pace: IntimacyPace, phase: IntimacyPhase): string {
  if (pace === 'reserved') {
    return phase === 'building'
      ? " Given who they are right now, this is taking longer to build than it might for someone more at ease — small hesitations, needing a moment, or checking in first are the natural, in-character read here, not a flaw in the scene."
      : " Even here at the peak, some of that same carefulness can still show through — reaching this point took more for them than it would for someone less guarded, and that can still color how they experience it."
  }
  if (pace === 'eager') {
    return phase === 'building'
      ? " Given who they are right now, they lean into this more readily than someone more guarded would — quicker to let go of hesitation, without skipping real consent or care."
      : ''
  }
  return ''
}

/** How many turns in one arousal band before the scene reads as going nowhere. */
const PROLONGED_BAND_TURNS = 3

/**
 * The variety nudge, now driven by what the scene actually did rather than a bare turn counter: a
 * region the scene has worn out is named specifically, and a meter that has sat in one band for a
 * few turns running is the general case underneath it.
 */
function repetitionClause(scene: IntimacyScene): string {
  const arousal = arousalOf(scene)
  const worn = habituatedRegion(arousal)
  if (worn) {
    return ` ${regionLabel(worn)} has been the focus for several turns running now and isn't producing much of a response any more — move somewhere else, or change what's being done, rather than repeating the same beat.`
  }
  if (scene.updatedAtTurn - arousal.bandSinceTurn < PROLONGED_BAND_TURNS) return ''
  return ` This has held at the same level for a few turns running now — let something actually shift (pace, depth, a brief pause, a change of angle) rather than repeating the same beat over again.`
}

/**
 * How this character feels about what's currently happening (`kinks.ts`). The arousal meter already
 * carries the mechanical half; this is the half that has to reach the writing, because a reluctance
 * that never shows in the prose is one the judge can't observe either — and `hesitationSignalled` is
 * an observation, never something the engine invents on a character's behalf.
 */
function stanceClause(scene: IntimacyScene): string {
  const valence = scene.activityValence ?? 0
  if (valence <= -1) {
    return ` This is not something they're actually into. That doesn't mean refusing outright, but it does mean it reads on them — going along with it rather than wanting it, a beat of hesitation, or saying so out loud are all more in character here than enthusiasm would be.`
  }
  if (valence >= 2) {
    return ` This is something they're genuinely eager for, and that can show — more forward, less hesitation, more willing to ask for what they want than they might usually be.`
  }
  return ''
}

/** A branch waiting on the player. The state machine already refuses to cross it; this stops the prose
 *  running ahead of a decision that hasn't been made yet. */
function pendingChoiceClause(scene: IntimacyScene): string {
  if (!scene.pendingChoice) return ''
  return ` The scene has reached a point where what happens next isn't yours to decide — stay in this moment, draw it out, and don't move things on to whatever might come after it yet.`
}

/** A stage past its authored soft cap — a nudge toward moving on, never a block on staying. */
function overstayClause(scene: IntimacyScene, graph: ScenarioGraph): string {
  return stageOverstayed(stageOf(scene, graph), turnsInStage(scene, scene.updatedAtTurn))
    ? ` This part of the scene has run longer than it usually would — it's a natural point for things to move on to what comes next, if the moment supports it.`
    : ''
}

/**
 * Physical continuity + phase-scaled pacing for the active scene. What is physically happening is
 * stated once, by `prompt/sceneStateBlock.ts`, which renders on exactly the same condition as this
 * line; the instruction about it lives here. Two copies of the same fact in one prompt is noise, and
 * the copies can drift apart.
 */
export function intimacySceneGuidance(
  charName: string,
  scene: IntimacyScene,
  pace: IntimacyPace = 'neutral',
  graph: ScenarioGraph = DEFAULT_SCENARIO,
): string {
  const continuity = `Stay continuous with what the scene state says ${charName} is physically in the middle of, until something in the scene actually changes it — don't quietly drift to a different position or act, and don't re-describe getting into it as if it just started.`
  const pacing =
    scene.phase === 'building'
      ? "This is still building, not at its peak yet. Let anticipation, teasing, and the slow accumulation of touch and reaction carry the scene rather than jumping straight to full intensity."
      : "This has built to its peak. Let the intensity actually read as that — more urgency, less restraint, reactions less composed than a moment ago."
  return `${continuity} ${pacing}${paceClauseFor(pace, scene.phase)}${stanceClause(scene)}${repetitionClause(scene)}${overstayClause(scene, graph)}${pendingChoiceClause(scene)}`
}

/** Nudges toward hesitation/checking-in when comfort trails well behind chemistry mid-scene. The same
 *  condition mechanically slows arousal and deepens a hesitation's cost (`arousal.ts`), so the nudge
 *  and the meter can never disagree about whether the gap is real. */
export function intimacyConsentTensionGuidance(charName: string, comfort: number, chemistry: number): string | undefined {
  if (!isConsentTension(comfort, chemistry)) return undefined
  return `Right now ${charName}'s comfort is trailing well behind the physical chemistry in this scene — the spark is real, but ease and readiness aren't fully there yet. That's worth letting show: a beat of hesitation, an unprompted check-in, or ${charName} naming the mismatch out loud is the right call here, not something to override just because the moment has its own momentum.`
}

const ANTICIPATION_FLOOR = 55

/** Pre-scene anticipation nudge once chemistry and comfort are both already high and nothing physical has started. */
export function intimacyAnticipationGuidance(charName: string, userName: string, chemistry: number, comfort: number): string | undefined {
  if (chemistry < ANTICIPATION_FLOOR || comfort < ANTICIPATION_FLOOR) return undefined
  return `Nothing physical has started yet, but the chemistry and ease between ${charName} and ${userName} are both genuinely high right now — this reads like a scene heading toward an intimate turn on its own momentum. If it naturally moves that way, let the anticipation build honestly (lingering attention, small charged pauses, a held breath) rather than forcing the escalation early or flattening the charge that's already there.`
}

// Explicit-tier-only prose tells — kept separate from `mindGuidance.ts`'s pre-sex STOCK_ROMANCE_PHRASES.
export const EXPLICIT_ANTI_PATTERNS = [
  'waves of pleasure',
  'lost in the sensation',
  'lost in the feeling',
  'their bodies moved as one',
  'their bodies became one',
  'she felt so full',
  'ecstasy',
  'rapture',
  'bliss',
  'ministrations',
  'he entered her',
  'she took him in',
  'he filled her',
  'buried himself',
  'moaned in pleasure',
] as const

/** Whether a peak-phase reply actually used one of the stock phrases it was told to avoid. */
export function detectExplicitAntiPatternUsed(replyText: string, phase: IntimacyPhase): string | undefined {
  if (phase !== 'peak' || !replyText.trim()) return undefined
  const lower = replyText.toLowerCase()
  return EXPLICIT_ANTI_PATTERNS.find((phrase) => lower.includes(phrase))
}

/** Sequenced physical mechanics, anti-pattern list, voice/POV guard for an active explicit-tier scene. `voiceNote` is the character's own authored explicit-voice hint, if any. */
export function explicitSceneGuidance(
  charName: string,
  userName: string,
  phase: IntimacyPhase,
  pace: IntimacyPace = 'neutral',
  voiceNote?: string,
): string {
  const mechanics =
    phase === 'peak'
      ? [
          `Follow the physical sequence in order rather than skipping stages: resistance, then it gives, the first inches, then real depth — and once actually deep, movement itself changes (shorter strokes, grinding, a beat where nothing moves at all) rather than continuing exactly as it started. Give ${charName}'s hips, thighs, hands, and breath something concrete to be doing at each stage, not just once at the end.`,
          `The edge has its own order too, and none of it gets skipped: rhythm that keeps breaking, involuntary clenching, breath that won't stay even, control over voice or movement starting to slip — all of that has to actually appear before anything is named as climax. Don't jump straight from "still building" to climax language.`,
          `When it actually hits, write what ${charName}'s body does — clamping down, pulsing, a sound that isn't a word, pulling ${userName} deeper or needing them to go completely still — instead of a metaphor for the feeling. Right after, the body doesn't just reset: oversensitive, still twitching, unsteady, a few seconds where talking normally isn't quite possible yet.`,
          `Once at peak, intensity doesn't have to sit at maximum in every single sentence — it can ease off for a few beats (slower, deeper, a full stop) and build again, the way it actually would, rather than reading as one flat wall of "as hard as possible" start to finish.`,
          `The same specificity applies to any other touch in the scene, not only penetration — a hand or mouth on breasts, nipples, or anywhere else should register as pressure, a twist, a pull, with a direct physical answer (arching in, a flinch, an involuntary clench), never a vague "played with her" summary.`,
        ].join(' ')
      : `Let the buildup show in the body, not just the mood — resistance easing, first reactions to touch, breath changing, small adjustments — rather than skipping ahead to full intensity before it's actually been earned this scene.`
  const antiPatterns = `Avoid stock explicit-writing tells here regardless of whether they've come up before in this chat — things like "${EXPLICIT_ANTI_PATTERNS.join('", "')}". Reach for one specific physical sensation instead (stretch, resistance, heat, pressure, friction, a pulse) rather than an emotion word or a metaphor standing in for one.`
  const voiceNoteClause = voiceNote?.trim() ? ` For ${charName} specifically: ${voiceNote.trim()}` : ''
  const voice = `${charName}'s established voice doesn't reset here — if they're normally clipped, sarcastic, or formal, that stays true under strain too; their sounds and word choice should still read as them, not a generic register swap into stock scene-narrator voice. The same goes for anything said out loud in the moment — dirty talk, begging, wordless sounds — keep it in ${charName}'s own register (short and broken, silent, or formal cracking under strain, whichever actually fits them) rather than switching to fluent, generic porn dialogue just because the scene turned explicit.${voiceNoteClause}`
  const reservedClause =
    pace === 'reserved'
      ? ` Given who ${charName} is right now, this still shows through even here: more checking in, smaller and less certain reactions, a real chance they need a moment or a full pause rather than just riding the momentum — dirty talk or a confident running commentary would read false for them unless that's genuinely who they are underneath it.`
      : ''
  // The POV guard is carried once, canonically, by `mindGuidance.ts`'s `agencyGuardNote`, which
  // fires on every romantic/intimate moment (this scene included) — not repeated here.
  return [mechanics, antiPatterns, voice + reservedClause].join(' ')
}

/** Immediate post-climax physical beat, fired alongside (not instead of) the content-agnostic `afterglowGuidance` when explicit content is on. */
export function explicitAftercareGuidance(charName: string): string {
  return `${charName}'s body doesn't reset the instant it's over — oversensitive, still twitching or pulsing faintly, legs or hands not quite steady, a few seconds where talking in full, composed sentences isn't really possible yet. Don't let ${charName} snap back to normal and conversational faster than a body actually would.`
}

/** Recent resolved-scene category-sequences to remember, e.g. `['kissing_spot', 'position', 'toy']` per scene. */
export const SCENE_SHAPE_LOG_CAP = 3

/** Appends a resolved scene's category sequence, capped at `SCENE_SHAPE_LOG_CAP`, keeping the most recent. */
export function appendSceneShapeLog(log: string[][] | undefined, shape: string[]): string[][] {
  const next = [...(log ?? []), shape]
  return next.length > SCENE_SHAPE_LOG_CAP ? next.slice(next.length - SCENE_SHAPE_LOG_CAP) : next
}

/** The last two logged shapes, only if identical and long enough (2+ steps) to count as a real curve. */
function lastTwoShapesRepeated(log: string[][] | undefined): string[] | undefined {
  if (!log || log.length < 2) return undefined
  const [a, b] = log.slice(-2)
  if (a.length < 2 || a.length !== b.length) return undefined
  return a.every((cat, i) => cat === b[i]) ? a : undefined
}

/** Nudges variety for the whole duration of a new scene when the two scenes before it traced the identical category sequence. */
export function repeatedEscalationShapeGuidance(charName: string, shapeLog: string[][] | undefined): string | undefined {
  const repeated = lastTwoShapesRepeated(shapeLog)
  if (!repeated) return undefined
  return `The last two intimate scenes with ${charName} both moved through the exact same sequence (${repeated.join(' → ')}), start to finish. Let this one actually diverge somewhere — a different opening, a skipped or reordered step, something new — rather than tracing the identical curve a third time running.`
}
