import { describe, expect, it } from 'vitest'
import { detectPersonaClimaxNarration } from './agencyGuard'

describe('detectPersonaClimaxNarration', () => {
  it('catches the name as subject, shortly before "reached his/her/their climax"', () => {
    expect(detectPersonaClimaxNarration('Kai', 'Kai reached his climax with a groan.')).toBeTruthy()
    expect(detectPersonaClimaxNarration('Kai', 'Kai finally reached his own climax.')).toBeTruthy()
  })

  it('catches the direct possessive shape, "{Name}\'s own climax/orgasm/release"', () => {
    expect(detectPersonaClimaxNarration('Kai', "Kai's own orgasm rolled through him a moment later.")).toBeTruthy()
    expect(detectPersonaClimaxNarration('Kai', "Kai's own release came a breath after hers.")).toBeTruthy()
  })

  it('catches the bare verb form, "{Name} orgasmed"', () => {
    expect(detectPersonaClimaxNarration('Kai', 'Kai orgasmed before he could say anything.')).toBeTruthy()
  })

  it('returns the actual offending sentence, not just true/false, so a UI badge can quote it', () => {
    const reply = 'Sumire pulled him closer. Kai reached his own climax with a shudder. She held on.'
    expect(detectPersonaClimaxNarration('Kai', reply)).toBe('Kai reached his own climax with a shudder.')
  })

  it("does NOT flag the CHARACTER's own climax in a sentence that never mentions the persona", () => {
    expect(detectPersonaClimaxNarration('Kai', 'Sumire reached her own climax, gasping his name.')).toBeUndefined()
  })

  it("does NOT flag the persona's name appearing in an unrelated sentence, even if the character's own climax is narrated elsewhere in the same reply", () => {
    const reply = "Kai held her steady through it. Sumire's climax crashed through her a moment later."
    expect(detectPersonaClimaxNarration('Kai', reply)).toBeUndefined()
  })

  it("does NOT flag the character's own climax even when the persona is ALSO named earlier in the very same sentence via an unrelated possessive", () => {
    // The exact false-positive shape this was rewritten to avoid: "Kai's" appears, but only as an
    // unrelated possessive ("Kai's hand") several words before a climax that's plainly Sumire's own.
    expect(detectPersonaClimaxNarration('Kai', "Sumire, still holding Kai's hand, reached her own climax with a gasp.")).toBeUndefined()
  })

  it('does not flag ordinary common words that could be climax euphemisms in other contexts ("came", "finished", "shuddered") without an explicit phrase', () => {
    expect(detectPersonaClimaxNarration('Kai', 'Kai came into the room and shuddered at the cold.')).toBeUndefined()
    expect(detectPersonaClimaxNarration('Kai', 'Kai finished his coffee before she noticed.')).toBeUndefined()
  })

  it('does not flag the deliberately-excluded ambiguous phrase "came undone" (often just emotional, not climax)', () => {
    expect(detectPersonaClimaxNarration('Kai', 'Kai came undone, tears finally falling.')).toBeUndefined()
  })

  it('is case-insensitive and matches the name as a whole word only (not as a prefix of a longer name)', () => {
    expect(detectPersonaClimaxNarration('kai', 'KAI reached his climax first.')).toBeTruthy()
    expect(detectPersonaClimaxNarration('Kai', 'Kaito reached his climax first.')).toBeUndefined()
  })

  it('returns undefined for empty inputs', () => {
    expect(detectPersonaClimaxNarration('', 'Kai reached his climax.')).toBeUndefined()
    expect(detectPersonaClimaxNarration('Kai', '')).toBeUndefined()
  })
})
