import { kinkResponsiveness, type KinkValence } from '@/lib/dating/kinks'
import type { IntimacyPace, IntimacyTurnObservation } from '@/lib/dating/intimacyScene'

// Scene-scoped physical arousal: the continuous meter `intimacyScene.ts` derives its phase from,
// and the reason climax timing is deterministic rather than a model whim. Deliberately never
// LLM-scored — every input is something the engine already knows (the catalog entry the player
// clicked, the regions the judge observed contact with, the turn's own engagement read) run through
// pure arithmetic here. Discarded with the scene; the durable emotional half stays in the seven
// relationship stats, which modulate `responsivenessFor` below but are never written back to.
//
// Imports from `intimacyScene.ts` are type-only by design: the value dependency runs the other way
// (that module imports this one), so the two never form a runtime cycle.

/** Body regions a reply can describe contact with. Closed vocabulary so the judge's read is validatable. */
export const BODY_REGIONS = [
  'hair', 'face', 'lips', 'neck', 'ears', 'shoulders', 'back',
  'chest', 'waist', 'hips', 'thighs', 'inner_thigh', 'hands', 'feet',
  'genitals', 'other',
] as const

export type BodyRegion = (typeof BODY_REGIONS)[number]

export type ArousalBand = 'baseline' | 'warming' | 'engaged' | 'edge' | 'over'

/** Lower bound of each band. `over` is the ceiling — the meter never exceeds it. */
export const BAND_FLOORS: Record<ArousalBand, number> = {
  baseline: 0,
  warming: 20,
  engaged: 45,
  edge: 78,
  over: 100,
}

const BANDS_HIGH_TO_LOW: ArousalBand[] = ['over', 'edge', 'engaged', 'warming', 'baseline']

/**
 * How each band reads in plain language. Shared by the prompt's scene-state block and the panel UI
 * on purpose: a band the model is told is "close to the edge" should not be labelled anything else
 * on screen, and two copies of five strings drift.
 */
export const AROUSAL_BAND_PHRASE: Record<ArousalBand, string> = {
  baseline: 'not yet worked up',
  warming: 'warming up',
  engaged: 'well into it',
  edge: 'close to the edge',
  over: 'right at the edge',
}

/**
 * Stored on the active scene. `responsiveness` is deliberately absent — it's derived per turn from
 * mood/pace/stats by `responsivenessFor`, so a character who has calmed down since doesn't keep an
 * old multiplier baked into their scene state.
 */
export interface ArousalState {
  /** 0-100. Scene-scoped; discarded when the scene resolves. */
  value: number
  /** Regions touched this scene, with counts — drives habituation. */
  regionExposure: Partial<Record<BodyRegion, number>>
  /** Turn arousal last crossed into the band it's now in; the dwell floor reads off this. */
  bandSinceTurn: number
}

export function arousalBandFor(value: number): ArousalBand {
  return BANDS_HIGH_TO_LOW.find((band) => value >= BAND_FLOORS[band]) ?? 'baseline'
}

export function emptyArousalState(charReplyCount: number): ArousalState {
  return { value: 0, regionExposure: {}, bandSinceTurn: charReplyCount }
}

/** How much a region gives back per touch before habituation. Authored per character in a `TouchProfile` later; this is the fallback everyone starts from. */
export const DEFAULT_REGION_SENSITIVITY: Record<BodyRegion, number> = {
  genitals: 3,
  inner_thigh: 2.5,
  lips: 2,
  neck: 2,
  ears: 2,
  chest: 2,
  hips: 1.5,
  thighs: 1.5,
  waist: 1,
  back: 1,
  shoulders: 1,
  hands: 1,
  hair: 0.5,
  face: 0.5,
  feet: 0.5,
  other: 0.5,
}

export type RegionSensitivity = Partial<Record<BodyRegion, number>>

function sensitivityOf(region: BodyRegion, sensitivity?: RegionSensitivity): number {
  return sensitivity?.[region] ?? DEFAULT_REGION_SENSITIVITY[region]
}

/**
 * Diminishing return on the nth touch of the same region — 1, 0.71, 0.56, 0.45... The thing that
 * makes a scene stuck on one spot mechanically stall instead of climbing forever, and the data
 * `habituatedRegion` reads to say so specifically.
 */
export function habituationFactor(touchCount: number): number {
  return 1 / (1 + 0.4 * Math.max(0, touchCount - 1))
}

/** Arousal per sensitivity point of a first, un-habituated touch. */
const REGION_GAIN_STEP = 2

/** Passive per-turn drift, so a scene that's engaged but static still creeps rather than stalling forever. */
const PASSIVE_GAIN = 2

/** Passive per-turn loss, applied unconditionally — the reason a scene left alone cools off. */
const DECAY_PER_TURN = 1.5

/**
 * How much of the current activity's own weight a turn delivers, by the direction the judge observed.
 * A pullback is negative rather than merely zero: a reply that eased off should cool the scene, not
 * coast upward on the passive drift alone.
 */
const DELTA_MULTIPLIER: Record<string, number> = { '-1': -0.5, '0': 0.5, '1': 1, '2': 1.75 }

const STALL_PENALTY = -6
const DRIFT_PENALTY = -10
const HESITATION_PENALTY = -4
/** Hesitation costs far more when comfort is trailing chemistry — `intimacyConsentTensionGuidance`'s condition, enforced rather than suggested. */
const HESITATION_TENSION_PENALTY = -12

/** Multipliers on every gain, by how forward this character is playing right now. Replaces the old `RESERVED_MIN_BUILDING_TURNS` clamp. */
const PACE_RESPONSIVENESS: Record<IntimacyPace, number> = { reserved: 0.7, neutral: 1, eager: 1.3 }

