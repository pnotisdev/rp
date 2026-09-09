import { describe, expect, it } from 'vitest'
import { generatedToCharacterInput } from './saveCharacter'
import type { GeneratedCharacter } from './thread'

// This mapping is the one place a generated character can lose half of itself without anything
// failing, so every stage it flattens is pinned here. It mirrors `CharacterEditor`'s own
// `onGenerated` handler — if that gains a field, these break.

const card = {
  name: 'Lirael',
  description: 'A 3000 year old elf with white hair, in a sundress.',
  personality: 'Unhurried, dry, ancient.',
  scenario: 'A grove at dusk.',
  first_mes: 'You are late.',
  mes_example: '',
} as GeneratedCharacter['card']

const full = (): GeneratedCharacter => ({
  card,
  profile: {
    occupation: 'hedge-witch',
    workplace: 'the grove',
    homeLocation: 'a hollow oak',
    frequentedLocations: ['the grove', 'the river'],
    likes: ['moss', 'silence'],
    goals: ['keep the grove'],
    boundaries: ['will not enter cities'],
    loveLanguage: 'small acts of tending',
  } as GeneratedCharacter['profile'],
  bonds: {
    giftLikes: ['seeds'],
    giftDislikes: ['iron'],
    weatherLoves: ['rain'],
    weatherHates: ['storm'],
    relationshipStarters: [{ label: 'Traveller', blurb: 'You wandered in.' }],
  } as GeneratedCharacter['bonds'],
  outfits: [{ id: 'sundress', label: 'Sundress' }] as GeneratedCharacter['outfits'],
  characterBook: { entries: [{ id: 1, keys: ['grove'], content: 'The grove remembers.' }] } as GeneratedCharacter['characterBook'],
})

describe('generatedToCharacterInput', () => {
  it('carries the card through', () => {
    const input = generatedToCharacterInput(full())
    expect((input.card as { name: string }).name).toBe('Lirael')
  })

  it('nests the lorebook inside the card, where the editor puts it', () => {
    const input = generatedToCharacterInput(full())
    expect((input.card as { character_book?: unknown }).character_book).toBeDefined()
    // Not a sibling field — a top-level `characterBook` would be silently ignored on create.
    expect(input.characterBook).toBeUndefined()
  })

  it('flattens every profile field to the top level', () => {
    const input = generatedToCharacterInput(full())
    expect(input.occupation).toBe('hedge-witch')
    expect(input.workplace).toBe('the grove')
    expect(input.homeLocation).toBe('a hollow oak')
    expect(input.frequentedLocations).toEqual(['the grove', 'the river'])
    expect(input.likes).toEqual(['moss', 'silence'])
    expect(input.goals).toEqual(['keep the grove'])
    expect(input.boundaries).toEqual(['will not enter cities'])
    expect(input.loveLanguage).toBe('small acts of tending')
  })

  it('flattens every bonds field to the top level', () => {
    const input = generatedToCharacterInput(full())
    expect(input.giftLikes).toEqual(['seeds'])
    expect(input.giftDislikes).toEqual(['iron'])
    expect(input.weatherLoves).toEqual(['rain'])
    expect(input.weatherHates).toEqual(['storm'])
    expect(input.relationshipStarters).toHaveLength(1)
  })

  it('carries the wardrobe', () => {
    expect(generatedToCharacterInput(full()).outfits).toHaveLength(1)
  })

  it('omits a stage that failed rather than writing empty fields over nothing', () => {
    const input = generatedToCharacterInput({ card, profile: null, bonds: null, outfits: null, characterBook: null })
    expect(input.occupation).toBeUndefined()
    expect(input.giftLikes).toBeUndefined()
    expect(input.outfits).toBeUndefined()
    expect((input.card as { character_book?: unknown }).character_book).toBeUndefined()
  })

  it('omits an empty wardrobe rather than saving an empty array over a default', () => {
    expect(generatedToCharacterInput({ card, outfits: [] }).outfits).toBeUndefined()
  })

  it('works from a card alone, which is what "just the card" produces', () => {
    const input = generatedToCharacterInput({ card })
    expect(input.card).toBe(card)
    expect(Object.keys(input)).toEqual(['card'])
  })
})
