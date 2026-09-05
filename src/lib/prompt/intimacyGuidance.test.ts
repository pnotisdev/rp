import { describe, expect, it } from 'vitest'
import { intimacyGuidance } from './intimacyGuidance'

describe('intimacyGuidance', () => {
  it("returns an empty string for 'default' — no behavior change for anyone who hasn't touched the setting", () => {
    expect(intimacyGuidance('default')).toBe('')
  })

  it('returns a non-empty, distinct instruction for each of the three opt-in levels', () => {
    const fadeToBlack = intimacyGuidance('fade_to_black')
    const suggestive = intimacyGuidance('suggestive')
    const explicit = intimacyGuidance('explicit')
    for (const text of [fadeToBlack, suggestive, explicit]) {
      expect(text.length).toBeGreaterThan(0)
    }
    expect(new Set([fadeToBlack, suggestive, explicit]).size).toBe(3)
  })

  it("fade_to_black explicitly tells the model not to narrate explicit content", () => {
    expect(intimacyGuidance('fade_to_black').toLowerCase()).toContain("don't narrate explicit")
  })

  it('explicit is framed as the user\'s own deliberate choice, not an unprompted default', () => {
    expect(intimacyGuidance('explicit')).toContain('enabled by the user')
  })
})
