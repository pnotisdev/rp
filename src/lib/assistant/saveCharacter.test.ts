import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { generatedToCharacterInput } from './saveCharacter'
import type { GeneratedCharacter } from './thread'

// This mapping is the one place a generated character can lose half of itself without anything failing, so every stage it flattens is pinned here.

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
  extras: {
    socialConnections: [{ id: 'c1', name: 'Oren', relation: 'old friend' }],
    behavioralRules: [{ id: 'r1', kind: 'never', then: 'lies about the grove' }],
    voiceFingerprint: { verbalTics: ['hm.'] },
    sfxWords: ['hmph'],
    giftPreferences: { 'silver-pendant': 3 },
    schedule: [{ id: 's1', phase: 'night', status: 'sleeping', activity: 'Sleeping in the oak' }],
    birthday: 30,
    outreach: { frequency: 'rare' },
    drive: { enabled: false, chaosBase: 0.1, energyBase: 5, fixations: ['moss'], loves: [], boredBy: [] },
    touchProfile: { sensitivity: { ears: 3 } },
    kinkProfile: { valence: { praise: 2 }, hardLimits: ['anal'] },
    explicitVoiceNote: 'Goes quieter.',
  },
})

describe('generatedToCharacterInput', () => {
  it('carries the card through', () => {
    const input = generatedToCharacterInput(full())
    expect(input.card.name).toBe('Lirael')
  })

  it('nests the lorebook inside the card, where the editor puts it', () => {
    const input = generatedToCharacterInput(full())
    expect(input.card.character_book).toBeDefined()
    // Not a sibling field — a top-level `characterBook` would be silently ignored on create.
    expect('characterBook' in input).toBe(false)
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

  it('flattens the bonds, with weather under the one key the server reads', () => {
    const input = generatedToCharacterInput(full())
    expect(input.giftLikes).toEqual(['seeds'])
    expect(input.giftDislikes).toEqual(['iron'])
    expect(input.weatherPreferences).toEqual({ loves: ['rain'], hates: ['storm'] })
    expect('weatherLoves' in input).toBe(false)
    expect(input.relationshipStarters).toHaveLength(1)
  })

  it('carries the wardrobe', () => {
    expect(generatedToCharacterInput(full()).outfits).toHaveLength(1)
  })

  it('spreads the extra sections onto the character', () => {
    const input = generatedToCharacterInput(full())
    expect(input.socialConnections?.[0].name).toBe('Oren')
    expect(input.behavioralRules?.[0].kind).toBe('never')
    expect(input.voiceFingerprint).toEqual({ verbalTics: ['hm.'] })
    expect(input.sfxWords).toEqual(['hmph'])
    expect(input.giftPreferences).toEqual({ 'silver-pendant': 3 })
    expect(input.schedule?.[0].phase).toBe('night')
    expect(input.birthday).toBe(30)
    expect(input.outreach).toEqual({ frequency: 'rare' })
    expect(input.drive?.enabled).toBe(false)
    expect(input.touchProfile).toEqual({ sensitivity: { ears: 3 } })
    expect(input.kinkProfile?.hardLimits).toEqual(['anal'])
    expect(input.explicitVoiceNote).toBe('Goes quieter.')
  })

  it('omits a stage that failed rather than writing empty fields over nothing', () => {
    const input = generatedToCharacterInput({ card, profile: null, bonds: null, outfits: null, characterBook: null })
    expect(input.occupation).toBeUndefined()
    expect(input.giftLikes).toBeUndefined()
    expect(input.outfits).toBeUndefined()
    expect(input.card.character_book).toBeUndefined()
  })

  it('omits an empty wardrobe rather than saving an empty array over a default', () => {
    expect(generatedToCharacterInput({ card, outfits: [] }).outfits).toBeUndefined()
  })

  it('omits weather when the bonds named none', () => {
    const bonds = { ...full().bonds!, weatherLoves: [], weatherHates: [] }
    expect('weatherPreferences' in generatedToCharacterInput({ card, bonds })).toBe(false)
  })

  it('works from a card alone, which is what "just the card" produces', () => {
    const input = generatedToCharacterInput({ card })
    expect(input.card).toBe(card)
    expect(Object.keys(input)).toEqual(['card'])
  })

  it('only emits keys the server reads when it creates a character', () => {
    const source = fs.readFileSync('server/app.ts', 'utf8')
    const start = source.indexOf("app.post('/api/characters'")
    const handler = source.slice(start, source.indexOf("app.put('/api/characters/:id'"))
    const read = new Set([...handler.matchAll(/req\.body\.(\w+)/g)].map((m) => m[1]))
    // A scrape that matched nothing would pass vacuously.
    expect(read.size).toBeGreaterThan(20)
    const emitted = Object.keys(generatedToCharacterInput(full()))
    expect(emitted.filter((key) => !read.has(key))).toEqual([])
  })
})
