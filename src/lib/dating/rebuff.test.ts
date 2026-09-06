import { describe, expect, it } from 'vitest'
import { isRebuffActive, rebuffGuidance, REBUFF_WINDOW_TURNS, turnsSinceRebuff, type RecentRebuff } from './rebuff'

const deflect: RecentRebuff = { startedAtTurn: 10, kind: 'commitment', severity: 'deflect' }
const backfire: RecentRebuff = { startedAtTurn: 10, kind: 'intimacy_milestone', severity: 'backfire' }

describe('turnsSinceRebuff', () => {
  it('is null with no rebuff on record', () => {
    expect(turnsSinceRebuff(undefined, 12)).toBeNull()
    expect(turnsSinceRebuff(null, 12)).toBeNull()
  })

  it('counts char replies since it happened', () => {
    expect(turnsSinceRebuff(deflect, 10)).toBe(0)
    expect(turnsSinceRebuff(deflect, 13)).toBe(3)
  })

  it('treats a stale rebuff (start now ahead of the conversation) as null, not "just happened"', () => {
    expect(turnsSinceRebuff(deflect, 5)).toBeNull()
  })
})

describe('isRebuffActive', () => {
  it('is active through the window and inactive once it elapses', () => {
    expect(isRebuffActive(deflect, 10)).toBe(true)
    expect(isRebuffActive(deflect, 10 + REBUFF_WINDOW_TURNS - 1)).toBe(true)
    expect(isRebuffActive(deflect, 10 + REBUFF_WINDOW_TURNS)).toBe(false)
  })

  it('is inactive with nothing on record', () => {
    expect(isRebuffActive(undefined, 10)).toBe(false)
  })

  it('is inactive for a stale rebuff', () => {
    expect(isRebuffActive(deflect, 2)).toBe(false)
  })
})

describe('rebuffGuidance', () => {
  it('reads softer for a deflect than a backfire', () => {
    const soft = rebuffGuidance('Sumire', 'Kai', deflect)
    const sharp = rebuffGuidance('Sumire', 'Kai', backfire)
    expect(soft).not.toBe(sharp)
    expect(sharp).toMatch(/stung/i)
    expect(soft).not.toMatch(/stung/i)
  })

  it('names both people and never punishes forever', () => {
    const line = rebuffGuidance('Sumire', 'Kai', backfire)
    expect(line).toContain('Sumire')
    expect(line).toContain('Kai')
    expect(line).toMatch(/never lifts|for a while/i)
  })

  it('distinguishes the kind of ask in its wording', () => {
    expect(rebuffGuidance('Sumire', 'Kai', deflect)).toMatch(/define where things/i)
    expect(rebuffGuidance('Sumire', 'Kai', { ...deflect, kind: 'intimacy_milestone' })).toMatch(/physically/i)
  })

  it('never emits a {{char}}/{{user}} macro — styleGuidance strings are not macro-substituted', () => {
    expect(rebuffGuidance('Sumire', 'Kai', deflect)).not.toContain('{{')
  })
})
