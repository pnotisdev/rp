import { describe, expect, it, vi } from 'vitest'
import { draftFullCharacter, isAbortError, type FullCharacterStage, type StageStatus } from './generateFullCharacter'
import type { ChatBackend } from '@/lib/api/chatBackend'

const CARD_JSON = JSON.stringify({
  name: 'Mira',
  description: 'A tall woman with short silver hair.',
  personality: 'Blunt, curious.',
  scenario: 'A university lab.',
  first_mes: '"You touched my equipment."',
  mes_example: '{{user}}: Hi.\n{{char}}: "Hi" is not a hypothesis.',
  tags: ['scientist'],
})
const PROFILE_JSON = JSON.stringify({
  occupation: 'researcher',
  workplace: 'the biology department',
  homeLocation: 'a small flat',
  frequentedLocations: ['the greenhouse', 'a diner'],
  likes: ['taxonomy', 'cold coffee'],
  goals: ['publish the survey'],
  boundaries: ['no one touches her samples'],
  loveLanguage: 'She notices the small things.',
})
const BONDS_JSON = JSON.stringify({
  giftLikes: ['field guides'],
  giftDislikes: ['perfume'],
  weatherLoves: ['overcast'],
  weatherHates: ['storm'],
  relationshipStarters: [
    { label: 'Strangers', blurb: 'You and Mira have never spoken.', startingAffection: 0 },
    { label: 'Lab neighbours', blurb: 'You share a bench.', startingAffection: 20 },
    { label: 'Old rivals', blurb: 'You competed for the same grant.', startingAffection: 35 },
  ],
})
const OUTFITS_JSON = JSON.stringify([
  { label: 'Lab coat and jeans', unlockAffection: 0, intimate: false },
  { label: 'Field gear', unlockAffection: 15, intimate: false },
  { label: 'Nothing but the coat', unlockAffection: 70, intimate: true },
])
const LORE_JSON = JSON.stringify([
  { keys: ['the survey', 'wetlands'], content: 'Mira has spent three years on an unfinished wetlands survey.' },
])

/** The full happy-path call sequence, in stage order. */
const ALL = [CARD_JSON, PROFILE_JSON, BONDS_JSON, OUTFITS_JSON, LORE_JSON]

/** Returns each response in order, one per `generate` call. */
function sequenceClient(responses: string[]): ChatBackend {
  let i = 0
  return {
    generate: vi.fn().mockImplementation(async () => responses[Math.min(i++, responses.length - 1)]),
    generateStream: vi.fn(),
    getEffectiveMaxContext: vi.fn().mockResolvedValue(4096),
    tokenCount: vi.fn(),
    abort: vi.fn(),
    getChatTemplate: vi.fn().mockResolvedValue(null),
  }
}

describe('draftFullCharacter', () => {
  it('runs every stage and returns a fully populated draft', async () => {
    const client = sequenceClient(ALL)
    const draft = await draftFullCharacter(client, { brief: 'a blunt scientist' })

    expect(draft.card.name).toBe('Mira')
    expect(draft.profile?.occupation).toBe('researcher')
    expect(draft.bonds?.relationshipStarters).toHaveLength(3)
    expect(draft.outfits?.map((o) => o.label)).toEqual(['Lab coat and jeans', 'Field gear', 'Nothing but the coat'])
    expect(draft.outfits?.[2]).toMatchObject({ intimate: true, manualOnly: true, unlockAffection: 70 })
    expect(draft.characterBook?.entries[0].keys).toContain('wetlands')
    expect(draft.completed).toEqual(['card', 'profile', 'bonds', 'outfits', 'lore'])
    expect(draft.failed).toEqual([])
  })

  it('reports progress start → done for each stage in order', async () => {
    const client = sequenceClient(ALL)
    const events: [FullCharacterStage, StageStatus][] = []
    await draftFullCharacter(client, { brief: 'x' }, { onStage: (s, st) => events.push([s, st]) })
    expect(events).toEqual([
      ['card', 'start'],
      ['card', 'done'],
      ['profile', 'start'],
      ['profile', 'done'],
      ['bonds', 'start'],
      ['bonds', 'done'],
      ['outfits', 'start'],
      ['outfits', 'done'],
      ['lore', 'start'],
      ['lore', 'done'],
    ])
  })

  it('keeps the card when an optional stage fails, recording the failure', async () => {
    const client = sequenceClient([CARD_JSON, 'not json at all', BONDS_JSON, OUTFITS_JSON, LORE_JSON])
    const draft = await draftFullCharacter(client, { brief: 'x' })
    expect(draft.card.name).toBe('Mira')
    expect(draft.profile).toBeNull()
    expect(draft.bonds?.giftLikes).toEqual(['field guides'])
    expect(draft.outfits?.[0].label).toBe('Lab coat and jeans')
    expect(draft.completed).toEqual(['card', 'bonds', 'outfits', 'lore'])
    expect(draft.failed).toEqual([{ stage: 'profile', error: expect.stringMatching(/JSON object/) }])
  })

  it('fails the whole run when the card stage fails', async () => {
    const client = sequenceClient(['garbage'])
    await expect(draftFullCharacter(client, { brief: 'x' })).rejects.toThrow()
  })

  it('only runs the optional stages it is asked for', async () => {
    const client = sequenceClient([CARD_JSON, OUTFITS_JSON])
    const draft = await draftFullCharacter(client, { brief: 'x' }, { stages: ['outfits'] })
    expect(draft.completed).toEqual(['card', 'outfits'])
    expect(draft.profile).toBeNull()
    expect(draft.bonds).toBeNull()
    expect(draft.characterBook).toBeNull()
    expect(draft.outfits).toHaveLength(3)
    expect((client.generate as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
  })

  it('uses the portrait path when a portrait is supplied', async () => {
    const client = sequenceClient(ALL)
    await draftFullCharacter(client, { portraitBase64: 'B64', brief: 'extra hint' })
    expect((client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0].images).toEqual(['B64'])
  })

  it('threads the writing-style setting into every prose stage', async () => {
    const client = sequenceClient(ALL)
    await draftFullCharacter(client, { brief: 'x', styleGuidance: 'Terse. STYLE_MARKER.' })
    const prompts = (client.generate as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].prompt as string)
    // card, profile, bonds — outfits/lore are label/fact stages and deliberately skip it
    expect(prompts.slice(0, 3).every((p) => p.includes('STYLE_MARKER'))).toBe(true)
  })

  it('stops before the next stage when the signal is already aborted', async () => {
    const client = sequenceClient(ALL)
    const controller = new AbortController()
    const onStage = vi.fn((stage: FullCharacterStage, status: StageStatus) => {
      if (stage === 'card' && status === 'done') controller.abort()
    })
    const err = await draftFullCharacter(client, { brief: 'x' }, { signal: controller.signal, onStage }).catch((e) => e)
    expect(isAbortError(err)).toBe(true)
    expect(onStage).not.toHaveBeenCalledWith('profile', 'start')
  })
})
