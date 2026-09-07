import { describe, expect, it } from 'vitest'
import { detectPersonaAgencyViolation } from './agencyGuard'

describe('detectPersonaAgencyViolation — climax (original, narrower check)', () => {
  it('catches the name as subject, shortly before "reached his/her/their climax"', () => {
    expect(detectPersonaAgencyViolation('Kai', 'Kai reached his climax with a groan.')).toBeTruthy()
    expect(detectPersonaAgencyViolation('Kai', 'Kai finally reached his own climax.')).toBeTruthy()
  })

  it('catches the direct possessive shape, "{Name}\'s own climax/orgasm/release"', () => {
    expect(detectPersonaAgencyViolation('Kai', "Kai's own orgasm rolled through him a moment later.")).toBeTruthy()
    expect(detectPersonaAgencyViolation('Kai', "Kai's own release came a breath after hers.")).toBeTruthy()
  })

  it('catches the bare verb form, "{Name} orgasmed"', () => {
    expect(detectPersonaAgencyViolation('Kai', 'Kai orgasmed before he could say anything.')).toBeTruthy()
  })

  it('returns the actual offending sentence, not just true/false, so a UI badge can quote it', () => {
    const reply = 'Sumire pulled him closer. Kai reached his own climax with a shudder. She held on.'
    expect(detectPersonaAgencyViolation('Kai', reply)).toBe('Kai reached his own climax with a shudder.')
  })

  it("does NOT flag the CHARACTER's own climax in a sentence that never mentions the persona", () => {
    expect(detectPersonaAgencyViolation('Kai', 'Sumire reached her own climax, gasping his name.')).toBeUndefined()
  })

  it("does NOT flag the persona's name appearing in an unrelated sentence, even if the character's own climax is narrated elsewhere in the same reply", () => {
    const reply = "Kai held her steady through it. Sumire's climax crashed through her a moment later."
    expect(detectPersonaAgencyViolation('Kai', reply)).toBeUndefined()
  })

  it("does NOT flag the character's own climax even when the persona is ALSO named earlier in the very same sentence via an unrelated possessive", () => {
    expect(detectPersonaAgencyViolation('Kai', "Sumire, still holding Kai's hand, reached her own climax with a gasp.")).toBeUndefined()
  })

  it('does not flag ordinary common words that could be climax euphemisms in other contexts without an explicit phrase', () => {
    expect(detectPersonaAgencyViolation('Kai', 'Kai came into the room and shuddered at the cold.')).toBeUndefined()
    expect(detectPersonaAgencyViolation('Kai', 'Kai finished his coffee before she noticed.')).toBeUndefined()
  })

  it('does not flag the deliberately-excluded ambiguous phrase "came undone" (often just emotional, not climax)', () => {
    expect(detectPersonaAgencyViolation('Kai', 'Kai came undone, tears finally falling.')).toBeUndefined()
  })

  it('is case-insensitive and matches the name as a whole word only (not as a prefix of a longer name)', () => {
    expect(detectPersonaAgencyViolation('kai', 'KAI reached his climax first.')).toBeTruthy()
    expect(detectPersonaAgencyViolation('Kai', 'Kaito reached his climax first.')).toBeUndefined()
  })

  it('returns undefined for empty inputs', () => {
    expect(detectPersonaAgencyViolation('', 'Kai reached his climax.')).toBeUndefined()
    expect(detectPersonaAgencyViolation('Kai', '')).toBeUndefined()
  })
})

describe('detectPersonaAgencyViolation — feeling/thought/realization (broadened)', () => {
  it('catches the name directly before a feeling/thought/realization verb', () => {
    expect(detectPersonaAgencyViolation('Kai', 'Kai felt a rush of relief.')).toBeTruthy()
    expect(detectPersonaAgencyViolation('Kai', 'Kai realized the door was locked.')).toBeTruthy()
    expect(detectPersonaAgencyViolation('Kai', 'Kai thought about it for a long moment.')).toBeTruthy()
    expect(detectPersonaAgencyViolation('Kai', 'Kai wondered if she meant it.')).toBeTruthy()
    expect(detectPersonaAgencyViolation('Kai', 'Kai knew this was a mistake.')).toBeTruthy()
    expect(detectPersonaAgencyViolation('Kai', 'Kai remembered the promise too late.')).toBeTruthy()
  })

  it('catches the name plus a single adverb before the verb', () => {
    expect(detectPersonaAgencyViolation('Kai', 'Kai suddenly realized the door was locked.')).toBeTruthy()
  })

  it("does NOT flag {{char}}'s own internal state in a sentence that never mentions the persona as subject", () => {
    expect(detectPersonaAgencyViolation('Kai', 'Sumire felt a rush of relief.')).toBeUndefined()
  })

  it('does NOT flag the persona as merely the object of a preposition immediately before the verb', () => {
    // The exact collision this was designed to avoid: "Kai" precedes the verb, but only as the
    // object of "to" — the subject of "felt" is really "she", carried over from the main clause.
    expect(detectPersonaAgencyViolation('Kai', 'She turned to Kai and felt a wave of relief.')).toBeUndefined()
    expect(detectPersonaAgencyViolation('Kai', 'Sumire looked at Kai and wondered what he was thinking.')).toBeUndefined()
  })
})

describe('detectPersonaAgencyViolation — involuntary physical reaction (broadened)', () => {
  it('catches the name directly before an involuntary-reaction verb', () => {
    expect(detectPersonaAgencyViolation('Kai', 'Kai shivered at the touch.')).toBeTruthy()
    expect(detectPersonaAgencyViolation('Kai', 'Kai gasped, caught off guard.')).toBeTruthy()
    expect(detectPersonaAgencyViolation('Kai', 'Kai tensed, unsure what to do.')).toBeTruthy()
  })

  it('does NOT flag ordinary social actions like smiling, nodding, or laughing — too common and low-severity to be worth the noise', () => {
    expect(detectPersonaAgencyViolation('Kai', 'Kai smiled and nodded.')).toBeUndefined()
    expect(detectPersonaAgencyViolation('Kai', 'Kai laughed at the joke.')).toBeUndefined()
  })

  it("does NOT flag a possessive body-part construction — an accepted miss, not a false positive risk", () => {
    expect(detectPersonaAgencyViolation('Kai', "Kai's hand trembled as she held it.")).toBeUndefined()
  })
})

describe('detectPersonaAgencyViolation — shared guarantees across both old and new patterns', () => {
  it('is case-insensitive and matches the name as a whole word only', () => {
    expect(detectPersonaAgencyViolation('kai', 'KAI felt a rush of relief.')).toBeTruthy()
    expect(detectPersonaAgencyViolation('Kai', 'Kaito felt a rush of relief.')).toBeUndefined()
  })

  it('returns undefined for empty inputs', () => {
    expect(detectPersonaAgencyViolation('', 'Kai felt something.')).toBeUndefined()
    expect(detectPersonaAgencyViolation('Kai', '')).toBeUndefined()
  })
})
