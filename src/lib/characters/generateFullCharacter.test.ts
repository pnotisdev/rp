import { describe, expect, it, vi } from 'vitest'
import { draftFullCharacter, isAbortError, runDraftStage, type DraftSections, type FullCharacterStage, type StageStatus } from './generateFullCharacter'
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
const GREETINGS_JSON = JSON.stringify({ greetings: ['*Mira looks up from the microscope.* "You are early."', '*Rain on the greenhouse roof.* "Come in or leave."'] })
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
const SOCIAL_JSON = JSON.stringify({
  socialConnections: [{ name: 'Oren', relation: 'older brother', notes: 'Calls on Sundays.' }],
  behavioralRules: [{ kind: 'never', when: '', then: 'lets a sample go unlabelled' }],
})
const VOICE_JSON = JSON.stringify({ verbalTics: ['hm.'], catchphrases: [], dialectNotes: 'Precise and dry.', sentenceRhythm: 'Short.', sfxWords: ['tch'] })
const GIFTS_JSON = JSON.stringify({ 'flower-bouquet': -1, 'favorite-novel': 3 })
const WORLDSIM_JSON = JSON.stringify({
  schedule: [{ phase: 'morning', status: 'busy', activity: 'Teaching a seminar', location: 'The lab', days: [] }],
  birthdaySeason: 'autumn',
  birthdayDay: 3,
  outreach: 'rare',
})
const DRIVE_JSON = JSON.stringify({ chaosBase: 0.12, energyBase: 6, fixations: ['the broken centrifuge'], loves: ['taxonomy'], boredBy: ['small talk'], motifs: ['Anyway'] })
const INTIMACY_JSON = JSON.stringify({ explicitVoiceNote: 'Goes quieter and more exact.', sensitiveRegions: ['neck'], unresponsiveRegions: [], likedKinks: ['praise'], dislikedKinks: ['rough'] })
const OUTFITS_JSON = JSON.stringify([
  { label: 'Lab coat and jeans', unlockAffection: 0, intimate: false },
  { label: 'Field gear', unlockAffection: 15, intimate: false },
  { label: 'Nothing but the coat', unlockAffection: 70, intimate: true },
])
const LORE_JSON = JSON.stringify([
  { keys: ['the survey', 'wetlands'], content: 'Mira has spent three years on an unfinished wetlands survey.' },
])

/** The full happy-path call sequence, in stage order. */
const ALL = [CARD_JSON, GREETINGS_JSON, PROFILE_JSON, BONDS_JSON, SOCIAL_JSON, VOICE_JSON, GIFTS_JSON, WORLDSIM_JSON, DRIVE_JSON, INTIMACY_JSON, OUTFITS_JSON, LORE_JSON]
const STAGES: FullCharacterStage[] = ['card', 'greetings', 'profile', 'bonds', 'social', 'voice', 'gifts', 'worldsim', 'drive', 'intimacy', 'outfits', 'lore']

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
const prompts = (client: ChatBackend) => (client.generate as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].prompt as string)

