import { describe, expect, it } from 'vitest'
import { intimacyGuidance, resolveIntimacyLevel } from './intimacyGuidance'

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

describe('resolveIntimacyLevel', () => {
  it('falls back to the global setting when the world has none', () => {
    expect(resolveIntimacyLevel(undefined, 'suggestive')).toBe('suggestive')
    expect(resolveIntimacyLevel(undefined, 'default')).toBe('default')
  })

  it("lets an explicit world be explicit under the global's untouched default", () => {
    // The reason this overrides rather than clamps: 'default' is what a user who never opened the
    // setting has, and clamping to the stricter of the two would make an explicit world impossible
    // for exactly those users.
    expect(resolveIntimacyLevel('explicit', 'default')).toBe('explicit')
  })

  it('lets a wholesome world stay wholesome under a global explicit', () => {
    expect(resolveIntimacyLevel('fade_to_black', 'explicit')).toBe('fade_to_black')
  })

  it('treats null the same as undefined — the wire format for "clear it back to inherit"', () => {
    // `JSON.stringify` drops an undefined-valued key, so clearing a rating has to send null; the
    // resolver must read it as inherit rather than as a level. Caught live: without this, setting
    // a world to explicit and then choosing "use the global setting" left it explicit.
    expect(resolveIntimacyLevel(null, 'suggestive')).toBe('suggestive')
  })

  it("treats a world's explicit 'default' as a pin, not as inherit", () => {
    // Distinct from `undefined`: this world sends no instruction even as the global changes.
    expect(resolveIntimacyLevel('default', 'explicit')).toBe('default')
  })
})
