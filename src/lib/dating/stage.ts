import type {
  Chat,
  CommitmentStatus,
  CustomSceneFlag,
  DateEventCard,
  RelationshipDimension,
  RelationshipStage,
  RelationshipTrack,
  RelationshipWarning,
  SceneFlag,
  WorldCard,
} from '@/lib/types'
import type { GalleryEntry } from '@/lib/characters/cardSpec'

// Relationship stage/warmth/commitment ladder logic, risk/breakup evaluation, and the
// multi-character relationship-track resolution (`getRelationshipTrack`/`patchRelationshipTrack`).

/** Which `DateEventCard` kinds are a live, end-of-scene-scored scene (date/hangout) vs. the lightweight gift/milestone flow. */
export function isLiveScene(event: Pick<DateEventCard, 'kind' | 'startedAt'> | undefined): boolean {
  return !!event?.startedAt && (event.kind === 'date' || event.kind === 'hangout')
}

/** Default warmth thresholds at which each relationship stage begins, lowest first. */
export const RELATIONSHIP_MILESTONES: { stage: RelationshipStage; at: number }[] = [
  { stage: 'near_strangers', at: 0 },
  { stage: 'acquaintances', at: 15 },
  { stage: 'warming_up', at: 35 },
  { stage: 'getting_close', at: 55 },
  { stage: 'close', at: 75 },
  { stage: 'sweethearts', at: 90 },
]

/** Built-in branching scene-memory flags the AI classifier can detect. See `combinedSceneFlags` for the full set including a world's own custom ones. */
export const SCENE_FLAGS: SceneFlag[] = ['first_date', 'confession', 'jealousy', 'promise', 'first_kiss']

/** Marks "these two have actually kissed" — set either deterministically by a `kissing_spot` action or by the AI classifier noticing one in freeform prose. */
export const FIRST_KISS_FLAG: SceneFlag = 'first_kiss'

/** The built-in flags plus a world's own, as {id, label} pairs. */
export function combinedSceneFlags(customFlags?: CustomSceneFlag[]): { id: string; label: string }[] {
  return [
    ...SCENE_FLAGS.map((f) => ({ id: f, label: f.replace(/_/g, ' ') })),
    ...(customFlags ?? []).map((f) => ({ id: f.id, label: f.label })),
  ]
}

/** Define-the-Relationship ladder, lowest first. Warmth only gates when a tier can be asked for, never grants it automatically. */
export const COMMITMENT_ORDER: CommitmentStatus[] = ['none', 'dating', 'exclusive', 'living_together', 'married']

const COMMITMENT_LABELS: Record<CommitmentStatus, string> = {
  none: 'not official',
  dating: 'dating',
  exclusive: 'exclusive',
  living_together: 'living together',
  married: 'married',
}

export function formatCommitmentStatus(status: CommitmentStatus): string {
  return COMMITMENT_LABELS[status]
}

/** The next tier up from `current`, or undefined at the top of the ladder. */
export function nextCommitmentTier(current: CommitmentStatus): Exclude<CommitmentStatus, 'none'> | undefined {
  const i = COMMITMENT_ORDER.indexOf(current)
  return i >= 0 && i < COMMITMENT_ORDER.length - 1 ? (COMMITMENT_ORDER[i + 1] as Exclude<CommitmentStatus, 'none'>) : undefined
}

// Reuses the existing warmth milestones rather than a second threshold set; living_together and
// married both peg to the top stage since ladder order (not warmth) is what actually gates married.
const COMMITMENT_TIER_STAGE: Record<Exclude<CommitmentStatus, 'none'>, RelationshipStage> = {
  dating: 'getting_close',
  exclusive: 'close',
  living_together: 'sweethearts',
  married: 'sweethearts',
}

export function commitmentTierThreshold(
  tier: Exclude<CommitmentStatus, 'none'>,
  milestones: { stage: RelationshipStage; at: number }[] = RELATIONSHIP_MILESTONES,
): number {
  return milestones.find((m) => m.stage === COMMITMENT_TIER_STAGE[tier])?.at ?? 0
}

/** True once warmth clears the bar to ask for `tier` at all — asking doesn't mean the character will say yes. */
export function canAskForCommitment(
  tier: Exclude<CommitmentStatus, 'none'>,
  warmth: number,
  milestones: { stage: RelationshipStage; at: number }[] = RELATIONSHIP_MILESTONES,
): boolean {
  return warmth >= commitmentTierThreshold(tier, milestones)
}

