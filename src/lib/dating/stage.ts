import type { Chat, RelationshipDimension, RelationshipStage, SceneFlag, WorldCard } from '@/lib/types'

/** Default warmth thresholds at which each relationship stage begins, lowest first. */
export const RELATIONSHIP_MILESTONES: { stage: RelationshipStage; at: number }[] = [
  { stage: 'near_strangers', at: 0 },
  { stage: 'acquaintances', at: 15 },
  { stage: 'warming_up', at: 35 },
  { stage: 'getting_close', at: 55 },
  { stage: 'close', at: 75 },
  { stage: 'sweethearts', at: 90 },
]

/** Canonical set of branching scene-memory flags the AI classifier can detect. */
export const SCENE_FLAGS: SceneFlag[] = ['first_date', 'confession', 'jealousy', 'promise']

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
