import type { CharacterBelief } from '@/lib/types'

// Tracks a character's standing impressions of the player as a person — separate from `mood`/
// `currentNeed`/`characterIntent` (mindGuidance.ts, the character's own inner state) and `plans`
// (plans.ts, what she intends to do). Lifecycle mirrors plans.ts: the per-turn judge call
// forms/revises/drops entries, no extra AI cost.

/** Never more than this many live at once. */
export const MAX_ACTIVE_BELIEFS = 4

/** A belief never reinforced or revised in this many turns ages out. */
export const BELIEF_STALE_TURNS = 80

/** One entry in the judge's `beliefUpdates` output. `index` refers to `beliefLinesForJudge`'s order. */
export type BeliefUpdate =
  | { action: 'add'; text: string }
  | { action: 'revise'; index: number; text: string }
  | { action: 'drop'; index: number }

/** Parses and validates the judge's raw `beliefUpdates` array; malformed entries are dropped. */
export function parseBeliefUpdates(raw: unknown): BeliefUpdate[] {
  if (!Array.isArray(raw)) return []
  const out: BeliefUpdate[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    if (o.action === 'add') {
      const text = typeof o.text === 'string' ? o.text.trim().slice(0, 160) : ''
      if (text) out.push({ action: 'add', text })
    } else if (o.action === 'revise') {
      const index = Number(o.index)
      const text = typeof o.text === 'string' ? o.text.trim().slice(0, 160) : ''
      if (Number.isInteger(index) && index >= 0 && text) out.push({ action: 'revise', index, text })
    } else if (o.action === 'drop') {
      const index = Number(o.index)
      if (Number.isInteger(index) && index >= 0) out.push({ action: 'drop', index })
    }
  }
  return out
}

const defaultIdGen = () => `belief-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/** Applies a turn's `beliefUpdates`: resolves revise/drop against the original order, ages out stale beliefs, then trims to `MAX_ACTIVE_BELIEFS` keeping the most recent. */
export function applyBeliefUpdates(
  beliefs: CharacterBelief[] | undefined,
  updates: BeliefUpdate[],
  currentTurn: number,
  idGen: () => string = defaultIdGen,
): CharacterBelief[] {
  const current = beliefs ?? []
  const dropped = new Set<number>()
  const revisions = new Map<number, string>()
  const adds: Extract<BeliefUpdate, { action: 'add' }>[] = []
  for (const u of updates) {
    if (u.action === 'drop') dropped.add(u.index)
    else if (u.action === 'revise') revisions.set(u.index, u.text)
    else adds.push(u)
  }
  let next = current
    .map((b, i) => (dropped.has(i) ? null : revisions.has(i) ? { ...b, text: revisions.get(i)!, formedTurn: currentTurn } : b))
    .filter((b): b is CharacterBelief => b !== null)
    .filter((b) => !(currentTurn > b.formedTurn && currentTurn - b.formedTurn >= BELIEF_STALE_TURNS))
  for (const a of adds) {
    // Skip a near-duplicate of one already held so the list doesn't fill with rephrasings.
    if (next.some((b) => b.text.toLowerCase() === a.text.toLowerCase())) continue
    next.push({ id: idGen(), text: a.text, formedTurn: currentTurn })
  }
  if (next.length > MAX_ACTIVE_BELIEFS) next = next.slice(next.length - MAX_ACTIVE_BELIEFS)
  return next
}

/** True when a turn's updates actually changed the stored list — lets the caller skip a PUT on a no-op turn. */
export function beliefsChanged(before: CharacterBelief[] | undefined, after: CharacterBelief[]): boolean {
  const a = before ?? []
  if (a.length !== after.length) return true
  const byId = new Map(a.map((b) => [b.id, b]))
  return after.some((b) => byId.get(b.id)?.text !== b.text)
}

/** One line per active belief for the judge — not numbered; the judge prompt adds indices. */
export function beliefLinesForJudge(beliefs: CharacterBelief[] | undefined): string[] {
  return (beliefs ?? []).map((b) => b.text)
}

/** `styleGuidance` line carrying a character's standing impressions of the player. Real names, no `{{macros}}`. Returns `''` when none are held. */
export function beliefsGuidance(charName: string, userName: string, beliefs: CharacterBelief[] | undefined): string {
  const active = beliefs ?? []
  if (active.length === 0) return ''
  const lines = active.map((b) => `- ${b.text}`).join('\n')
  return `${charName} has formed some real impressions of ${userName} by now, not just a running warmth score:\n${lines}\nLet these quietly colour how ${charName} reads ${userName}'s actions and words — confirming one, or noticing it being contradicted, is more interesting than restating it outright.`
}