/** Why `tier` isn't askable right now — `undefined` means it actually is. See `canActuallyAskForCommitment`, which this backs. */
export type CommitmentLockReason = 'warmth' | 'kiss' | 'first_time'

/**
 * Composes the warmth gate with physical-reality checks (so e.g. "married" can't be reached on
 * warmth alone with the pair never having kissed): `dating` needs `hasKissed`; `living_together`/
 * `married` need `firstIntimateSceneAt`. `exclusive` needs no extra check of its own since `dating`
 * already required a kiss.
 */
export function commitmentLockReason(
  tier: Exclude<CommitmentStatus, 'none'>,
  warmth: number,
  physical: { hasKissed: boolean; firstIntimateSceneAt?: number },
  milestones: { stage: RelationshipStage; at: number }[] = RELATIONSHIP_MILESTONES,
): CommitmentLockReason | undefined {
  if (!canAskForCommitment(tier, warmth, milestones)) return 'warmth'
  if (tier === 'dating' && !physical.hasKissed) return 'kiss'
  if ((tier === 'living_together' || tier === 'married') && !physical.firstIntimateSceneAt) return 'first_time'
  return undefined
}

/** True once `tier` is actually askable right now — warmth and the physical-reality gates above. */
export function canActuallyAskForCommitment(
  tier: Exclude<CommitmentStatus, 'none'>,
  warmth: number,
  physical: { hasKissed: boolean; firstIntimateSceneAt?: number },
  milestones: { stage: RelationshipStage; at: number }[] = RELATIONSHIP_MILESTONES,
): boolean {
  return commitmentLockReason(tier, warmth, physical, milestones) === undefined
}

/** True once ready to be *asked* about a "first time together" milestone — gated on warmth + any real commitment, not a rung on `COMMITMENT_ORDER`. */
export function canInitiateFirstTime(warmth: number, commitmentStatus: CommitmentStatus): boolean {
  return warmth >= 75 && commitmentStatus !== 'none'
}

/** The six dimensions tracked in `Chat.relationshipStats`, alongside the top-level `affection`. */
export const RELATIONSHIP_DIMENSIONS: RelationshipDimension[] = [
  'trust',
  'chemistry',
  'comfort',
  'respect',
  'curiosity',
  'tension',
]

/** Dimensions (plus `affection`) that count toward `warmth` — `curiosity`/`tension` don't. */
export const WARMTH_DIMENSIONS: RelationshipDimension[] = ['trust', 'chemistry', 'comfort', 'respect']

/** Whichever warmth dimension is lowest, for naming what's dragging a commitment ask down even though blended warmth already clears the threshold. Ties resolve to the first in `WARMTH_DIMENSIONS` order. */
export function lowestWarmthDimension(stats: Record<RelationshipDimension, number>): RelationshipDimension {
  return WARMTH_DIMENSIONS.reduce((lowest, dim) => (stats[dim] < stats[lowest] ? dim : lowest))
}

/** Applies a world's `relationshipThresholds` overrides on top of the default milestones. */
export function relationshipMilestonesFor(
  overrides?: WorldCard['relationshipThresholds'],
): { stage: RelationshipStage; at: number }[] {
  if (!overrides) return RELATIONSHIP_MILESTONES
  return RELATIONSHIP_MILESTONES.map((m) =>
    m.stage === 'near_strangers' ? m : { ...m, at: overrides[m.stage] ?? m.at },
  )
}

/** "warming_up" -> "warming up", for display. */
export function formatRelationshipStage(stage: RelationshipStage): string {
  return stage.replace(/_/g, ' ')
}

export function relationshipStageForWarmth(
  warmth: number,
  milestones: { stage: RelationshipStage; at: number }[] = RELATIONSHIP_MILESTONES,
): RelationshipStage {
  let stage: RelationshipStage = 'near_strangers'
  for (const m of milestones) {
    if (warmth >= m.at) stage = m.stage
  }
  return stage
}

