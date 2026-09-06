import { describe, expect, it } from 'vitest'
import type { CharacterBelief } from '@/lib/types'
import {
  MAX_ACTIVE_BELIEFS,
  BELIEF_STALE_TURNS,
  applyBeliefUpdates,
  beliefLinesForJudge,
  beliefsChanged,
  beliefsGuidance,
  parseBeliefUpdates,
} from './beliefs'

const belief = (over: Partial<CharacterBelief> = {}): CharacterBelief => ({
  id: 'b1',
  text: 'He is unusually patient with me.',
  formedTurn: 0,
  ...over,
})

let seq = 0
const idGen = () => `new-${++seq}`

describe('parseBeliefUpdates', () => {
  it('keeps a well-formed add', () => {
    expect(parseBeliefUpdates([{ action: 'add', text: 'He avoids hard conversations.' }])).toEqual([
      { action: 'add', text: 'He avoids hard conversations.' },
    ])
  })

  it('keeps revise and drop updates with a valid index', () => {
    expect(
      parseBeliefUpdates([
        { action: 'revise', index: 0, text: 'sharper version' },
        { action: 'drop', index: 2 },
      ]),
    ).toEqual([
      { action: 'revise', index: 0, text: 'sharper version' },
      { action: 'drop', index: 2 },
    ])
  })

  it('drops malformed entries — no text, negative or non-integer index, non-object', () => {
    expect(
      parseBeliefUpdates([
        { action: 'add', text: '   ' },
        { action: 'revise', index: 1 },
        { action: 'revise', index: -1, text: 'x' },
        { action: 'drop', index: 1.5 },
        'nope',
        null,
      ]),
    ).toEqual([])
  })

  it('returns [] for a non-array', () => {
    expect(parseBeliefUpdates(undefined)).toEqual([])
    expect(parseBeliefUpdates('[]')).toEqual([])
  })
})

describe('applyBeliefUpdates', () => {
  it('adds a new belief stamped with the current turn', () => {
    const next = applyBeliefUpdates([], [{ action: 'add', text: 'He remembers small details.' }], 12, idGen)
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ text: 'He remembers small details.', formedTurn: 12 })
  })

  it('revises and drops against the pre-add index order, and re-stamps a revised belief with the current turn', () => {
    const beliefs = [belief({ id: 'a', text: 'A' }), belief({ id: 'b', text: 'B' }), belief({ id: 'c', text: 'C', formedTurn: 1 })]
    const next = applyBeliefUpdates(
      beliefs,
      [
        { action: 'drop', index: 1 },
        { action: 'revise', index: 2, text: 'C revised' },
        { action: 'add', text: 'D' },
      ],
      5,
      idGen,
    )
    expect(next.map((b) => b.id)).toEqual(['a', 'c', expect.stringMatching(/^new-/)])
    const revised = next.find((b) => b.id === 'c')
    expect(revised?.text).toBe('C revised')
    expect(revised?.formedTurn).toBe(5)
  })

  it('caps at MAX_ACTIVE_BELIEFS, dropping the oldest', () => {
    const beliefs = [belief({ id: 'a' }), belief({ id: 'b' }), belief({ id: 'c' }), belief({ id: 'd' })]
    const next = applyBeliefUpdates(beliefs, [{ action: 'add', text: 'E' }], 9, idGen)
    expect(next).toHaveLength(MAX_ACTIVE_BELIEFS)
    expect(next.map((b) => b.id)).not.toContain('a')
  })

  it('ages out a belief past BELIEF_STALE_TURNS with no reinforcement', () => {
    const stale = belief({ id: 'old', formedTurn: 1 })
    const fresh = belief({ id: 'new', formedTurn: 1 + BELIEF_STALE_TURNS })
    const next = applyBeliefUpdates([stale, fresh], [], 1 + BELIEF_STALE_TURNS + 1, idGen)
    expect(next.map((b) => b.id)).toEqual(['new'])
  })

  it('skips a near-duplicate impression already held', () => {
    const beliefs = [belief({ id: 'a', text: 'He Is Unusually Patient With Me.' })]
    const next = applyBeliefUpdates(beliefs, [{ action: 'add', text: 'he is unusually patient with me.' }], 3, idGen)
    expect(next).toHaveLength(1)
  })

  it('is a no-op on an empty update list', () => {
    const beliefs = [belief()]
    expect(applyBeliefUpdates(beliefs, [], 3, idGen)).toEqual(beliefs)
  })
})

describe('beliefsChanged', () => {
  it('is false when nothing moved', () => {
    const beliefs = [belief()]
    expect(beliefsChanged(beliefs, applyBeliefUpdates(beliefs, [], 3, idGen))).toBe(false)
    expect(beliefsChanged(undefined, [])).toBe(false)
  })

  it('is true when revised, dropped, or added', () => {
    const beliefs = [belief({ id: 'a' })]
    expect(beliefsChanged(beliefs, applyBeliefUpdates(beliefs, [{ action: 'revise', index: 0, text: 'x' }], 3, idGen))).toBe(true)
    expect(beliefsChanged(beliefs, applyBeliefUpdates(beliefs, [{ action: 'drop', index: 0 }], 3, idGen))).toBe(true)
    expect(beliefsChanged(beliefs, applyBeliefUpdates(beliefs, [{ action: 'add', text: 'B' }], 3, idGen))).toBe(true)
  })
})

describe('beliefLinesForJudge', () => {
  it('is one line per belief, unnumbered', () => {
    expect(beliefLinesForJudge([belief({ text: 'A' }), belief({ text: 'B' })])).toEqual(['A', 'B'])
  })

  it('is empty for no beliefs', () => {
    expect(beliefLinesForJudge(undefined)).toEqual([])
  })
})

describe('beliefsGuidance', () => {
  it('lists impressions with real names, permission to let them colour reactions', () => {
    const out = beliefsGuidance('Sumire', 'Kai', [belief({ text: 'He is unusually patient with me.' })])
    expect(out).toMatch(/Sumire has formed some real impressions of Kai/i)
    expect(out).toMatch(/unusually patient/)
    expect(out).not.toMatch(/\{\{/)
  })

  it('is empty when there are no beliefs', () => {
    expect(beliefsGuidance('Sumire', 'Kai', [])).toBe('')
    expect(beliefsGuidance('Sumire', 'Kai', undefined)).toBe('')
  })
})
