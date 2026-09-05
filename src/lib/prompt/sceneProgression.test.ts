import { describe, expect, it } from 'vitest'
import { countStaticSceneTurns, sceneProgressionNudge } from './sceneProgression'

describe('countStaticSceneTurns', () => {
  it('returns 0 with no messages at all', () => {
    expect(countStaticSceneTurns([])).toEqual({ count: 0 })
  })

  it('returns 0 when no character turn has ever been tagged with a background', () => {
    const messages = [
      { role: 'user', scene: undefined },
      { role: 'char', scene: undefined },
    ]
    expect(countStaticSceneTurns(messages)).toEqual({ count: 0 })
  })

  it('counts consecutive character turns sharing the latest background', () => {
    const messages = [
      { role: 'char', scene: { background: 'park' } },
      { role: 'user', scene: undefined },
      { role: 'char', scene: { background: 'library' } },
      { role: 'user', scene: undefined },
      { role: 'char', scene: { background: 'library' } },
      { role: 'user', scene: undefined },
      { role: 'char', scene: { background: 'library' } },
    ]
    expect(countStaticSceneTurns(messages)).toEqual({ count: 3, currentBackground: 'library' })
  })

  it('only counts character turns — a user message never breaks or extends the streak', () => {
    const messages = [
      { role: 'char', scene: { background: 'cafe' } },
      { role: 'user', scene: { background: 'library' } }, // a user turn is never scene-tagged in practice, but shouldn't count even if present
      { role: 'char', scene: { background: 'cafe' } },
    ]
    expect(countStaticSceneTurns(messages)).toEqual({ count: 2, currentBackground: 'cafe' })
  })

  it('resets the count at the most recent background change', () => {
    const messages = [
      { role: 'char', scene: { background: 'library' } },
      { role: 'char', scene: { background: 'library' } },
      { role: 'char', scene: { background: 'library' } },
      { role: 'char', scene: { background: 'cafe' } },
    ]
    expect(countStaticSceneTurns(messages)).toEqual({ count: 1, currentBackground: 'cafe' })
  })

  it('an untagged character turn in between is simply skipped, not treated as a break', () => {
    // An untagged turn (no VN mode ever used for it, or an edge case with no tag emitted) says
    // nothing about whether the location actually changed — ignoring it and looking only at the
    // turns that *do* say something is more honest than guessing it broke the streak.
    const messages = [
      { role: 'char', scene: { background: 'library' } },
      { role: 'char', scene: undefined },
      { role: 'char', scene: { background: 'library' } },
    ]
    expect(countStaticSceneTurns(messages)).toEqual({ count: 2, currentBackground: 'library' })
  })
})

describe('sceneProgressionNudge', () => {
  it('says nothing below the threshold', () => {
    expect(sceneProgressionNudge(5, {})).toBe('')
  })

  it('says something once the threshold is reached', () => {
    expect(sceneProgressionNudge(6, {})).toContain('stayed in the same place')
  })

  it('prefers the schedule location when one is given', () => {
    const nudge = sceneProgressionNudge(6, { scheduleLocation: 'the café', alternateBackgroundLabels: ['Park', 'Beach'] })
    expect(nudge).toContain('the café')
    expect(nudge).not.toContain('Park')
  })

  it('falls back to alternate background labels with no schedule location', () => {
    const nudge = sceneProgressionNudge(6, { alternateBackgroundLabels: ['Park', 'Beach'] })
    expect(nudge).toContain('Park')
    expect(nudge).toContain('Beach')
  })

  it('still returns a usable nudge with neither a schedule location nor alternates', () => {
    const nudge = sceneProgressionNudge(10, {})
    expect(nudge.length).toBeGreaterThan(0)
  })

  it('always leaves room for the scene to genuinely stay put', () => {
    expect(sceneProgressionNudge(6, {})).toContain("Don't force it")
  })

  it('never emits a {{char}}/{{user}} macro — styleGuidance strings are not macro-substituted, only systemPrompts.ts templates are', () => {
    const nudge = sceneProgressionNudge(6, { scheduleLocation: 'the café' })
    expect(nudge).not.toContain('{{')
  })
})
