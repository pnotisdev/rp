// Validation of an item's effect union on the way into the database.

const RELATIONSHIP_DELTA_KEYS = new Set(['affection', 'trust', 'chemistry', 'comfort', 'respect', 'curiosity', 'tension'])
/** Kept in step with `MOOD_VOCAB` (src/lib/prompt/mindGuidance.ts) by itemEffects.test.ts. */
export const ITEM_MOODS = new Set([
  'content', 'affectionate', 'playful', 'excited', 'anxious', 'guarded', 'annoyed', 'hurt', 'sad', 'lonely',
  'jealous', 'embarrassed', 'confident', 'exhausted', 'bored', 'curious', 'nostalgic', 'proud', 'relieved', 'tense',
])
const MAX_MULTI_PARTS = 6

export type NormalizedItemEffect =
  | { kind: 'relationship'; dimension: string; amount: number }
  | { kind: 'flag'; flag: string }
  | { kind: 'currency'; amount: number }
  | { kind: 'mood'; mood: string }
  | { kind: 'multi'; effects: NormalizedItemEffect[] }

/** Anything unrecognised falls through to a +1 affection nudge, as before. */
export function normalizeItemEffect(raw: unknown, allowedFlags: Set<string>, nested = false): NormalizedItemEffect {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (obj.kind === 'multi' && !nested && Array.isArray(obj.effects)) {
    const parts = obj.effects
      .slice(0, MAX_MULTI_PARTS)
      .filter((e) => e && typeof e === 'object' && (e as { kind?: unknown }).kind !== 'multi')
      .map((e) => normalizeItemEffect(e, allowedFlags, true))
    if (parts.length > 1) return { kind: 'multi', effects: parts }
    if (parts.length === 1) return parts[0]
  }
  if (obj.kind === 'flag' && allowedFlags.has(obj.flag as string)) {
    return { kind: 'flag', flag: obj.flag as string }
  }
  if (obj.kind === 'currency') {
    return { kind: 'currency', amount: Math.max(0, Number(obj.amount) || 0) }
  }
  if (obj.kind === 'mood' && ITEM_MOODS.has(obj.mood as string)) {
    return { kind: 'mood', mood: obj.mood as string }
  }
  const dimension = RELATIONSHIP_DELTA_KEYS.has(obj.dimension as string) ? (obj.dimension as string) : 'affection'
  const amount = Number(obj.amount)
  // Round rather than reject a fractional amount, so it isn't silently replaced with a fixed 1.
  return {
    kind: 'relationship',
    dimension,
    amount: Number.isFinite(amount) ? Math.max(-10, Math.min(10, Math.round(amount))) : 1,
  }
}
