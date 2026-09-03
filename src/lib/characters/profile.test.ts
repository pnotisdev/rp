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
})