describe('draftFullCharacter', () => {
  it('runs every stage and returns a fully populated draft', async () => {
    const client = sequenceClient(ALL)
    const draft = await draftFullCharacter(client, { brief: 'a blunt scientist' })

    expect(draft.card.name).toBe('Mira')
    expect(draft.card.alternate_greetings).toHaveLength(2)
    expect(draft.profile?.occupation).toBe('researcher')
    expect(draft.bonds?.relationshipStarters).toHaveLength(3)
    expect(draft.extras.socialConnections?.[0].name).toBe('Oren')
    expect(draft.extras.behavioralRules?.[0].kind).toBe('never')
    expect(draft.extras.voiceFingerprint).toMatchObject({ verbalTics: ['hm.'], sentenceRhythm: 'Short.' })
    expect(draft.extras.sfxWords).toEqual(['tch'])
    expect(draft.extras.giftPreferences).toEqual({ 'flower-bouquet': -1, 'favorite-novel': 3 })
    expect(draft.extras.schedule?.[0].activity).toBe('Teaching a seminar')
    expect(draft.extras.birthday).toBe(58)
    expect(draft.extras.outreach).toEqual({ frequency: 'rare' })
    expect(draft.extras.drive).toMatchObject({ enabled: false, human: true, chaosBase: 0.12, fixations: ['the broken centrifuge'], motifs: ['Anyway'] })
    expect(draft.extras.touchProfile).toEqual({ sensitivity: { neck: 3 } })
    expect(draft.extras.kinkProfile).toEqual({ valence: { praise: 2, rough: -1 } })
    expect(draft.extras.explicitVoiceNote).toBe('Goes quieter and more exact.')
    expect(draft.skipped).toEqual([])
    expect(draft.outfits?.map((o) => o.label)).toEqual(['Lab coat and jeans', 'Field gear', 'Nothing but the coat'])
    expect(draft.outfits?.[2]).toMatchObject({ intimate: true, manualOnly: true, unlockAffection: 70 })
    expect(draft.characterBook?.entries[0].keys).toContain('wetlands')
    expect(draft.completed).toEqual(STAGES)
    expect(draft.failed).toEqual([])
  })

  it('reports progress start → done for each stage in order', async () => {
    const client = sequenceClient(ALL)
    const events: [FullCharacterStage, StageStatus][] = []
    await draftFullCharacter(client, { brief: 'x' }, { onStage: (s, st) => events.push([s, st]) })
    expect(events).toEqual(STAGES.flatMap((s) => [[s, 'start'], [s, 'done']]))
  })

  it('keeps the card when an optional stage fails, recording the failure', async () => {
    const client = sequenceClient([CARD_JSON, GREETINGS_JSON, 'not json at all', BONDS_JSON, SOCIAL_JSON, VOICE_JSON, GIFTS_JSON, WORLDSIM_JSON, DRIVE_JSON, INTIMACY_JSON, OUTFITS_JSON, LORE_JSON])
    const draft = await draftFullCharacter(client, { brief: 'x' })
    expect(draft.card.name).toBe('Mira')
    expect(draft.profile).toBeNull()
    expect(draft.bonds?.giftLikes).toEqual(['field guides'])
    expect(draft.extras.socialConnections).toHaveLength(1)
    expect(draft.outfits?.[0].label).toBe('Lab coat and jeans')
    expect(draft.completed).toEqual(STAGES.filter((s) => s !== 'profile'))
    expect(draft.failed).toEqual([{ stage: 'profile', error: expect.stringMatching(/JSON object/) }])
  })

  it('asks a JSON stage a second time before giving up on it', async () => {
    const client = sequenceClient([CARD_JSON, GREETINGS_JSON, PROFILE_JSON, BONDS_JSON, 'garbage', SOCIAL_JSON, VOICE_JSON, GIFTS_JSON, WORLDSIM_JSON, DRIVE_JSON, INTIMACY_JSON, OUTFITS_JSON, LORE_JSON])
    const draft = await draftFullCharacter(client, { brief: 'x' })
    expect(draft.failed).toEqual([])
    expect(draft.extras.socialConnections?.[0].name).toBe('Oren')
    expect(prompts(client)).toHaveLength(13)
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
    expect(draft.extras).toEqual({})
    expect(draft.outfits).toHaveLength(3)
    expect(prompts(client)).toHaveLength(2)
  })

  it('uses the portrait path when a portrait is supplied', async () => {
    const client = sequenceClient(ALL)
    await draftFullCharacter(client, { portraitBase64: 'B64', brief: 'extra hint' })
    expect((client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0].images).toEqual(['B64'])
  })

  it('threads the writing-style setting into every prose stage', async () => {
    const client = sequenceClient(ALL)
    await draftFullCharacter(client, { brief: 'x', styleGuidance: 'Terse. STYLE_MARKER.' })
    // Everything up to the intimacy settings is prose or tied to it; outfits and lore are label/fact stages and deliberately skip it.
    expect(prompts(client).slice(0, 10).every((p) => p.includes('STYLE_MARKER'))).toBe(true)
  })

  it('lets later stages read what earlier ones wrote', async () => {
    const client = sequenceClient(ALL)
    await draftFullCharacter(client, { brief: 'x' })
    const [, greetings, profile, , , voice, , worldsim] = prompts(client)
    expect(greetings).toContain('First message: "You touched my equipment."')
    expect(profile).not.toContain('Occupation:')
    expect(voice).toContain('Example dialogue:')
    expect(worldsim).toContain('Occupation: researcher, at the biology department')
    expect(worldsim).toContain('Gifts they love: field guides')
  })

  it('scores gifts against the catalog it is given', async () => {
    const client = sequenceClient([CARD_JSON, JSON.stringify({ 'tea-set': 2, 'flower-bouquet': 3 })])
    const catalog = [{ id: 'tea-set', name: 'Tea Set', rarity: 'common' as const, price: 5, tags: [] }]
    const draft = await draftFullCharacter(client, { brief: 'x', giftCatalog: catalog }, { stages: ['gifts'] })
    expect(draft.extras.giftPreferences).toEqual({ 'tea-set': 2 })
    expect(prompts(client)[1]).toContain('- tea-set: Tea Set')
  })

  it('stops before the next stage when the signal is already aborted', async () => {
    const client = sequenceClient(ALL)
    const controller = new AbortController()
    const onStage = vi.fn((stage: FullCharacterStage, status: StageStatus) => {
      if (stage === 'card' && status === 'done') controller.abort()
    })
    const err = await draftFullCharacter(client, { brief: 'x' }, { signal: controller.signal, onStage }).catch((e) => e)
    expect(isAbortError(err)).toBe(true)
    expect(onStage).not.toHaveBeenCalledWith('greetings', 'start')
  })
})

