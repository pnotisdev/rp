import type { CharacterBelief } from '@/lib/types'

/**
 * The missing "what does she think of *him*" layer — `mood`/`currentNeed`/`characterIntent`
 * (mindGuidance.ts) all describe the character's own inner state, and `plans` (plans.ts) describes
 * what she intends to do, but nothing tracked a standing *impression of the player as a person*
 * until this. Deliberately small and capped: a character forms a few real impressions over a long
 * story, not a running commentary on every exchange. Lifecycle mirrors `plans.ts` closely (the
 * judge call that already runs every turn forms/revises/drops these, no extra AI cost) with one
 * difference: `revise` in place of `note`, since an impression is corrected or sharpened as new
 * evidence comes in, it doesn't accumulate a log the way a plan's progress does.
 */

/** Never more than this many live at once — the same "a handful of real impressions, not a backlog" reasoning as `plans.ts`'s `MAX_ACTIVE_PLANS`. */
export const MAX_ACTIVE_BELIEFS = 4

/** A belief never reinforced or revised in this many turns ages out — generous, but finite, so a one-off impression doesn't shape every future turn forever. */
export const BELIEF_STALE_TURNS = 80

/** One entry in the judge's `beliefUpdates` output. `index` refers to the numbered list `beliefLinesForJudge` produced. */
export type BeliefUpdate =
  | { action: 'add'; text: string }
  | { action: 'revise'; index: number; text: string }
  | { action: 'drop'; index: number }

/** Parses (and hard-validates) the judge's raw `beliefUpdates` array — anything malformed is dropped rather than trusted. */
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

/**
 * Applies a turn's `beliefUpdates` to the current list — same shape as `plans.ts`'s
 * `applyPlanUpdates`: `revise`/`drop` indices resolve against the list's original order (the one
 * `beliefLinesForJudge` numbered) before any `add` shifts things, stale beliefs age out, then the
 * result is trimmed to `MAX_ACTIVE_BELIEFS` keeping the most recent.
 */
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

/** True when applying a turn's updates actually changed the stored list — lets the caller skip a PUT on the common no-op turn. */
export function beliefsChanged(before: CharacterBelief[] | undefined, after: CharacterBelief[]): boolean {
  const a = before ?? []
  if (a.length !== after.length) return true
  const byId = new Map(a.map((b) => [b.id, b]))
  return after.some((b) => byId.get(b.id)?.text !== b.text)
}

/** One line per active belief for the judge — NOT numbered (the judge prompt adds indices, matching `planLinesForJudge`/`unresolvedFacts`). */
export function beliefLinesForJudge(beliefs: CharacterBelief[] | undefined): string[] {
  return (beliefs ?? []).map((b) => b.text)
}

/**
 * The `styleGuidance` line carrying a character's standing impressions of {{user}} into
 * generation. Real names, no `{{macros}}` — `styleGuidance` strings are never macro-substituted
 * (see `mindGuidance.ts`). Returns `''` with no beliefs held, the common case for a new relationship.
 */
export function beliefsGuidance(charName: string, userName: string, beliefs: CharacterBelief[] | undefined): string {
  const active = beliefs ?? []
  if (active.length === 0) return ''
  const lines = active.map((b) => `- ${b.text}`).join('\n')
  return `${charName} has formed some real impressions of ${userName} by now, not just a running warmth score:\n${lines}\nLet these quietly colour how ${charName} reads ${userName}'s actions and words — confirming one, or noticing it being contradicted, is more interesting than restating it outright.`
}
