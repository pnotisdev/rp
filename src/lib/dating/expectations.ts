import type { UserExpectation } from '@/lib/types'

/**
 * The other missing half of "how does she read {{user}}": `beliefs.ts` tracks standing impressions
 * of who {{user}} *is*; this tracks standing expectations of what {{user}} will *do* — "she's
 * started expecting him to check in on Sundays." The lifecycle mirrors `plans.ts` exactly, with one
 * real difference at the end of it: resolving an expectation names an `outcome` (met or violated),
 * since a broken expectation is a genuinely different, more memorable event than a quietly-met one.
 * This module stays pure (no side effects) — the caller (`useChatSession.ts`) is the one that turns
 * a `'violated'` resolution into a durable `ChatFact`, the same "pure lifecycle, caller decides
 * side effects" split `plans.ts` already uses.
 */

/** Fewer than beliefs/plans on purpose — a handful of live expectations reads as attentive; a dozen would read as keeping score. */
export const MAX_ACTIVE_EXPECTATIONS = 3

/** An expectation never touched in this many turns ages out unresolved — it simply stops being a live expectation rather than lingering forever half-formed. */
export const EXPECTATION_STALE_TURNS = 80

/** One entry in the judge's `expectationUpdates` output. `index` refers to the numbered list `expectationLinesForJudge` produced. */
export type ExpectationUpdate =
  | { action: 'add'; text: string }
  | { action: 'note'; index: number; note: string }
  | { action: 'resolve'; index: number; outcome: 'met' | 'violated' }

/** Parses (and hard-validates) the judge's raw `expectationUpdates` array — anything malformed is dropped rather than trusted. */
export function parseExpectationUpdates(raw: unknown): ExpectationUpdate[] {
  if (!Array.isArray(raw)) return []
  const out: ExpectationUpdate[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    if (o.action === 'add') {
      const text = typeof o.text === 'string' ? o.text.trim().slice(0, 160) : ''
      if (text) out.push({ action: 'add', text })
    } else if (o.action === 'note') {
      const index = Number(o.index)
      const note = typeof o.note === 'string' ? o.note.trim().slice(0, 200) : ''
      if (Number.isInteger(index) && index >= 0 && note) out.push({ action: 'note', index, note })
    } else if (o.action === 'resolve') {
      const index = Number(o.index)
      const outcome = o.outcome === 'met' || o.outcome === 'violated' ? o.outcome : undefined
      if (Number.isInteger(index) && index >= 0 && outcome) out.push({ action: 'resolve', index, outcome })
    }
  }
  return out
}

const defaultIdGen = () => `expect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Applies a turn's `expectationUpdates` to the current list, same index-resolution order as
 * `plans.ts`'s `applyPlanUpdates` (resolves/notes against the original order before any `add`
 * shifts things, stale entries age out, result trimmed to `MAX_ACTIVE_EXPECTATIONS`). A `resolve`
 * always removes the entry regardless of outcome — the caller inspects the raw `updates` array
 * (not this function's return value) to find any `'violated'` resolution worth turning into a fact,
 * since by the time this returns, the resolved entry's text is already gone from the list.
 */
export function applyExpectationUpdates(
  expectations: UserExpectation[] | undefined,
  updates: ExpectationUpdate[],
  currentTurn: number,
  idGen: () => string = defaultIdGen,
): UserExpectation[] {
  const current = expectations ?? []
  const resolved = new Set<number>()
  const notes = new Map<number, string>()
  const adds: Extract<ExpectationUpdate, { action: 'add' }>[] = []
  for (const u of updates) {
    if (u.action === 'resolve') resolved.add(u.index)
    else if (u.action === 'note') notes.set(u.index, u.note)
    else adds.push(u)
  }
  let next = current
    .map((e, i) => (resolved.has(i) ? null : notes.has(i) ? { ...e, note: notes.get(i) } : e))
    .filter((e): e is UserExpectation => e !== null)
    .filter((e) => !(currentTurn > e.formedTurn && currentTurn - e.formedTurn >= EXPECTATION_STALE_TURNS))
  for (const a of adds) {
    if (next.some((e) => e.text.toLowerCase() === a.text.toLowerCase())) continue
    next.push({ id: idGen(), text: a.text, formedTurn: currentTurn })
  }
  if (next.length > MAX_ACTIVE_EXPECTATIONS) next = next.slice(next.length - MAX_ACTIVE_EXPECTATIONS)
  return next
}

/** True when applying a turn's updates actually changed the stored list. */
export function expectationsChanged(before: UserExpectation[] | undefined, after: UserExpectation[]): boolean {
  const a = before ?? []
  if (a.length !== after.length) return true
  const byId = new Map(a.map((e) => [e.id, e]))
  return after.some((e) => {
    const q = byId.get(e.id)
    return !q || q.text !== e.text || q.note !== e.note
  })
}

/** Looks up the pre-update text for every `'violated'` resolution in a turn's updates — what the caller (`useChatSession.ts`) turns into a durable `ChatFact`, since `applyExpectationUpdates` has already dropped it from the live list by the time it returns. */
export function violatedExpectationTexts(expectations: UserExpectation[] | undefined, updates: ExpectationUpdate[]): string[] {
  const current = expectations ?? []
  return updates
    .filter((u): u is Extract<ExpectationUpdate, { action: 'resolve' }> => u.action === 'resolve' && u.outcome === 'violated')
    .map((u) => current[u.index]?.text)
    .filter((t): t is string => !!t)
}

/** One line per active expectation for the judge — note baked in, NOT numbered (matching `planLinesForJudge`). */
export function expectationLinesForJudge(expectations: UserExpectation[] | undefined): string[] {
  return (expectations ?? []).map((e) => (e.note ? `${e.text} — ${e.note}` : e.text))
}

/**
 * The `styleGuidance` line carrying a character's standing expectations of {{user}} into
 * generation. Real names, no `{{macros}}`. Returns `''` with none live, the common case.
 */
export function expectationsGuidance(charName: string, userName: string, expectations: UserExpectation[] | undefined): string {
  const active = expectations ?? []
  if (active.length === 0) return ''
  const lines = active.map((e) => `- ${e.text}${e.note ? ` (${e.note})` : ''}`).join('\n')
  return `${charName} has started expecting certain things from ${userName}, whether or not ${userName} knows it:\n${lines}\n${userName} meeting one can be a small, unspoken satisfaction; missing one can sting more than it would look like from the outside, even if ${charName} doesn't say why.`
}
