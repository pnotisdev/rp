import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Character } from '@/lib/characters/cardSpec'
import { OPTIONAL_STAGES } from '@/lib/characters/generateFullCharacter'
import { SECTION_KEYS, characterToDraft, describeValues, patchBody, sectionValues } from './characterSections'
import { generatedToCharacterInput } from './saveCharacter'

const saved = {
  id: 'c1',
  card: { name: 'Lirael', description: 'd', personality: 'p', scenario: 's', first_mes: 'hi', mes_example: '', alternate_greetings: ['a', 'b'] },
  occupation: 'hedge-witch',
  likes: ['moss'],
  giftLikes: ['seeds'],
  weatherPreferences: { loves: ['rain'], hates: ['storm'] },
  schedule: [{ id: 's1', phase: 'night', status: 'sleeping', activity: 'Asleep' }],
  drive: { enabled: true, chaosBase: 0.1, energyBase: 5, fixations: [], loves: [], boredBy: [] },
} as unknown as Character

describe('SECTION_KEYS', () => {
  it('covers every optional stage', () => {
    expect(Object.keys(SECTION_KEYS).sort()).toEqual([...OPTIONAL_STAGES].sort())
  })

  it('names only keys the server reads on update, and no key twice', () => {
    const source = fs.readFileSync('server/app.ts', 'utf8')
    const handler = source.slice(source.indexOf("app.put('/api/characters/:id'"), source.indexOf("app.delete('/api/characters/:id'"))
    const read = new Set([...handler.matchAll(/'(\w+)' in req\.body/g)].map((m) => m[1]))
    expect(read.size).toBeGreaterThan(20)
    const all = Object.values(SECTION_KEYS).flat()
    expect(new Set(all).size).toBe(all.length)
    expect(all.filter((k) => !k.startsWith('card.') && !read.has(k))).toEqual([])
  })

  it('matches what the draft mapping emits for each stage', () => {
    const emitted = Object.keys(generatedToCharacterInput(characterToDraft(saved)))
    for (const key of emitted) expect(key === 'card' || Object.values(SECTION_KEYS).flat().includes(key)).toBe(true)
  })
})

describe('characterToDraft', () => {
  it('rebuilds the sections the stages read from the stored fields', () => {
    const draft = characterToDraft(saved, 'make her shy')
    expect(draft.profile).toMatchObject({ occupation: 'hedge-witch', likes: ['moss'], workplace: '' })
    expect(draft.bonds).toMatchObject({ giftLikes: ['seeds'], weatherLoves: ['rain'], weatherHates: ['storm'] })
    expect(draft.extras?.schedule).toHaveLength(1)
    expect(draft.brief).toBe('make her shy')
  })

  it('leaves out a section the character does not have', () => {
    const draft = characterToDraft({ id: 'c2', card: saved.card } as Character)
    expect(draft.profile).toBeUndefined()
    expect(draft.bonds).toBeUndefined()
    expect(draft.extras).toEqual({})
  })
})

describe('sectionValues and patchBody', () => {
  it('reads a plain section, with missing fields as null', () => {
    expect(sectionValues('profile', saved)).toMatchObject({ occupation: 'hedge-witch', workplace: null, likes: ['moss'] })
  })

  it('reads a card field by its dotted key and writes it back into the current card', () => {
    const before = sectionValues('greetings', saved)
    expect(before).toEqual({ 'card.alternate_greetings': ['a', 'b'] })
    const moved = { ...saved, card: { ...saved.card, personality: 'changed since' } } as Character
    expect(patchBody(moved, { 'card.alternate_greetings': ['z'], occupation: null })).toEqual({
      occupation: null,
      card: { ...moved.card, alternate_greetings: ['z'] },
    })
  })

  it('puts back exactly what was there, so a revert is the identity', () => {
    const before = sectionValues('worldsim', saved)
    expect(before).toEqual({ schedule: saved.schedule, birthday: null, outreach: null })
    expect(patchBody(saved, before)).toEqual(before)
  })
})

describe('describeValues', () => {
  it('shows empty fields as empty and clips long text', () => {
    expect(describeValues({ occupation: null, 'card.alternate_greetings': ['a'] })).toBe('occupation: (empty)\nalternate_greetings: ["a"]')
    expect(describeValues({ x: 'y'.repeat(2000) }, 50)).toHaveLength(53)
  })
})