describe('runDraftStage', () => {
  const draft = (): DraftSections => ({
    card: JSON.parse(CARD_JSON),
    profile: { occupation: 'old job', workplace: '', homeLocation: '', frequentedLocations: [], likes: [], goals: [], boundaries: [], loveLanguage: '' },
    extras: { giftPreferences: { 'favorite-novel': 3 }, schedule: [{ id: 'old', phase: 'night', status: 'sleeping', activity: 'Asleep' }] },
  })

  it('replaces only that stage\'s output and leaves the rest of the draft alone', async () => {
    const out = await runDraftStage(sequenceClient([WORLDSIM_JSON]), 'worldsim', draft())
    expect(out.extras?.schedule?.[0].activity).toBe('Teaching a seminar')
    expect(out.extras?.giftPreferences).toEqual({ 'favorite-novel': 3 })
    expect(out.profile?.occupation).toBe('old job')
  })

  it('does not feed a stage its own previous output', async () => {
    const client = sequenceClient([PROFILE_JSON])
    const out = await runDraftStage(client, 'profile', draft())
    expect(out.profile?.occupation).toBe('researcher')
    expect(prompts(client)[0]).not.toContain('old job')
  })

  it('writes greetings onto the card', async () => {
    const out = await runDraftStage(sequenceClient([GREETINGS_JSON]), 'greetings', draft())
    expect(out.card.alternate_greetings).toHaveLength(2)
  })

  it('throws and leaves the draft untouched when the stage fails', async () => {
    const before = draft()
    await expect(runDraftStage(sequenceClient(['nope', 'nope']), 'social', before)).rejects.toThrow()
    expect(before.extras?.socialConnections).toBeUndefined()
  })

  it('shows a stage the current section and what the writer wants changed', async () => {
    const client = sequenceClient([PROFILE_JSON])
    await runDraftStage(client, 'profile', draft(), { current: 'Occupation: old job', hint: 'make her a baker' })
    expect(prompts(client)[0]).toContain('Current version of this section, to be rewritten:\nOccupation: old job')
    expect(prompts(client)[0]).toContain("The writer's instruction for this section: make her a baker")
  })

  it('replaces the intimacy settings whole, so a smaller answer clears what was there', async () => {
    const before: DraftSections = {
      card: JSON.parse(CARD_JSON),
      extras: { touchProfile: { sensitivity: { neck: 3 } }, kinkProfile: { valence: { praise: 2 } }, explicitVoiceNote: 'old note' },
    }
    const out = await runDraftStage(sequenceClient([JSON.stringify({ explicitVoiceNote: 'new note' })]), 'intimacy', before)
    expect(out.extras).toEqual({ explicitVoiceNote: 'new note' })
  })
})

