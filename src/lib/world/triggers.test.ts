import { describe, expect, it } from 'vitest'
import {
  conditionHolds,
  describeAction,
  describeCondition,
  evaluateTriggers,
  slugifyTriggerId,
  triggerSatisfied,
  type Trigger,
  type TriggerContext,
} from './triggers'

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  affection: 50,
  warmth: 50,
  stats: { trust: 60, comfort: 40, tension: 10 },
  flags: new Set<string>(),
  commitmentStatus: 'none',
  day: 3,
  ...over,
})

const trigger = (over: Partial<Trigger> & { id: string }): Trigger => ({
  label: over.id,
  when: [{ kind: 'stat_at_least', stat: 'affection', value: 0 }],
  then: [{ kind: 'notify', text: 'hi' }],
  ...over,
})

describe('conditionHolds', () => {
  it('reads affection and warmth as first-class stats', () => {
    expect(conditionHolds({ kind: 'stat_at_least', stat: 'affection', value: 50 }, ctx())).toBe(true)
    expect(conditionHolds({ kind: 'stat_at_least', stat: 'affection', value: 51 }, ctx())).toBe(false)
    expect(conditionHolds({ kind: 'stat_at_least', stat: 'warmth', value: 50 }, ctx())).toBe(true)
  })

  it('reads a relationship dimension, treating an unset one as zero', () => {
    expect(conditionHolds({ kind: 'stat_at_least', stat: 'trust', value: 60 }, ctx())).toBe(true)
    expect(conditionHolds({ kind: 'stat_at_least', stat: 'respect', value: 1 }, ctx())).toBe(false)
  })

  it('treats stat_below as strict, so it is the exact complement of stat_at_least', () => {
    const c = ctx()
    for (const value of [0, 40, 60, 100]) {
      const atLeast = conditionHolds({ kind: 'stat_at_least', stat: 'trust', value }, c)
      const below = conditionHolds({ kind: 'stat_below', stat: 'trust', value }, c)
      expect(atLeast).toBe(!below)
    }
  })

  it('tests scene flags', () => {
    expect(conditionHolds({ kind: 'flag_set', flag: 'confession' }, ctx())).toBe(false)
    expect(conditionHolds({ kind: 'flag_set', flag: 'confession' }, ctx({ flags: new Set(['confession']) }))).toBe(true)
  })

  it('treats commitment as a ladder, not an equality check', () => {
    const married = ctx({ commitmentStatus: 'married' })
    expect(conditionHolds({ kind: 'commitment_at_least', status: 'dating' }, married)).toBe(true)
    const dating = ctx({ commitmentStatus: 'dating' })
    expect(conditionHolds({ kind: 'commitment_at_least', status: 'dating' }, dating)).toBe(true)
    expect(conditionHolds({ kind: 'commitment_at_least', status: 'exclusive' }, dating)).toBe(false)
  })

  it('never satisfies a day condition for a character with no world clock', () => {
    // Distinct from day 0, which legitimately satisfies `day_at_least: 0`.
    expect(conditionHolds({ kind: 'day_at_least', day: 0 }, ctx({ day: undefined }))).toBe(false)
    expect(conditionHolds({ kind: 'day_at_least', day: 0 }, ctx({ day: 0 }))).toBe(true)
    expect(conditionHolds({ kind: 'day_at_least', day: 4 }, ctx({ day: 3 }))).toBe(false)
  })

  it('never holds for a condition kind this build does not understand', () => {
    // Data from a newer build, or hand-edited. Firing an author's rule on a condition we cannot
    // evaluate would be worse than not firing it.
    expect(conditionHolds({ kind: 'from_the_future' } as never, ctx())).toBe(false)
  })
})

describe('triggerSatisfied', () => {
  it('requires every condition', () => {
    const t = trigger({
      id: 't',
      when: [
        { kind: 'stat_at_least', stat: 'trust', value: 60 },
        { kind: 'flag_set', flag: 'confession' },
      ],
    })
    expect(triggerSatisfied(t, ctx())).toBe(false)
    expect(triggerSatisfied(t, ctx({ flags: new Set(['confession']) }))).toBe(true)
  })

  it('never fires a trigger with no conditions, rather than firing it constantly', () => {
    expect(triggerSatisfied(trigger({ id: 't', when: [] }), ctx())).toBe(false)
  })
})

