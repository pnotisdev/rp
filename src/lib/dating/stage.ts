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

/**
 * 10b: which `DateEventCard` kinds are a *live, end-of-scene-scored* scene — per-turn scoring
 * suppressed, a rapport read shown instead, one judge pass when it ends — versus the original
 * lightweight event-card flow (`gift`/`milestone`), which never goes "live" at all. The one place
 * this decision is made, so a scene's live-ness can never drift between the header, the VN HUD, the
 * event panel, and `useChatSession`'s own generation loop.
 */
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

/** Canonical set of built-in branching scene-memory flags the AI classifier can detect — always available, regardless of world. See `combinedSceneFlags` for the full set including a world's own custom ones. */
export const SCENE_FLAGS: SceneFlag[] = ['first_date', 'confession', 'jealousy', 'promise', 'first_kiss']

/**
 * The built-in flag marking "these two have actually kissed" — the physical-reality signal
 * `canActuallyAskForCommitment` gates the `dating` tier on (see its own doc comment for the full
 * "married with zero kisses" bug this exists to fix). Set two ways, so it fires whichever way a
 * kiss actually happens: deterministically the instant a `kissing_spot`-category intimacy action is
 * sent (`useChatSession.ts`'s `sendUserMessage`), or by the AI classifier noticing one written out
 * in freeform roleplay instead (`relationshipAssist.ts`'s `FLAG_GLOSSARY` entry for this flag).
 * Exported so every site that needs the literal agrees on one spelling rather than retyping it.
 */
export const FIRST_KISS_FLAG: SceneFlag = 'first_kiss'

/** The 4 built-in flags plus whatever a world has authored on top, as {id, label} pairs — the one place both the UI (Relationship panel checklist, item "set flag" picker) and the AI classifier (relationshipAssist.ts) should read the full available set from, so they can never drift apart. */
export function combinedSceneFlags(customFlags?: CustomSceneFlag[]): { id: string; label: string }[] {
  return [
    ...SCENE_FLAGS.map((f) => ({ id: f, label: f.replace(/_/g, ' ') })),
    ...(customFlags ?? []).map((f) => ({ id: f.id, label: f.label })),
  ]
}

/** 10c's Define-the-Relationship ladder, lowest first. Separate from `RELATIONSHIP_MILESTONES` — warmth only ever gates when a tier can be *asked for*, never grants it automatically. `married` is the top rung (the user's own ask: "unlocking moving together, getting married, and other things") — same ask/accept/backfire flow as every other tier below it, just one rung further. */
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

/** The next tier up from `current`, or undefined once already at the top of the ladder — never 'none', since that's only ever the bottom of the ladder, not something to advance "to". */
export function nextCommitmentTier(current: CommitmentStatus): Exclude<CommitmentStatus, 'none'> | undefined {
  const i = COMMITMENT_ORDER.indexOf(current)
  return i >= 0 && i < COMMITMENT_ORDER.length - 1 ? (COMMITMENT_ORDER[i + 1] as Exclude<CommitmentStatus, 'none'>) : undefined
}