/** Every relationship stat with no missing keys — unset dimensions read as 0. */
export function getRelationshipStats(chat: Pick<Chat, 'relationshipStats'>): Record<RelationshipDimension, number> {
  const stats = chat.relationshipStats ?? {}
  const result = {} as Record<RelationshipDimension, number>
  for (const dim of RELATIONSHIP_DIMENSIONS) result[dim] = clampStat(stats[dim] ?? 0)
  return result
}

type TrackHost = Pick<
  Chat,
  | 'characterId'
  | 'affection'
  | 'relationshipStats'
  | 'relationshipStage'
  | 'commitmentStatus'
  | 'commitmentStartedDay'
  | 'relationshipWarning'
  | 'breakupCount'
  | 'unlockedGalleryIds'
  | 'giftsGiven'
  | 'mood'
  | 'currentNeed'
  | 'characterIntent'
  | 'momentum'
  | 'plans'
  | 'firstIntimateSceneAt'
  | 'afterglow'
  | 'initiativeBalance'
  | 'recentRebuff'
  | 'intimacyScene'
  | 'giftLog'
  | 'intimacySceneShapeLog'
  | 'discoveredRegions'
  | 'beliefsAboutUser'
  | 'expectationsOfUser'
  | 'currentFear'
  | 'currentDesire'
  | 'reciprocityCue'
  | 'participantRelationships'
>

/** Which bag of fields a character's relationship state lives in: the primary reads `Chat`'s own top-level fields; anyone else reads their entry in `Chat.participantRelationships`. */
export function getRelationshipTrack(chat: TrackHost, characterId: string): RelationshipTrack {
  if (characterId === chat.characterId) {
    return {
      affection: chat.affection,
      relationshipStats: chat.relationshipStats,
      relationshipStage: chat.relationshipStage,
      commitmentStatus: chat.commitmentStatus,
      commitmentStartedDay: chat.commitmentStartedDay,
      relationshipWarning: chat.relationshipWarning,
      breakupCount: chat.breakupCount,
      unlockedGalleryIds: chat.unlockedGalleryIds,
      giftsGiven: chat.giftsGiven,
      mood: chat.mood,
      currentNeed: chat.currentNeed,
      characterIntent: chat.characterIntent,
      momentum: chat.momentum,
      plans: chat.plans,
      firstIntimateSceneAt: chat.firstIntimateSceneAt,
      afterglow: chat.afterglow,
      initiativeBalance: chat.initiativeBalance,
      recentRebuff: chat.recentRebuff,
      intimacyScene: chat.intimacyScene,
      giftLog: chat.giftLog,
      intimacySceneShapeLog: chat.intimacySceneShapeLog,
      discoveredRegions: chat.discoveredRegions,
      beliefsAboutUser: chat.beliefsAboutUser,
      expectationsOfUser: chat.expectationsOfUser,
      currentFear: chat.currentFear,
      currentDesire: chat.currentDesire,
      reciprocityCue: chat.reciprocityCue,
    }
  }
  return chat.participantRelationships?.[characterId] ?? {}
}

/** The PUT patch that persists a track update for one character. Rewrites the whole `participantRelationships` map for a non-primary (a shallow PUT merge would otherwise erase everyone else's entry). */
export function patchRelationshipTrack(
  chat: Pick<Chat, 'characterId' | 'participantRelationships'>,
  characterId: string,
  patch: RelationshipTrack,
): Partial<Chat> {
  if (characterId === chat.characterId) return patch as Partial<Chat>
  return {
    participantRelationships: {
      ...chat.participantRelationships,
      [characterId]: { ...chat.participantRelationships?.[characterId], ...patch },
    },
  }
}

/** Derived overall-closeness score: affection plus trust/chemistry/comfort/respect, excluding curiosity and tension. Never stored. */
export function computeWarmth(affection: number, stats: Record<RelationshipDimension, number>): number {
  const values = [affection, ...WARMTH_DIMENSIONS.map((d) => stats[d])]
  const sum = values.reduce((total, v) => total + v, 0)
  return clampStat(sum / values.length)
}

