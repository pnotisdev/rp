import { describe, expect, it } from 'vitest'
import type { CharacterPlan } from '@/lib/types'
import {
  MAX_ACTIVE_PLANS,
  PLAN_STALE_TURNS,
  applyPlanUpdates,
  describePlanForPanel,
  parsePlanUpdates,
  planLinesForJudge,
  plansChanged,
  plansGuidance,
} from './plans'

const plan = (over: Partial<CharacterPlan> = {}): CharacterPlan => ({
  id: 'p1',
  goal: 'finish the mural before the showcase',
  kind: 'personal',
  formedTurn: 0,
  ...over,
})

let seq = 0
const idGen = () => `new-${++seq}`

describe('parsePlanUpdates', () => {
  it('keeps a well-formed add and defaults an unknown kind to personal', () => {
    expect(parsePlanUpdates([{ action: 'add', goal: 'call her sister', kind: 'weird' }])).toEqual([
      { action: 'add', goal: 'call her sister', kind: 'personal', note: undefined },
    ])
  })

  it('keeps note and resolve updates with a valid index', () => {
    expect(
      parsePlanUpdates([
        { action: 'note', index: 0, note: 'made progress' },
        { action: 'resolve', index: 2 },
      ]),
    ).toEqual([
      { action: 'note', index: 0, note: 'made progress' },
      { action: 'resolve', index: 2 },
    ])
  })

  it('drops malformed entries — no goal, no note, negative or non-integer index, non-object', () => {
    expect(
      parsePlanUpdates([
        { action: 'add', goal: '   ' },
        { action: 'note', index: 1 },
        { action: 'note', index: -1, note: 'x' },
        { action: 'resolve', index: 1.5 },
        'nope',
        null,
      ]),
    ).toEqual([])
  })

  it('returns [] for a non-array', () => {
    expect(parsePlanUpdates(undefined)).toEqual([])
    expect(parsePlanUpdates('[]')).toEqual([])
  })
})

describe('applyPlanUpdates', () => {
  it('adds a new plan stamped with the current turn', () => {
    const next = applyPlanUpdates([], [{ action: 'add', goal: 'get the lease signed', kind: 'personal' }], 12, idGen)
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ goal: 'get the lease signed', kind: 'personal', formedTurn: 12 })
  })

  it('resolves and annotates against the pre-add index order', () => {
    const plans = [plan({ id: 'a', goal: 'A' }), plan({ id: 'b', goal: 'B' }), plan({ id: 'c', goal: 'C' })]
    const next = applyPlanUpdates(
      plans,
      [
        { action: 'resolve', index: 1 },
        { action: 'note', index: 2, note: 'nearly there' },
        { action: 'add', goal: 'D', kind: 'together' },
      ],
      5,
      idGen,
    )
    expect(next.map((p) => p.id)).toEqual(['a', 'c', expect.stringMatching(/^new-/)])
    expect(next.find((p) => p.id === 'c')?.note).toBe('nearly there')
  })

  it('caps at MAX_ACTIVE_PLANS, dropping the oldest', () => {
    const plans = [plan({ id: 'a' }), plan({ id: 'b' }), plan({ id: 'c' })]
    const next = applyPlanUpdates(plans, [{ action: 'add', goal: 'D', kind: 'personal' }], 9, idGen)
    expect(next).toHaveLength(MAX_ACTIVE_PLANS)
    expect(next.map((p) => p.id)).not.toContain('a')
  })

  it('ages out a plan past PLAN_STALE_TURNS even with no resolve update', () => {
    const stale = plan({ id: 'old', formedTurn: 1 })
    const fresh = plan({ id: 'new', formedTurn: 1 + PLAN_STALE_TURNS })
    const next = applyPlanUpdates([stale, fresh], [], 1 + PLAN_STALE_TURNS + 1, idGen)
    expect(next.map((p) => p.id)).toEqual(['new'])
  })

  it('skips a near-duplicate goal already live', () => {
    const plans = [plan({ id: 'a', goal: 'Finish The Mural' })]
    const next = applyPlanUpdates(plans, [{ action: 'add', goal: 'finish the mural', kind: 'personal' }], 3, idGen)
    expect(next).toHaveLength(1)
  })

  it('is a no-op on an empty update list', () => {
    const plans = [plan()]
    expect(applyPlanUpdates(plans, [], 3, idGen)).toEqual(plans)
  })
})

describe('plansChanged', () => {
  it('is false when nothing moved', () => {
    const plans = [plan()]
    expect(plansChanged(plans, applyPlanUpdates(plans, [], 3, idGen))).toBe(false)
    expect(plansChanged(undefined, [])).toBe(false)
  })

  it('is true when a note was added, a plan resolved, or one formed', () => {
    const plans = [plan({ id: 'a' })]
    expect(plansChanged(plans, applyPlanUpdates(plans, [{ action: 'note', index: 0, note: 'x' }], 3, idGen))).toBe(true)
    expect(plansChanged(plans, applyPlanUpdates(plans, [{ action: 'resolve', index: 0 }], 3, idGen))).toBe(true)
    expect(plansChanged(plans, applyPlanUpdates(plans, [{ action: 'add', goal: 'B', kind: 'personal' }], 3, idGen))).toBe(true)
  })
})

describe('planLinesForJudge', () => {
  it('bakes kind and note into one line per plan, unnumbered', () => {
    expect(
      planLinesForJudge([plan({ goal: 'A', kind: 'distance', note: 'until he is honest' }), plan({ goal: 'B', kind: 'together' })]),
    ).toEqual(['[distance] A — until he is honest', '[together] B'])
  })

  it('is empty for no plans', () => {
    expect(planLinesForJudge(undefined)).toEqual([])
  })
})

describe('plansGuidance', () => {
  it('lists the plans with real names and permission to act on them', () => {
    const out = plansGuidance('Sumire', 'Kai', [
      plan({ goal: 'finish the mural', kind: 'personal' }),
      plan({ goal: 'take Kai to the coast', kind: 'together' }),
    ])
    expect(out).toMatch(/Sumire is carrying intentions of their own/i)
    expect(out).toMatch(/finish the mural/)
    expect(out).toMatch(/with Kai\) take Kai to the coast/)
    expect(out).not.toMatch(/\{\{/)
  })

  it('is empty when there are no plans', () => {
    expect(plansGuidance('Sumire', 'Kai', [])).toBe('')
    expect(plansGuidance('Sumire', 'Kai', undefined)).toBe('')
  })
})

describe('describePlanForPanel', () => {
  it('renders a plain string with a readable kind tag', () => {
    expect(describePlanForPanel(plan({ goal: 'A', kind: 'distance' }))).toBe('A · keeping distance')
    expect(describePlanForPanel(plan({ goal: 'B', kind: 'together' }))).toBe('B · with you')
  })
})
