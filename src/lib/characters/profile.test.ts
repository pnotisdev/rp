import { describe, expect, it } from 'vitest'
import { buildCharacterProfileNote } from './profile'
import { blankCharacterData, type Character } from './cardSpec'

function character(overrides: Partial<Character> = {}): Character {
  return {
    id: 'c1',
    card: blankCharacterData('Test'),
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('buildCharacterProfileNote', () => {
  it('returns undefined when nothing is set', () => {
    expect(buildCharacterProfileNote(character())).toBeUndefined()
  })

  it('folds occupation and workplace into one line', () => {
    const note = buildCharacterProfileNote(character({ occupation: 'barista', workplace: 'Sakura Hill Cafe' }))
    expect(note).toContain('Works as barista at Sakura Hill Cafe')
  })

  it('lists boundaries in full, uncapped, regardless of count', () => {
    const boundaries = Array.from({ length: 20 }, (_, i) => `Limit ${i}`)
    const note = buildCharacterProfileNote(character({ boundaries }))
    for (const b of boundaries) expect(note).toContain(b)
  })

  it('caps likes to the first 8 rather than growing without bound', () => {
    const likes = Array.from({ length: 20 }, (_, i) => `Like ${i}`)
    const note = buildCharacterProfileNote(character({ likes }))
    expect(note).toContain('Like 0')
    expect(note).toContain('Like 7')
    expect(note).not.toContain('Like 8')
    expect(note).not.toContain('Like 19')
  })

  it('caps goals to the first 5', () => {
    const goals = Array.from({ length: 10 }, (_, i) => `Goal ${i}`)
    const note = buildCharacterProfileNote(character({ goals }))
    expect(note).toContain('Goal 4')
    expect(note).not.toContain('Goal 5')
  })

  it('caps frequented locations to the first 5', () => {
    const frequentedLocations = Array.from({ length: 10 }, (_, i) => `Spot ${i}`)
    const note = buildCharacterProfileNote(character({ frequentedLocations }))
    expect(note).toContain('Spot 4')
    expect(note).not.toContain('Spot 5')
  })

  it('caps social connections to the first 6', () => {
    const socialConnections = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: `Person ${i}`, relation: 'friend' }))
    const note = buildCharacterProfileNote(character({ socialConnections }))
    expect(note).toContain('Person 5')
    expect(note).not.toContain('Person 6')
  })

  it('folds an authored voice fingerprint in as its own sentence, not merged into life context', () => {
    const note = buildCharacterProfileNote(
      character({
        occupation: 'barista',
        voiceFingerprint: { verbalTics: ['well', 'you know'], catchphrases: ["it's not like i"] },
      }),
    )
    expect(note).toContain('Works as barista')
    expect(note).toContain('Speech patterns to stay consistent with')
    expect(note).toContain('"well"')
    expect(note).toContain('"you know"')
    expect(note).toContain(`"it's not like i"`)
  })

  it('includes dialect notes and sentence rhythm when authored', () => {
    const note = buildCharacterProfileNote(
      character({
        voiceFingerprint: { dialectNotes: 'clipped, never contracts a verb', sentenceRhythm: 'Short, clipped sentences.' },
      }),
    )
    expect(note).toContain('clipped, never contracts a verb')
    expect(note).toContain('Short, clipped sentences.')
  })

  it('caps verbal tics and catchphrases in the note rather than growing without bound', () => {
    const verbalTics = Array.from({ length: 10 }, (_, i) => `tic${i}`)
    const catchphrases = Array.from({ length: 10 }, (_, i) => `phrase ${i}`)
    const note = buildCharacterProfileNote(character({ voiceFingerprint: { verbalTics, catchphrases } }))
    expect(note).toContain('"tic5"')
    expect(note).not.toContain('"tic6"')
    expect(note).toContain('"phrase 4"')
    expect(note).not.toContain('"phrase 5"')
  })

  it('returns undefined for an empty voice fingerprint object with nothing set', () => {
    expect(buildCharacterProfileNote(character({ voiceFingerprint: {} }))).toBeUndefined()
  })

  it('still returns a note when only the voice fingerprint is set, with no life-context fields at all', () => {
    const note = buildCharacterProfileNote(character({ voiceFingerprint: { dialectNotes: 'blunt, one-word answers' } }))
    expect(note).toBe('Speech patterns to stay consistent with, every turn: dialect/register: blunt, one-word answers.')
  })
})
