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

  it('trigger_fired reads the firedTriggerIds set directly, defaulting to false when absent', () => {
    expect(conditionHolds({ kind: 'trigger_fired', triggerId: 'a' }, ctx())).toBe(false)
    expect(conditionHolds({ kind: 'trigger_fired', triggerId: 'a' }, ctx({ firedTriggerIds: new Set(['a']) }))).toBe(true)
    expect(conditionHolds({ kind: 'trigger_fired', triggerId: 'a' }, ctx({ firedTriggerIds: new Set(['b']) }))).toBe(false)
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

  describe('consequence chains (trigger_fired)', () => {
    it('lets a later rule in the SAME pass fire off an earlier one that just fired (author order)', () => {
      const chain = [
        trigger({ id: 'jealousy-flares', then: [{ kind: 'set_flag', flag: 'jealousy' }] }),
        trigger({ id: 'trust-test', when: [{ kind: 'trigger_fired', triggerId: 'jealousy-flares' }], then: [{ kind: 'notify', text: 'chained' }] }),
      ]
      const out = evaluateTriggers(chain, ctx())
      expect(out.fired.map((t) => t.id)).toEqual(['jealousy-flares', 'trust-test'])
    })

    it('does NOT let an earlier rule in the pass see a LATER one firing (order matters, no lookahead)', () => {
      const chain = [
        trigger({ id: 'trust-test', when: [{ kind: 'trigger_fired', triggerId: 'jealousy-flares' }], then: [{ kind: 'notify', text: 'chained' }] }),
        trigger({ id: 'jealousy-flares', then: [{ kind: 'set_flag', flag: 'jealousy' }] }),
      ]
      const out = evaluateTriggers(chain, ctx())
      expect(out.fired.map((t) => t.id)).toEqual(['jealousy-flares'])
    })

    it('chains across two turns exactly the way the real caller applies it: fire, persist firedIds, re-evaluate later', () => {
      const chain = [
        trigger({ id: 'jealousy-flares', when: [{ kind: 'stat_at_least', stat: 'tension', value: 50 }] }),
        trigger({ id: 'trust-test', when: [{ kind: 'trigger_fired', triggerId: 'jealousy-flares' }, { kind: 'stat_at_least', stat: 'trust', value: 80 }] }),
      ]
      // Turn 1: tension is high enough for the first rule, but trust isn't there yet for the second.
      const turn1 = evaluateTriggers(chain, ctx({ stats: { tension: 60, trust: 40 } }))
      expect(turn1.fired.map((t) => t.id)).toEqual(['jealousy-flares'])
      // Turn 2 (a later scene): tension has settled back down (the first rule's own condition no
      // longer holds, and it's one-shot so it wouldn't re-fire anyway), but trust has since grown
      // — the second rule fires now purely because the first one fired *at some point*, exactly
      // the "a jealousy beat feeds a later trust rule" shape this was built for.
      const turn2 = evaluateTriggers(chain, ctx({ stats: { tension: 10, trust: 85 } }), turn1.firedIds)
      expect(turn2.fired.map((t) => t.id)).toEqual(['trust-test'])
    })

    it('never satisfies trigger_fired for a rule that has not fired at all', () => {
      const chain = [
        trigger({ id: 'never-holds', when: [{ kind: 'stat_at_least', stat: 'affection', value: 999 }] }),
        trigger({ id: 'trust-test', when: [{ kind: 'trigger_fired', triggerId: 'never-holds' }] }),
      ]
      const out = evaluateTriggers(chain, ctx())
      expect(out.fired).toEqual([])
    })
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
    expect(describeCondition({ kind: 'trigger_fired', triggerId: 'first-kiss' })).toContain('first-kiss')
  })

  it('summarises each action kind readably', () => {
    expect(describeAction({ kind: 'set_flag', flag: 'opened_up' })).toContain('opened_up')
    expect(describeAction({ kind: 'remember', text: 'x' })).toContain('remember')
    expect(describeAction({ kind: 'notify', text: 'x' })).toContain('notify')
    expect(describeAction({ kind: 'social_reaction', topic: 'the engagement' })).toContain('the engagement')
    expect(describeAction({ kind: 'style_guidance', text: 'gifts read as suspicious right now' })).toContain(
      'gifts read as suspicious right now',
    )
  })
})

describe('style_guidance action (bounded-window world rules)', () => {
  it('flows through evaluateTriggers actions like any other action kind', () => {
    const t = [trigger({ id: 'a', then: [{ kind: 'style_guidance', text: 'gifts read as loaded right now' }] })]
    const out = evaluateTriggers(t, ctx())
    expect(out.actions).toEqual([{ kind: 'style_guidance', text: 'gifts read as loaded right now' }])
  })

  it('a repeatable trigger only keeps firing the steer while its own condition still holds — the "bounded window" falls out of re-evaluation, not new timer state', () => {
    const t = [
      trigger({
        id: 'jealousy-suspicion',
        repeatable: true,
        when: [{ kind: 'stat_at_least', stat: 'tension', value: 60 }],
        then: [{ kind: 'style_guidance', text: 'a gift right now would read as loaded' }],
      }),
    ]
    const hot = evaluateTriggers(t, ctx({ stats: { tension: 70 } }))
    expect(hot.actions).toEqual([{ kind: 'style_guidance', text: 'a gift right now would read as loaded' }])
    // Tension has since cooled back down — the same repeatable rule simply stops firing, with no
    // flag or timer left over from the earlier turn.
    const cooled = evaluateTriggers(t, ctx({ stats: { tension: 10 } }), hot.firedIds)
    expect(cooled.actions).toEqual([])
  })

  it('a one-shot style_guidance fires exactly once, as a single callout rather than a window', () => {
    const t = [trigger({ id: 'a', then: [{ kind: 'style_guidance', text: 'one-time callout' }] })]
    const first = evaluateTriggers(t, ctx())
    expect(first.actions).toEqual([{ kind: 'style_guidance', text: 'one-time callout' }])
    const second = evaluateTriggers(t, ctx(), first.firedIds)
    expect(second.actions).toEqual([])
  })
})