describe('intimacy settings', () => {
  const minorCard = JSON.stringify({ ...JSON.parse(CARD_JSON), description: 'A 15-year-old with short silver hair.' })

  it('are skipped, with the reason, for a card that describes someone under 18', async () => {
    const client = sequenceClient([minorCard, INTIMACY_JSON])
    const draft = await draftFullCharacter(client, { brief: 'a young scientist' }, { stages: ['intimacy'] })
    expect(draft.extras).toEqual({})
    expect(draft.skipped).toEqual([{ stage: 'intimacy', reason: expect.stringContaining('under 18') }])
    expect(draft.completed).not.toContain('intimacy')
    expect(prompts(client)).toHaveLength(1)
  })

  it('are skipped when only the brief gives the age', async () => {
    const client = sequenceClient([CARD_JSON, INTIMACY_JSON])
    const draft = await draftFullCharacter(client, { brief: 'a 16 year old scientist' }, { stages: ['intimacy'] })
    expect(draft.skipped).toHaveLength(1)
    expect(prompts(client)).toHaveLength(1)
  })

  it('never get an undressed wardrobe state for such a card', async () => {
    const draft = await draftFullCharacter(sequenceClient([minorCard, OUTFITS_JSON]), { brief: 'x' }, { stages: ['outfits'] })
    expect(draft.outfits?.length).toBeGreaterThan(0)
    expect(draft.outfits?.some((o) => o.intimate)).toBe(false)
  })

  it('keep the limits already on the card when one section is rewritten', async () => {
    const before: DraftSections = {
      card: JSON.parse(CARD_JSON),
      brief: 'Hard limits: oral.',
      extras: { touchProfile: { offLimits: ['feet'], gated: { lips: 40 } }, kinkProfile: { hardLimits: ['bondage', 'custom_kink'], valence: { rough: -1 } } },
    }
    const answer = JSON.stringify({ likedKinks: ['praise', 'bondage'], sensitiveRegions: ['feet', 'neck'] })
    const out = await runDraftStage(sequenceClient([answer]), 'intimacy', before)
    expect(out.extras?.kinkProfile).toEqual({ valence: { praise: 2 }, hardLimits: ['bondage', 'oral', 'custom_kink'] })
    expect(out.extras?.touchProfile).toEqual({ sensitivity: { neck: 3 }, offLimits: ['feet'], gated: { lips: 40 } })
  })

  it('take hard limits from the brief and nowhere else', async () => {
    const answer = JSON.stringify({ sensitiveRegions: ['feet'], likedKinks: ['bondage', 'praise'], dislikedKinks: [] })
    const draft = await draftFullCharacter(sequenceClient([CARD_JSON, answer]), { brief: 'a blunt scientist. Hard limits: bondage. No touching her feet.' }, { stages: ['intimacy'] })
    expect(draft.extras.kinkProfile).toEqual({ valence: { praise: 2 }, hardLimits: ['bondage'] })
    expect(draft.extras.touchProfile).toEqual({ offLimits: ['feet'] })
    const none = await draftFullCharacter(sequenceClient([CARD_JSON, JSON.stringify({ likedKinks: ['praise'], dislikedKinks: ['rough'] })]), { brief: 'a blunt scientist' }, { stages: ['intimacy'] })
    expect(none.extras.kinkProfile?.hardLimits).toBeUndefined()
  })

  it('show the model the brief and the boundaries', async () => {
    const client = sequenceClient([CARD_JSON, INTIMACY_JSON])
    await draftFullCharacter(client, { brief: 'a blunt scientist' }, { stages: ['intimacy'] })
    expect(prompts(client)[1]).toContain("The creator's brief: a blunt scientist")
  })
})