describe('evaluateTriggers', () => {
  it('returns nothing with no triggers authored', () => {
    const out = evaluateTriggers(undefined, ctx())
    expect(out.fired).toEqual([])
    expect(out.actions).toEqual([])
    expect(out.firedIds).toEqual([])
  })

  it('fires a satisfied trigger and records its id', () => {
    const out = evaluateTriggers([trigger({ id: 'a' })], ctx())
    expect(out.fired.map((t) => t.id)).toEqual(['a'])
    expect(out.firedIds).toEqual(['a'])
  })

  it('never fires a one-shot trigger twice', () => {
    const t = [trigger({ id: 'a' })]
    const first = evaluateTriggers(t, ctx())
    const second = evaluateTriggers(t, ctx(), first.firedIds)
    expect(second.fired).toEqual([])
    expect(second.firedIds).toEqual(['a'])
  })

  it('will not re-fire a one-shot even after its condition lapses and returns', () => {
    const t = [trigger({ id: 'a', when: [{ kind: 'stat_at_least', stat: 'trust', value: 60 }] })]
    const first = evaluateTriggers(t, ctx())
    const lapsed = evaluateTriggers(t, ctx({ stats: { trust: 10 } }), first.firedIds)
    const returned = evaluateTriggers(t, ctx(), lapsed.firedIds)
    expect(returned.fired).toEqual([])
  })

  it('fires a repeatable trigger every time, and never records it as spent', () => {
    const t = [trigger({ id: 'a', repeatable: true })]
    const first = evaluateTriggers(t, ctx())
    expect(first.fired.map((x) => x.id)).toEqual(['a'])
    expect(first.firedIds).toEqual([])
    const second = evaluateTriggers(t, ctx(), first.firedIds)
    expect(second.fired.map((x) => x.id)).toEqual(['a'])
  })

  it('skips a disabled trigger without marking it fired', () => {
    const out = evaluateTriggers([trigger({ id: 'a', enabled: false })], ctx())
    expect(out.fired).toEqual([])
    expect(out.firedIds).toEqual([])
  })

  it('treats an unset enabled flag as enabled, so existing data needs no migration', () => {
    const t = trigger({ id: 'a' })
    delete (t as Partial<Trigger>).enabled
    expect(evaluateTriggers([t], ctx()).fired).toHaveLength(1)
  })

  it('flattens actions in author order across several fired triggers', () => {
    const out = evaluateTriggers(
      [
        trigger({ id: 'a', then: [{ kind: 'set_flag', flag: 'one' }] }),
        trigger({ id: 'b', then: [{ kind: 'remember', text: 'two' }, { kind: 'notify', text: 'three' }] }),
      ],
      ctx(),
    )
    expect(out.actions).toEqual([
      { kind: 'set_flag', flag: 'one' },
      { kind: 'remember', text: 'two' },
      { kind: 'notify', text: 'three' },
    ])
  })

  it('preserves fired ids it did not set, so one chat cannot clear another\'s history', () => {
    const out = evaluateTriggers([trigger({ id: 'a' })], ctx(), ['old-one'])
    expect(out.firedIds.sort()).toEqual(['a', 'old-one'])
  })

  it('is pure — the same inputs twice give the same answer', () => {
    const t = [trigger({ id: 'a' })]
    const c = ctx()
    expect(evaluateTriggers(t, c)).toEqual(evaluateTriggers(t, c))
  })
})

describe('slugifyTriggerId', () => {
  it('produces a stable id from a label', () => {
    expect(slugifyTriggerId('She opens up about her father', [])).toBe('she-opens-up-about-her-father')
  })

  it('deduplicates', () => {
    expect(slugifyTriggerId('Opens up', ['opens-up'])).toBe('opens-up-2')
  })
})

describe('describeCondition / describeAction', () => {
  it('summarises each condition kind readably', () => {
    expect(describeCondition({ kind: 'stat_at_least', stat: 'trust', value: 70 })).toBe('trust ≥ 70')
    expect(describeCondition({ kind: 'stat_below', stat: 'tension', value: 20 })).toBe('tension < 20')
    expect(describeCondition({ kind: 'flag_set', flag: 'confession' })).toContain('confession')
    expect(describeCondition({ kind: 'commitment_at_least', status: 'living_together' })).toBe('at least living together')
    expect(describeCondition({ kind: 'day_at_least', day: 7 })).toBe('day 7+')
  })

  it('summarises each action kind readably', () => {
    expect(describeAction({ kind: 'set_flag', flag: 'opened_up' })).toContain('opened_up')
    expect(describeAction({ kind: 'remember', text: 'x' })).toContain('remember')
    expect(describeAction({ kind: 'notify', text: 'x' })).toContain('notify')
  })
})