/** The gap and floor `intimacyConsentTensionGuidance` nudges on — shared so the nudge and the penalty can never disagree. */
export const CONSENT_TENSION_GAP = 20
export const CONSENT_TENSION_COMFORT_FLOOR = 45

/** Comfort trailing well behind chemistry: the spark is real but ease isn't there yet. */
export function isConsentTension(comfort: number | undefined, chemistry: number | undefined): boolean {
  if (comfort === undefined || chemistry === undefined) return false
  return comfort < CONSENT_TENSION_COMFORT_FLOOR && chemistry - comfort >= CONSENT_TENSION_GAP
}

/** What the engine knows about the character this turn. Every field optional so a caller with only a pace still gets a sane meter. */
export interface ArousalContext {
  pace?: IntimacyPace
  /** Relationship stats — they modulate responsiveness, and arousal never writes back to them. */
  comfort?: number
  chemistry?: number
  /** Per-character overrides of `DEFAULT_REGION_SENSITIVITY`. */
  sensitivity?: RegionSensitivity
  /** The active catalog entry's `arousalWeight` — how much this specific activity can deliver per turn. */
  activityWeight?: number
  /** Per-turn passive drift, when the active stage authors its own (`intimacyStages.ts`). Unset uses `PASSIVE_GAIN`. */
  passiveGain?: number
  /** How this character feels about the active content (`kinks.ts`). 0 (neutral) changes nothing. */
  kinkValence?: KinkValence
}

/**
 * Per-character multiplier on all gains. Two characters at the same point in the same scene move at
 * genuinely different speeds: how forward they're playing, how much chemistry is actually there, and
 * a real damper when they're not comfortable enough for the pace the scene is running at.
 */
export function responsivenessFor(ctx: ArousalContext): number {
  const chemistryFactor = ctx.chemistry === undefined ? 1 : 0.8 + ctx.chemistry / 250
  const tensionFactor = isConsentTension(ctx.comfort, ctx.chemistry) ? 0.75 : 1
  const kinkFactor = kinkResponsiveness(ctx.kinkValence ?? 0)
  return PACE_RESPONSIVENESS[ctx.pace ?? 'neutral'] * chemistryFactor * tensionFactor * kinkFactor
}

function regionGain(regions: BodyRegion[], exposure: ArousalState['regionExposure'], sensitivity?: RegionSensitivity): number {
  return regions.reduce((sum, region) => {
    // The touch being scored is the (n+1)th, so habituation reads off the count going in.
    const factor = habituationFactor((exposure[region] ?? 0) + 1)
    return sum + sensitivityOf(region, sensitivity) * factor * REGION_GAIN_STEP
  }, 0)
}

function withExposure(exposure: ArousalState['regionExposure'], regions: BodyRegion[]): ArousalState['regionExposure'] {
  if (!regions.length) return exposure
  const next = { ...exposure }
  for (const region of regions) next[region] = (next[region] ?? 0) + 1
  return next
}

/** Runs one turn of the meter. Pure: the same state, observation, and context always give the same result. */
export function advanceArousal(
  state: ArousalState,
  obs: IntimacyTurnObservation,
  ctx: ArousalContext,
  charReplyCount: number,
): ArousalState {
  // A turn that stalled or drifted delivers nothing at all — the activity only pays out while it's
  // actually being engaged with, which is what stops a scene coasting upward on prose that went nowhere.
  const engaged = obs.engagement === 'engaged'
  const activityGain = (ctx.activityWeight ?? 0) * (DELTA_MULTIPLIER[String(obs.intensityDelta)] ?? 0)
  const touchGain = regionGain(obs.regionsTouched, state.regionExposure, ctx.sensitivity)
  // The drift only accrues while the scene is still going somewhere — a turn that eased off gets none of it.
  const drift = obs.intensityDelta < 0 ? 0 : (ctx.passiveGain ?? PASSIVE_GAIN)
  const gains = engaged ? (activityGain + touchGain + drift) * responsivenessFor(ctx) : 0

  const engagementPenalty = obs.engagement === 'stalled' ? STALL_PENALTY : obs.engagement === 'drifted' ? DRIFT_PENALTY : 0
  const hesitationPenalty = obs.hesitationSignalled
    ? isConsentTension(ctx.comfort, ctx.chemistry)
      ? HESITATION_TENSION_PENALTY
      : HESITATION_PENALTY
    : 0
  const losses = -DECAY_PER_TURN + engagementPenalty + hesitationPenalty

  const value = Math.max(0, Math.min(BAND_FLOORS.over, Math.round(state.value + gains + losses)))
  const bandChanged = arousalBandFor(value) !== arousalBandFor(state.value)
  return {
    value,
    // Exposure counts every observed touch, engaged or not — the model described contact either way.
    regionExposure: withExposure(state.regionExposure, obs.regionsTouched),
    bandSinceTurn: bandChanged ? charReplyCount : state.bandSinceTurn,
  }
}

/** Touches of one region before it stops being worth writing about — habituation is past halved by here. */
const HABITUATION_NUDGE_COUNT = 4

/** The most-touched region, once it's been the focus long enough to have genuinely stopped landing. */
export function habituatedRegion(state: ArousalState | undefined): BodyRegion | undefined {
  if (!state) return undefined
  return BODY_REGIONS.filter((region) => (state.regionExposure[region] ?? 0) >= HABITUATION_NUDGE_COUNT).sort(
    (a, b) => (state.regionExposure[b] ?? 0) - (state.regionExposure[a] ?? 0),
  )[0]
}

/** Human-readable region name for prompt text — the enum's own underscored form reads badly in prose. */
export function regionLabel(region: BodyRegion): string {
  return region.replace(/_/g, ' ')
}