export function clampAffection(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** Same 0-100 clamp as `clampAffection`, named generically for the other six dimensions. */
export const clampStat = clampAffection

/** True the moment warmth crosses into a higher stage than it was. */
export function crossedMilestone(previousStage: RelationshipStage, nextStage: RelationshipStage): boolean {
  const stageOrder = RELATIONSHIP_MILESTONES.map((m) => m.stage)
  return stageOrder.indexOf(nextStage) > stageOrder.indexOf(previousStage)
}

/** Ids of `isEnding` gallery entries that should unlock now — reaching the top "sweethearts" stage, not AI reply-matching like an ordinary CG. */
export function unlockedEndingIds(
  gallery: GalleryEntry[] | undefined,
  relationshipStage: RelationshipStage,
  alreadyUnlocked: Set<string>,
): string[] {
  if (relationshipStage !== 'sweethearts') return []
  return (gallery ?? []).filter((g) => g.isEnding && !alreadyUnlocked.has(g.id)).map((g) => g.id)
}

// ---------- Breakups & reconciliation ----------

const RISK_TENSION_THRESHOLD = 80
const RISK_COMFORT_FLOOR = 15
/** Real elapsed time, not in-fiction days. */
const BREAKUP_GRACE_MS = 3 * 24 * 60 * 60 * 1000
/** One-time cost applied when a relationship actually breaks. */
const BREAKUP_SCAR = 15

/** True once a committed relationship is under real strain — an unofficial one has no status to lose. */
export function relationshipAtRisk(
  commitmentStatus: CommitmentStatus,
  stats: Record<RelationshipDimension, number>,
): boolean {
  if (commitmentStatus === 'none') return false
  return stats.tension >= RISK_TENSION_THRESHOLD || stats.comfort <= RISK_COMFORT_FLOOR
}

/** True once a standing warning's grace period has fully elapsed with nothing resolved. */
export function warningExpired(warning: RelationshipWarning, now: number = Date.now()): boolean {
  return now - warning.startedAt >= BREAKUP_GRACE_MS
}

/** A trust/comfort/chemistry hit applied once, at the moment a relationship actually breaks. */
export function applyBreakupScar(stats: Record<RelationshipDimension, number>): Record<RelationshipDimension, number> {
  return {
    ...stats,
    trust: clampStat(stats.trust - BREAKUP_SCAR),
    comfort: clampStat(stats.comfort - BREAKUP_SCAR),
    chemistry: clampStat(stats.chemistry - BREAKUP_SCAR),
  }
}

export interface RelationshipRiskResult {
  /** Next warning state — undefined means no warning (never at risk, resolved, or just broke up). */
  warning?: RelationshipWarning
  commitmentStatus: CommitmentStatus
  breakupCount: number
  brokeUpJustNow: boolean
  warnedJustNow: boolean
  clearedJustNow: boolean
}

/** Pure decision step for whether a committed relationship's current strain should raise a warning, let one run out into a breakup, or clear a resolved one. Called after every stat update, not on a timer. Applying the scar and persisting is the caller's job. */
export function evaluateRelationshipRisk(opts: {
  commitmentStatus: CommitmentStatus
  stats: Record<RelationshipDimension, number>
  existingWarning?: RelationshipWarning
  breakupCount: number
  now?: number
}): RelationshipRiskResult {
  const now = opts.now ?? Date.now()
  if (!relationshipAtRisk(opts.commitmentStatus, opts.stats)) {
    return {
      warning: undefined,
      commitmentStatus: opts.commitmentStatus,
      breakupCount: opts.breakupCount,
      brokeUpJustNow: false,
      warnedJustNow: false,
      clearedJustNow: !!opts.existingWarning,
    }
  }
  if (!opts.existingWarning) {
    return {
      warning: { startedAt: now, reason: opts.stats.tension >= RISK_TENSION_THRESHOLD ? 'tension has been boiling over' : 'things have felt distant and neglected' },
      commitmentStatus: opts.commitmentStatus,
      breakupCount: opts.breakupCount,
      brokeUpJustNow: false,
      warnedJustNow: true,
      clearedJustNow: false,
    }
  }
  if (warningExpired(opts.existingWarning, now)) {
    return {
      warning: undefined,
      commitmentStatus: 'none',
      breakupCount: opts.breakupCount + 1,
      brokeUpJustNow: true,
      warnedJustNow: false,
      clearedJustNow: false,
    }
  }
  return {
    warning: opts.existingWarning,
    commitmentStatus: opts.commitmentStatus,
    breakupCount: opts.breakupCount,
    brokeUpJustNow: false,
    warnedJustNow: false,
    clearedJustNow: false,
  }
}
