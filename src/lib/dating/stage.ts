import type {
  Chat,
  CommitmentStatus,
  CustomSceneFlag,
  RelationshipDimension,
  RelationshipStage,
  RelationshipWarning,
  SceneFlag,
  WorldCard,
} from '@/lib/types'
import type { GalleryEntry } from '@/lib/characters/cardSpec'

/** Default warmth thresholds at which each relationship stage begins, lowest first. */
export const RELATIONSHIP_MILESTONES: { stage: RelationshipStage; at: number }[] = [
  { stage: 'near_strangers', at: 0 },
  { stage: 'acquaintances', at: 15 },
  { stage: 'warming_up', at: 35 },
  { stage: 'getting_close', at: 55 },
  { stage: 'close', at: 75 },
  { stage: 'sweethearts', at: 90 },
]

/** Canonical set of built-in branching scene-memory flags the AI classifier can detect — always available, regardless of world. See `combinedSceneFlags` for the full set including a world's own custom ones. */
export const SCENE_FLAGS: SceneFlag[] = ['first_date', 'confession', 'jealousy', 'promise']

/** The 4 built-in flags plus whatever a world has authored on top, as {id, label} pairs — the one place both the UI (Relationship panel checklist, item "set flag" picker) and the AI classifier (relationshipAssist.ts) should read the full available set from, so they can never drift apart. */
export function combinedSceneFlags(customFlags?: CustomSceneFlag[]): { id: string; label: string }[] {
  return [
    ...SCENE_FLAGS.map((f) => ({ id: f, label: f.replace(/_/g, ' ') })),
    ...(customFlags ?? []).map((f) => ({ id: f.id, label: f.label })),
  ]
}

/** 10c's Define-the-Relationship ladder, lowest first. Separate from `RELATIONSHIP_MILESTONES` — warmth only ever gates when a tier can be *asked for*, never grants it automatically. */
export const COMMITMENT_ORDER: CommitmentStatus[] = ['none', 'dating', 'exclusive', 'living_together']

const COMMITMENT_LABELS: Record<CommitmentStatus, string> = {
  none: 'not official',
  dating: 'dating',
  exclusive: 'exclusive',
  living_together: 'living together',
}

export function formatCommitmentStatus(status: CommitmentStatus): string {
  return COMMITMENT_LABELS[status]
}

/** The next tier up from `current`, or undefined once already at the top of the ladder — never 'none', since that's only ever the bottom of the ladder, not something to advance "to". */
export function nextCommitmentTier(current: CommitmentStatus): Exclude<CommitmentStatus, 'none'> | undefined {
  const i = COMMITMENT_ORDER.indexOf(current)
  return i >= 0 && i < COMMITMENT_ORDER.length - 1 ? (COMMITMENT_ORDER[i + 1] as Exclude<CommitmentStatus, 'none'>) : undefined
}

/** Reuses the same warmth milestones already authored for `RelationshipStage` rather than a second set of thresholds — dating needs getting_close's warmth, exclusive needs close's, living together needs sweethearts'. */
const COMMITMENT_TIER_STAGE: Record<Exclude<CommitmentStatus, 'none'>, RelationshipStage> = {
  dating: 'getting_close',
  exclusive: 'close',
  living_together: 'sweethearts',
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

/** The six dimensions tracked in `Chat.relationshipStats`, alongside the top-level `affection`. */
export const RELATIONSHIP_DIMENSIONS: RelationshipDimension[] = [
  'trust',
  'chemistry',
  'comfort',
  'respect',
  'curiosity',
  'tension',
]

/** Dimensions (including `affection`) that count toward `warmth` — `curiosity` and `tension` don't. */
const WARMTH_DIMENSIONS: RelationshipDimension[] = ['trust', 'chemistry', 'comfort', 'respect']

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

/**
 * Warmth is a derived overall-closeness score — affection plus four of the six tracked
 * dimensions (trust, chemistry, comfort, respect), excluding curiosity (interest/spark, not
 * necessarily closeness) and tension (friction — shouldn't read as "warm"). It's never stored;
 * always computed fresh from the dimensions that make it up.
 */
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

/** True the moment warmth crosses INTO a higher stage than it was, false on a same-stage or backward move. */
export function crossedMilestone(previousStage: RelationshipStage, nextStage: RelationshipStage): boolean {
  const stageOrder = RELATIONSHIP_MILESTONES.map((m) => m.stage)
  return stageOrder.indexOf(nextStage) > stageOrder.indexOf(previousStage)
}

/**
 * Ids of `isEnding` gallery entries (10c's "Endings gallery") that should unlock now — reaching
 * the top "sweethearts" stage, not `unlockAffection`/story-beat matching like an ordinary CG, so
 * this never runs through `detectGalleryUnlocks`'s AI reply-matching pass. Already-unlocked ids
 * are skipped, which is also what makes this naturally "once per relationship" — nothing re-fires
 * on later turns once an ending has landed in the set.
 */
export function unlockedEndingIds(
  gallery: GalleryEntry[] | undefined,
  relationshipStage: RelationshipStage,
  alreadyUnlocked: Set<string>,
): string[] {
  if (relationshipStage !== 'sweethearts') return []
  return (gallery ?? []).filter((g) => g.isEnding && !alreadyUnlocked.has(g.id)).map((g) => g.id)
}

// ---------- 10c: Breakups & reconciliation ----------

const RISK_TENSION_THRESHOLD = 80
const RISK_COMFORT_FLOOR = 15
/** Real elapsed time, not in-fiction days — always available whether or not this chat's character has a world/calendar at all. */
const BREAKUP_GRACE_MS = 3 * 24 * 60 * 60 * 1000
/** A one-time cost applied when a relationship actually breaks — the "lasting scar" this item asks for, short of a literal permanent ceiling (which would need every clamp in the codebase to read a per-chat cap). */
const BREAKUP_SCAR = 15

/** True once a *committed* relationship is under real strain — an unofficial relationship has no status to lose, so it's never "at risk" in this sense. */
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
  /** Next warning state — undefined means no warning (either never at risk, resolved, or just broke up). */
  warning?: RelationshipWarning
  commitmentStatus: CommitmentStatus
  breakupCount: number
  brokeUpJustNow: boolean
  warnedJustNow: boolean
  clearedJustNow: boolean
}

/**
 * Pure decision step for whether a committed relationship's current strain should raise a new
 * warning, let a standing one run out into an actual breakup, or clear one that's since resolved —
 * called after every relationship-stat update, not on any separate timer/tick. Applying the actual
 * stat scar and persisting the result is the caller's job (`useChatSession.ts`), same split as
 * `crossedMilestone`/`announceMilestone`.
 */
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
