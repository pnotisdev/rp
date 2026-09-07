import type { CharacterPlan } from '@/lib/types'

// Persistent agency layer: a character carries a few concrete intentions between turns (the richer,
// multi-entry sibling of `mindGuidance.ts`'s transient `characterIntent`). Lifecycle driven entirely
// by the per-turn judge call's `planUpdates` — no extra AI call. Read into the prompt via `plansGuidance`.

/** Never more than this many live at once. Adding past the cap drops the oldest. */
export const MAX_ACTIVE_PLANS = 3

/** Backstop against the judge never closing a plan out — one older than this (in turns) is dropped regardless. */
export const PLAN_STALE_TURNS = 60

export type PlanKind = CharacterPlan['kind']
const PLAN_KINDS: PlanKind[] = ['personal', 'together', 'distance']

/** One entry in the judge's `planUpdates` output — form a new plan, annotate an existing one, or close one out. `index` refers to the numbered list `planLinesForJudge` produced. */
export type PlanUpdate =
  | { action: 'add'; goal: string; kind: PlanKind; note?: string }
  | { action: 'note'; index: number; note: string }
  | { action: 'resolve'; index: number }

/** Parses (and hard-validates) the judge's raw `planUpdates` array — anything malformed is dropped rather than trusted. */
export function parsePlanUpdates(raw: unknown): PlanUpdate[] {
  if (!Array.isArray(raw)) return []
  const out: PlanUpdate[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    if (o.action === 'add') {
      const goal = typeof o.goal === 'string' ? o.goal.trim().slice(0, 160) : ''
      if (!goal) continue
      const kind = PLAN_KINDS.includes(o.kind as PlanKind) ? (o.kind as PlanKind) : 'personal'
      const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, 200) : undefined
      out.push({ action: 'add', goal, kind, note })
    } else if (o.action === 'note') {
      const index = Number(o.index)
      const note = typeof o.note === 'string' ? o.note.trim().slice(0, 200) : ''
      if (Number.isInteger(index) && index >= 0 && note) out.push({ action: 'note', index, note })
    } else if (o.action === 'resolve') {
      const index = Number(o.index)
      if (Number.isInteger(index) && index >= 0) out.push({ action: 'resolve', index })
    }
  }
  return out
}

const defaultIdGen = () => `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/** Applies a turn's `planUpdates` to the current list — `note`/`resolve` indices refer to the original judge-numbered order, resolved before any `add` shifts things. Ages out stale plans, then trims to `MAX_ACTIVE_PLANS`. */
export function applyPlanUpdates(
  plans: CharacterPlan[] | undefined,
  updates: PlanUpdate[],
  currentTurn: number,
  idGen: () => string = defaultIdGen,
): CharacterPlan[] {
  const current = plans ?? []
  const resolved = new Set<number>()
  const notes = new Map<number, string>()
  const adds: Extract<PlanUpdate, { action: 'add' }>[] = []
  for (const u of updates) {
    if (u.action === 'resolve') resolved.add(u.index)
    else if (u.action === 'note') notes.set(u.index, u.note)
    else adds.push(u)
  }
  let next = current
    .map((p, i) => (resolved.has(i) ? null : notes.has(i) ? { ...p, note: notes.get(i) } : p))
    .filter((p): p is CharacterPlan => p !== null)
    // Backstop age-out (see PLAN_STALE_TURNS) — only when currentTurn is a real count ahead of formedTurn.
    .filter((p) => !(currentTurn > p.formedTurn && currentTurn - p.formedTurn >= PLAN_STALE_TURNS))
  for (const a of adds) {
    // Skip a near-duplicate of one already live so the list doesn't fill with rephrasings.
    if (next.some((p) => p.goal.toLowerCase() === a.goal.toLowerCase())) continue
    next.push({ id: idGen(), goal: a.goal, kind: a.kind, formedTurn: currentTurn, note: a.note })
  }
  if (next.length > MAX_ACTIVE_PLANS) next = next.slice(next.length - MAX_ACTIVE_PLANS)
  return next
}

/** True when applying a turn's updates actually changed the stored list — lets the caller skip a PUT on the common no-op turn. Compared by id + fields, since resolves can reorder. */
export function plansChanged(before: CharacterPlan[] | undefined, after: CharacterPlan[]): boolean {
  const a = before ?? []
  if (a.length !== after.length) return true
  const byId = new Map(a.map((p) => [p.id, p]))
  return after.some((p) => {
    const q = byId.get(p.id)
    return !q || q.goal !== p.goal || q.kind !== p.kind || q.note !== p.note
  })
}

/** One line per active plan for the judge — kind and any note baked in, NOT numbered (the judge prompt adds indices, matching how it handles `unresolvedFacts`/`pendingTasks`). */
export function planLinesForJudge(plans: CharacterPlan[] | undefined): string[] {
  return (plans ?? []).map((p) => `[${p.kind}] ${p.goal}${p.note ? ` — ${p.note}` : ''}`)
}

function planLine(plan: CharacterPlan, userName: string): string {
  const tag =
    plan.kind === 'together' ? `with ${userName}` : plan.kind === 'distance' ? 'holding back' : 'their own life'
  return `- (${tag}) ${plan.goal}${plan.note ? ` — ${plan.note}` : ''}`
}

/** `styleGuidance` line carrying a character's persistent plans into generation. `''` when there are no active plans. */
export function plansGuidance(charName: string, userName: string, plans: CharacterPlan[] | undefined): string {
  const active = plans ?? []
  if (active.length === 0) return ''
  const lines = active.map((p) => planLine(p, userName)).join('\n')
  return `Beyond just responding to ${userName}, ${charName} is carrying intentions of their own right now:\n${lines}\nA turn doesn't have to be only about ${userName}. Where it fits naturally, ${charName} can move one of these forward, bring it up, act on it (even something done off-screen between turns), or let it pull against what ${userName} wants — and can drop one if the scene makes it moot. Don't force it; a plan sitting in the background until its moment is fine.`
}