/**
 * Reuses the same warmth milestones already authored for `RelationshipStage` rather than a second
 * set of thresholds — dating needs getting_close's warmth, exclusive needs close's, living together
 * and married both need sweethearts' (the ladder's own top stage, so there's nowhere higher to peg
 * a warmth floor for married specifically). That's fine: `nextCommitmentTier` already refuses to
 * offer married until *currently* living_together, so the real gate marriage needs — you have to
 * have already moved in together first — comes from ladder order, not from a warmth number no
 * stage would ever clear.
 */
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
 * A live playthrough reached "married" on warmth alone, the two characters never having so much as
 * kissed — `canAskForCommitment`'s threshold says nothing about physical reality. This is the one
 * place that decides *why* `tier` is locked, composing the existing warmth gate with two new
 * physical-reality checks: `RelationshipPanel`'s locked-hint copy reads this directly (`canAskFor
 * Commitment` alone can't tell "not warm enough yet" apart from "warm enough, but they haven't
 * kissed", and a player can only act on the second kind of hint if it says so).
 * - `dating` additionally needs `physical.hasKissed` — the built-in `first_kiss` scene flag
 *   (`FIRST_KISS_FLAG`) having been set.
 * - `living_together` and `married` additionally need `physical.firstIntimateSceneAt` to be set
 *   (the "first time together" milestone, see `canInitiateFirstTime`) — checked at *both* tiers
 *   independently, as defense in depth, even though ladder order alone already implies it (you
 *   can't ask for `married` without already being `living_together`, which already required it).
 * `exclusive` gets no additional check of its own: by the time it's askable the pair is already
 * `dating`, which already required a kiss, and flags are never removed once set.
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

/** True once `tier` is actually askable right now — warmth *and* the physical-reality gates above. Asking still doesn't mean the character will say yes. */
export function canActuallyAskForCommitment(
  tier: Exclude<CommitmentStatus, 'none'>,
  warmth: number,
  physical: { hasKissed: boolean; firstIntimateSceneAt?: number },
  milestones: { stage: RelationshipStage; at: number }[] = RELATIONSHIP_MILESTONES,
): boolean {
  return commitmentLockReason(tier, warmth, physical, milestones) === undefined
}

/**
 * True once this relationship is ready to be *asked* about a "first time together" milestone (see
 * `RelationshipTrack.firstIntimateSceneAt`) — same "asking doesn't mean yes" spirit as
 * `canAskForCommitment`, just gated on warmth + any real commitment rather than one specific tier,
 * since this isn't itself a rung on the `COMMITMENT_ORDER` ladder.
 */
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

/**
 * Dimensions (including `affection`) that count toward `warmth` — `curiosity` and `tension` don't.
 * Exported (not just used internally by `computeWarmth` below) so `RelationshipPanel.tsx` can name
 * whichever of these is lagging once a commitment ask keeps deflecting despite warmth itself
 * already clearing the threshold — see `lowestWarmthDimension`.
 */
export const WARMTH_DIMENSIONS: RelationshipDimension[] = ['trust', 'chemistry', 'comfort', 'respect']

/**
 * FIXES_TODO.md's "no in-app signal for why a commitment ask keeps deflecting" item — live-repro'd
 * at 10 straight deflects on "exclusive" despite affection maxed and trust/chemistry/respect all
 * high: `comfort` specifically was the dimension quietly lagging the whole time, confirmed by
 * watching it recover right before the very next ask landed. `canActuallyAskForCommitment`/
 * `commitmentLockReason` only ever gate on warmth as a single blended number (plus the kiss/
 * first-time physical-reality checks) — nothing surfaces which *specific* tracked dimension is
 * actually dragging that blend down once it's already past the threshold, which is exactly the
 * situation a repeatedly-deflecting player is in. Ties (more than one dimension sharing the lowest
 * value) resolve to the first in `WARMTH_DIMENSIONS`'s own order, arbitrarily but deterministically
 * — there's no principled way to prefer one over another when they're genuinely equal, and a stable
 * pick beats one that flickers between renders.
 */
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
  | 'beliefsAboutUser'
  | 'expectationsOfUser'
  | 'currentFear'
  | 'currentDesire'
  | 'reciprocityCue'
  | 'participantRelationships'
>

/**
 * Multi-character relationship tracking's one resolution point: which bag of fields a given
 * character's relationship state actually lives in. The primary reads their own copy straight off
 * `Chat`'s top-level fields, unchanged since before this existed; anyone else reads their entry in
 * `Chat.participantRelationships`, defaulting to a fresh (all-zero) track the first time they're
 * ever looked at. Every other relationship function (`getRelationshipStats`, `computeWarmth`,
 * `relationshipStageForWarmth`, `applyRelationshipRisk`, ...) already takes plain values rather
 * than reading `Chat` directly, so the object this returns slots straight into them with no changes
 * needed on that side at all.
 */
export function getRelationshipTrack(chat: TrackHost, characterId: string): RelationshipTrack {
  if (characterId === chat.characterId) {
    return {
      affection: chat.affection,
      relationshipStats: chat.relationshipStats,
      relationshipStage: chat.relationshipStage,
      commitmentStatus: chat.commitmentStatus,
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
      beliefsAboutUser: chat.beliefsAboutUser,
      expectationsOfUser: chat.expectationsOfUser,
      currentFear: chat.currentFear,
      currentDesire: chat.currentDesire,
      reciprocityCue: chat.reciprocityCue,
    }
  }
  return chat.participantRelationships?.[characterId] ?? {}
}

/**
 * The `PUT /api/chats/:id` patch that persists a track update for one character. The server merges
 * a PUT shallowly (see `server/db.ts`'s `update`) — a nested object in the patch *replaces* the
 * stored one rather than merging into it — so the non-primary branch always rewrites the *whole*
 * `participantRelationships` map (every other participant's entry spread in unchanged) rather than
 * sending just the one character's delta, which would otherwise silently erase everyone else's
 * tracked state on the very next write.
 */
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
