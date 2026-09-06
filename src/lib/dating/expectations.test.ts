import { describe, expect, it } from 'vitest'
import type { UserExpectation } from '@/lib/types'
import {
  EXPECTATION_STALE_TURNS,
  MAX_ACTIVE_EXPECTATIONS,
  applyExpectationUpdates,
  expectationLinesForJudge,
  expectationsChanged,
  expectationsGuidance,
  parseExpectationUpdates,
  violatedExpectationTexts,
} from './expectations'

const expectation = (over: Partial<UserExpectation> = {}): UserExpectation => ({
  id: 'e1',
  text: 'expects a check-in most Sundays',
  formedTurn: 0,
  ...over,
})

let seq = 0
const idGen = () => `new-${++seq}`

describe('parseExpectationUpdates', () => {
  it('keeps a well-formed add', () => {
    expect(parseExpectationUpdates([{ action: 'add', text: 'expects him to remember her deadline' }])).toEqual([
      { action: 'add', text: 'expects him to remember her deadline' },
    ])
  })

  it('keeps note and resolve (with a valid outcome) updates', () => {
    expect(
      parseExpectationUpdates([
        { action: 'note', index: 0, note: 'held up last week' },
        { action: 'resolve', index: 1, outcome: 'violated' },
      ]),
    ).toEqual([
      { action: 'note', index: 0, note: 'held up last week' },
      { action: 'resolve', index: 1, outcome: 'violated' },
    ])
  })

  it('drops a resolve with no valid outcome, and other malformed entries', () => {
    expect(
      parseExpectationUpdates([
        { action: 'add', text: '  ' },
        { action: 'note', index: 1 },
        { action: 'resolve', index: 0 },
        { action: 'resolve', index: 0, outcome: 'shrug' },
        { action: 'resolve', index: -1, outcome: 'met' },
        'nope',
        null,
      ]),
    ).toEqual([])
  })

  it('returns [] for a non-array', () => {
    expect(parseExpectationUpdates(undefined)).toEqual([])
    expect(parseExpectationUpdates('[]')).toEqual([])
  })
})

describe('applyExpectationUpdates', () => {
  it('adds a new expectation stamped with the current turn', () => {
    const next = applyExpectationUpdates([], [{ action: 'add', text: 'expects a call on her birthday' }], 12, idGen)
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ text: 'expects a call on her birthday', formedTurn: 12 })
  })

  it('resolves (removing) and annotates against the pre-add index order, regardless of outcome', () => {
    const expectations = [expectation({ id: 'a', text: 'A' }), expectation({ id: 'b', text: 'B' }), expectation({ id: 'c', text: 'C' })]
    const next = applyExpectationUpdates(
      expectations,
      [
        { action: 'resolve', index: 1, outcome: 'met' },
        { action: 'note', index: 2, note: 'still holding' },
        { action: 'add', text: 'D' },
      ],
      5,
      idGen,
    )
    expect(next.map((e) => e.id)).toEqual(['a', 'c', expect.stringMatching(/^new-/)])
    expect(next.find((e) => e.id === 'c')?.note).toBe('still holding')
  })

  it('caps at MAX_ACTIVE_EXPECTATIONS, dropping the oldest', () => {
    const expectations = [expectation({ id: 'a' }), expectation({ id: 'b' }), expectation({ id: 'c' })]
    const next = applyExpectationUpdates(expectations, [{ action: 'add', text: 'D' }], 9, idGen)
    expect(next).toHaveLength(MAX_ACTIVE_EXPECTATIONS)
    expect(next.map((e) => e.id)).not.toContain('a')
  })

  it('ages out an expectation past EXPECTATION_STALE_TURNS with no update', () => {
    const stale = expectation({ id: 'old', formedTurn: 1 })
    const fresh = expectation({ id: 'new', formedTurn: 1 + EXPECTATION_STALE_TURNS })
    const next = applyExpectationUpdates([stale, fresh], [], 1 + EXPECTATION_STALE_TURNS + 1, idGen)
    expect(next.map((e) => e.id)).toEqual(['new'])
  })

  it('skips a near-duplicate expectation already live', () => {
    const expectations = [expectation({ id: 'a', text: 'Expects A Check-In Most Sundays' })]
    const next = applyExpectationUpdates(expectations, [{ action: 'add', text: 'expects a check-in most sundays' }], 3, idGen)
    expect(next).toHaveLength(1)
  })

  it('is a no-op on an empty update list', () => {
    const expectations = [expectation()]
    expect(applyExpectationUpdates(expectations, [], 3, idGen)).toEqual(expectations)
  })
})

describe('expectationsChanged', () => {
  it('is false when nothing moved', () => {
    const expectations = [expectation()]
    expect(expectationsChanged(expectations, applyExpectationUpdates(expectations, [], 3, idGen))).toBe(false)
    expect(expectationsChanged(undefined, [])).toBe(false)
  })

  it('is true when noted, resolved, or added', () => {
    const expectations = [expectation({ id: 'a' })]
    expect(
      expectationsChanged(expectations, applyExpectationUpdates(expectations, [{ action: 'note', index: 0, note: 'x' }], 3, idGen)),
    ).toBe(true)
    expect(
      expectationsChanged(
        expectations,
        applyExpectationUpdates(expectations, [{ action: 'resolve', index: 0, outcome: 'met' }], 3, idGen),
      ),
    ).toBe(true)
    expect(
      expectationsChanged(expectations, applyExpectationUpdates(expectations, [{ action: 'add', text: 'B' }], 3, idGen)),
    ).toBe(true)
  })
})

describe('violatedExpectationTexts', () => {
  it("reads the pre-update text for each 'violated' resolution", () => {
    const expectations = [expectation({ id: 'a', text: 'A' }), expectation({ id: 'b', text: 'B' })]
    expect(
      violatedExpectationTexts(expectations, [
        { action: 'resolve', index: 1, outcome: 'violated' },
        { action: 'resolve', index: 0, outcome: 'met' },
      ]),
    ).toEqual(['B'])
  })

  it('is empty with no violated resolutions, or an out-of-range index', () => {
    const expectations = [expectation({ id: 'a', text: 'A' })]
    expect(violatedExpectationTexts(expectations, [])).toEqual([])
    expect(violatedExpectationTexts(expectations, [{ action: 'resolve', index: 5, outcome: 'violated' }])).toEqual([])
    expect(violatedExpectationTexts(undefined, [{ action: 'resolve', index: 0, outcome: 'violated' }])).toEqual([])
  })
})

describe('expectationLinesForJudge', () => {
  it('bakes an optional note into one line per expectation, unnumbered', () => {
    expect(
      expectationLinesForJudge([expectation({ text: 'A', note: 'held up last week' }), expectation({ text: 'B' })]),
    ).toEqual(['A — held up last week', 'B'])
  })

  it('is empty for no expectations', () => {
    expect(expectationLinesForJudge(undefined)).toEqual([])
  })
})

describe('expectationsGuidance', () => {
  it('lists expectations with real names', () => {
    const out = expectationsGuidance('Sumire', 'Kai', [expectation({ text: 'expects a check-in most Sundays' })])
    expect(out).toMatch(/Sumire has started expecting certain things from Kai/i)
    expect(out).toMatch(/check-in most Sundays/)
    expect(out).not.toMatch(/\{\{/)
  })

  it('is empty when there are none', () => {
    expect(expectationsGuidance('Sumire', 'Kai', [])).toBe('')
    expect(expectationsGuidance('Sumire', 'Kai', undefined)).toBe('')
  })
})
