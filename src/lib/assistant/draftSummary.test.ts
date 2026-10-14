import { describe, expect, it } from 'vitest'
import { describeDraft } from './draftSummary'
import type { GeneratedCharacter } from './thread'

const card = { name: 'Mira', description: 'x', personality: 'y', scenario: 'z', first_mes: 'hi', mes_example: '', alternate_greetings: ['*Rain.* "Hello."'] } as GeneratedCharacter['card']
const section = (draft: GeneratedCharacter, stage: string) => describeDraft(draft).find((s) => s.stage === stage)!

describe('describeDraft', () => {
  it('lists every build stage, in order, even when nothing came back', () => {
    const sections = describeDraft({ card: { ...card, alternate_greetings: [] } })
    expect(sections.map((s) => s.stage)).toEqual(['greetings', 'profile', 'bonds', 'social', 'voice', 'gifts', 'worldsim', 'drive', 'intimacy', 'outfits', 'lore'])
    expect(sections.every((s) => s.rows.length === 0)).toBe(true)
  })

  it('reads the greetings off the card', () => {
    expect(section({ card }, 'greetings').rows).toEqual([{ label: 'Greeting 1', value: '*Rain.* "Hello."' }])
  })

  it('names gifts and signs their scores, falling back to the id for a gift outside the default catalog', () => {
    const rows = section({ card, extras: { giftPreferences: { 'favorite-novel': 3, 'flower-bouquet': -1, 'world-gift': 2 } } }, 'gifts').rows
    expect(rows).toEqual([
      { label: 'Favorites', value: 'Favorite Novel (+3), world-gift (+2)' },
      { label: 'Dislikes', value: 'Flower Bouquet (-1)' },
    ])
  })

  it('turns the routine into readable lines and decodes the birthday', () => {
    const rows = section(
      {
        card,
        extras: {
          schedule: [
            { id: 'a', phase: 'morning', status: 'busy', activity: 'Teaching', location: 'The lab' },
            { id: 'b', phase: 'evening', status: 'available', activity: 'Reading', days: ['saturday', 'sunday'] },
          ],
          birthday: 58,
          outreach: { frequency: 'rare' },
        },
      },
      'worldsim',
    ).rows
    expect(rows).toEqual([
      { label: 'Morning', value: 'busy: Teaching, The lab' },
      { label: 'Evening (sat, sun)', value: 'available: Reading' },
      { label: 'Birthday', value: 'Autumn 3' },
      { label: 'Texts first', value: 'rare' },
    ])
  })

  it('shows connections and both kinds of rule', () => {
    const rows = section(
      {
        card,
        extras: {
          socialConnections: [{ id: 'c', name: 'Oren', relation: 'brother', notes: 'Calls on Sundays.' }],
          behavioralRules: [
            { id: 'r1', kind: 'when_then', when: 'someone is rude', then: 'goes quiet' },
            { id: 'r2', kind: 'never', then: 'lies' },
          ],
        },
      },
      'social',
    ).rows
    expect(rows).toEqual([
      { label: 'Oren', value: 'brother. Calls on Sundays.' },
      { label: 'When', value: 'someone is rude: goes quiet' },
      { label: 'Never', value: 'lies' },
    ])
  })

  it('says the persona engine is off and lists its dials and topics', () => {
    const drive = { enabled: false, chaosBase: 0.12, energyBase: 6, fixations: ['the fridge'], loves: ['horror'], boredBy: [], motifs: ['Anyway'] }
    expect(section({ card, extras: { drive } }, 'drive').rows).toEqual([
      { label: 'Engine', value: 'Off. Switch it on in World sim.' },
      { label: 'Chaos', value: '12%' },
      { label: 'Resting energy', value: '6 of 10' },
      { label: 'Fixations', value: 'the fridge' },
      { label: 'Loves', value: 'horror' },
      { label: 'Bits', value: 'Anyway' },
    ])
  })

  it('reads the intimacy settings back as words', () => {
    const rows = section(
      {
        card,
        extras: {
          touchProfile: { sensitivity: { neck: 3, inner_thigh: 3, feet: 0 }, offLimits: ['hands'] },
          kinkProfile: { valence: { dirty_talk: 2, rough: -1 }, hardLimits: ['bodily_fluids'] },
          explicitVoiceNote: 'Goes quieter.',
        },
      },
      'intimacy',
    ).rows
    expect(rows).toEqual([
      { label: 'Sensitive', value: 'neck, inner thigh' },
      { label: 'Unresponsive', value: 'feet' },
      { label: 'Off limits', value: 'hands' },
      { label: 'Likes', value: 'dirty talk' },
      { label: 'Dislikes', value: 'rough' },
      { label: 'Hard limits', value: 'bodily fluids' },
      { label: 'Voice under strain', value: 'Goes quieter.' },
    ])
  })

  it('leaves out empty values so a stage that returned blanks reads as empty', () => {
    const profile = { occupation: '', workplace: ' ', homeLocation: 'a flat', frequentedLocations: [], likes: [], goals: [], boundaries: [], loveLanguage: '' }
    expect(section({ card, profile }, 'profile').rows).toEqual([{ label: 'Home', value: 'a flat' }])
  })
})
