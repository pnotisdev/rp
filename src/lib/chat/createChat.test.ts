import { describe, expect, it } from 'vitest'
import { availableGreetings } from './createChat'
import type { Character, CharacterCardData } from '@/lib/characters/cardSpec'

function character(overrides: Partial<CharacterCardData> = {}): Character {
  return {
    id: 'char-1',
    createdAt: 0,
    updatedAt: 0,
    card: {
      name: 'Aria',
      description: '',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      ...overrides,
    },
  }
}

describe('availableGreetings', () => {
  it('returns just first_mes when there are no alternates', () => {
    expect(availableGreetings(character({ first_mes: 'Hello there.' }))).toEqual(['Hello there.'])
  })

  it('includes ungated alternate greetings after first_mes, in card order', () => {
    const result = availableGreetings(
      character({ first_mes: 'Hi!', alternate_greetings: ['Alt one.', 'Alt two.'] }),
    )
    expect(result).toEqual(['Hi!', 'Alt one.', 'Alt two.'])
  })

  it('strips an affection gate prefix and excludes anything gated above 0', () => {
    const result = availableGreetings(
      character({ first_mes: 'Hi!', alternate_greetings: ['[affection>=40] A closer greeting.', 'Ungated one.'] }),
    )
    expect(result).toEqual(['Hi!', 'Ungated one.'])
  })

  it('includes a [affection>=0] gated line since it is reachable from the very start', () => {
    const result = availableGreetings(character({ first_mes: '[affection>=0] Still day one.' }))
    expect(result).toEqual(['Still day one.'])
  })

  it('drops blank/whitespace-only entries', () => {
    const result = availableGreetings(character({ first_mes: '  ', alternate_greetings: ['', '   ', 'Real one.'] }))
    expect(result).toEqual(['Real one.'])
  })

  it('returns an empty array when the card has no greetings at all', () => {
    expect(availableGreetings(character())).toEqual([])
  })
})
