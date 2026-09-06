import { describe, expect, it } from 'vitest'
import {
  TRAIT_AXIS_META,
  composeTraitBrief,
  extractTraitOptionsPositionally,
  randomTraitOption,
  randomTraitPicks,
  toTraitOptionPool,
  type TraitOptionSet,
} from './traitPresets'

const rawSet = (): TraitOptionSet => ({
  archetype: ['tsundere', 'gentle giant'],
  occupation: ['barista', 'veterinary tech'],
  quirk: ['hums when nervous', 'collects failed drafts'],
  relationshipStarter: ['childhood friends', 'reluctant roommates'],
})

describe('TRAIT_AXIS_META', () => {
  it('defines the four fixed axis categories, only archetype required', () => {
    expect(TRAIT_AXIS_META.map((a) => a.id)).toEqual(['archetype', 'occupation', 'quirk', 'relationshipStarter'])
    expect(TRAIT_AXIS_META.find((a) => a.id === 'archetype')?.required).toBe(true)
    expect(TRAIT_AXIS_META.filter((a) => a.id !== 'archetype').every((a) => !a.required)).toBe(true)
  })

  it('carries no static option lists — that content always comes from the model', () => {
    for (const axis of TRAIT_AXIS_META) {
      expect(axis).not.toHaveProperty('options')
    }
  })
})

describe('toTraitOptionPool', () => {
  it('turns raw model strings into keyed, comparable options per axis', () => {
    const pool = toTraitOptionPool(rawSet())
    expect(pool.archetype).toEqual([
      { id: 'archetype-0', label: 'tsundere', text: 'tsundere' },
      { id: 'archetype-1', label: 'gentle giant', text: 'gentle giant' },
    ])
    expect(pool.relationshipStarter.map((o) => o.text)).toEqual(['childhood friends', 'reluctant roommates'])
  })

  it('defaults a missing axis to an empty list rather than throwing', () => {
    const pool = toTraitOptionPool({ archetype: ['tsundere'] } as TraitOptionSet)
    expect(pool.occupation).toEqual([])
  })
})

describe('randomTraitOption', () => {
  it('always returns one of the given options', () => {
    const pool = toTraitOptionPool(rawSet())
    for (let i = 0; i < 20; i++) {
      expect(pool.archetype).toContainEqual(randomTraitOption(pool.archetype))
    }
  })

  it('returns undefined for an empty pool instead of throwing', () => {
    expect(randomTraitOption([])).toBeUndefined()
  })
})

describe('randomTraitPicks', () => {
  it('picks exactly one option per axis from the given pool', () => {
    const pool = toTraitOptionPool(rawSet())
    const picks = randomTraitPicks(pool)
    for (const axis of TRAIT_AXIS_META) {
      expect(picks[axis.id]).toBeTruthy()
      expect(pool[axis.id]).toContainEqual(picks[axis.id])
    }
  })
})

describe('extractTraitOptionsPositionally', () => {
  it('recovers all four axes from well-formed JSON (bracket-agnostic, so the normal case still works)', () => {
    const text = JSON.stringify(rawSet())
    expect(extractTraitOptionsPositionally(text)).toEqual(rawSet())
  })

  it('recovers axes whose array brackets were dropped entirely, the real failure this guards against', () => {
    // Exactly the shape captured from a live free-model response: archetype/occupation keep
    // their brackets, quirk and relationshipStarter don't — which breaks JSON.parse for the
    // whole object even though every individual string is fine.
    const text =
      '{"archetype":["tsundere rival","guilt-ridden healer"],' +
      '"occupation":["night-shift ER nurse","forensic sketch artist"],' +
      '"quirk":"mutters old radio ad jingles","always pockets condiment packets"],' +
      '"relationshipStarter":"you returned the wallet they left","we got stuck in an elevator"}'
    expect(extractTraitOptionsPositionally(text)).toEqual({
      archetype: ['tsundere rival', 'guilt-ridden healer'],
      occupation: ['night-shift ER nurse', 'forensic sketch artist'],
      quirk: ['mutters old radio ad jingles', 'always pockets condiment packets'],
      relationshipStarter: ['you returned the wallet they left', 'we got stuck in an elevator'],
    })
  })

  it('ignores an axis that never occurs in the text rather than throwing', () => {
    expect(extractTraitOptionsPositionally('{"archetype":["tsundere"]}')).toEqual({
      archetype: ['tsundere'],
      occupation: [],
      quirk: [],
      relationshipStarter: [],
    })
  })
})

describe('composeTraitBrief', () => {
  it('folds all four picks into one brief with no macros', () => {
    const brief = composeTraitBrief({
      archetype: { id: '0', label: 'tsundere', text: 'tsundere' },
      occupation: { id: '0', label: 'barista', text: 'barista' },
      quirk: { id: '0', label: 'hums when nervous', text: 'hums when nervous' },
      relationshipStarter: { id: '0', label: 'childhood friends', text: 'childhood friends who reconnected' },
    })
    expect(brief).toBe(
      'A tsundere who works as a barista. Quirk: hums when nervous. Relationship to the player: childhood friends who reconnected.',
    )
    expect(brief).not.toMatch(/\{\{/)
  })

  it('omits clauses for unpicked axes', () => {
    expect(composeTraitBrief({ archetype: { id: '0', label: 'stoic guardian', text: 'stoic guardian' } })).toBe(
      'A stoic guardian.',
    )
  })

  it('falls back to a generic lead when even archetype is missing', () => {
    expect(composeTraitBrief({})).toBe('A person.')
  })
})
