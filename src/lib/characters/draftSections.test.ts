import { describe, expect, it, vi } from 'vitest'
import type { ChatBackend } from '@/lib/api/chatBackend'
import type { GiftItem } from '@/lib/types'
import type { CharacterCardData } from './cardSpec'
import { describesMinor } from './minor'
import {
  draftGiftScores,
  draftSocial,
  draftVoice,
  parseDrive,
  parseGiftScores,
  parseGreetings,
  parseIntimacy,
  parseRoutine,
  parseSocial,
  parseVoice,
} from './draftSections'

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
const calls = (client: ChatBackend) => (client.generate as ReturnType<typeof vi.fn>).mock.calls

const subject = { name: 'Mira', description: 'A blunt scientist.' }
const gifts: GiftItem[] = [
  { id: 'flower-bouquet', name: 'Flower Bouquet', rarity: 'common', price: 6, tags: ['sweet'] },
  { id: 'field-guide', name: 'Field Guide', rarity: 'rare', price: 16, tags: [] },
]

describe('parseGreetings', () => {
  it('drops a greeting that repeats the first message or another greeting, ignoring case and spacing', () => {
    const out = parseGreetings({ greetings: ['You  are LATE.', 'Rain again.', 'rain   again.', 'A new one.'] }, 'you are late.')
    expect(out).toEqual(['Rain again.', 'A new one.'])
  })

  it('keeps at most three, skipping non-strings', () => {
    expect(parseGreetings({ greetings: ['a', 4, 'b', null, 'c', 'd'] })).toEqual(['a', 'b', 'c'])
  })

  it('throws when nothing usable is left', () => {
    expect(() => parseGreetings({ greetings: ['Hello.'] }, 'hello.')).toThrow(/greetings/)
    expect(() => parseGreetings({})).toThrow()
  })
})

describe('parseSocial', () => {
  it('keeps connections with a name and relation, and a note only when given', () => {
    const out = parseSocial({
      socialConnections: [
        { name: 'Oren', relation: 'older brother', notes: 'Calls on Sundays.' },
        { name: 'Tali', relation: 'rival' },
        { name: '', relation: 'nobody' },
        { name: 'Pat', relation: '' },
      ],
    })
    expect(out.socialConnections?.map((c) => c.name)).toEqual(['Oren', 'Tali'])
    expect(out.socialConnections?.[0].notes).toBe('Calls on Sundays.')
    expect('notes' in out.socialConnections![1]).toBe(false)
    expect(out.behavioralRules).toBeUndefined()
  })

  it('needs a "when" for a when_then rule but not for a never rule', () => {
    const out = parseSocial({
      behavioralRules: [
        { kind: 'when_then', when: 'someone is rude', then: 'goes quiet' },
        { kind: 'when_then', when: '', then: 'does something' },
        { kind: 'never', when: '', then: 'lies about the survey' },
        { kind: 'never', then: '' },
      ],
    })
    expect(out.behavioralRules?.map((r) => [r.kind, r.then])).toEqual([
      ['when_then', 'goes quiet'],
      ['never', 'lies about the survey'],
    ])
    expect('when' in out.behavioralRules![1]).toBe(false)
  })

  it('throws when neither list has anything usable', () => {
    expect(() => parseSocial({ socialConnections: [{ name: 'x' }], behavioralRules: [] })).toThrow()
  })
})

describe('parseVoice', () => {
  it('trims and caps the lists', () => {
    const out = parseVoice({ verbalTics: [' well, ', 'hm', 'a', 'b', 'c'], catchphrases: ['x'], dialectNotes: ' Dry. ', sentenceRhythm: 'Short.', sfxWords: ['tch'] })
    expect(out.verbalTics).toEqual(['well,', 'hm', 'a', 'b'])
    expect(out.dialectNotes).toBe('Dry.')
  })

  it('drops entries with no letters in them, such as a bare ellipsis', () => {
    const out = parseVoice({ verbalTics: ['...', 'hm.', '—'], catchphrases: ['?!'], sfxWords: ['...', 'tch'] })
    expect(out.verbalTics).toEqual(['hm.'])
    expect(out.catchphrases).toEqual([])
    expect(out.sfxWords).toEqual(['tch'])
  })
})

describe('draftVoice', () => {
  const card = {
    name: 'Mira',
    first_mes: '"Well, you came."',
    mes_example: '<START>\n{{user}}: Hi.\n{{char}}: "Well, fine."\n{{user}}: Ok.\n{{char}}: "Well, I suppose."',
    alternate_greetings: [],
  } as unknown as CharacterCardData

  it('fills what the model left out from the card\'s own dialogue, but not with its repeated phrases', async () => {
    const out = await draftVoice(sequenceClient(['{}']), subject, card, {})
    expect(out.voiceFingerprint?.verbalTics).toContain('well')
    expect(out.voiceFingerprint?.catchphrases).toBeUndefined()
    expect(out.sfxWords).toBeUndefined()
  })

  it('prefers the model\'s answer where it gave one', async () => {
    const reply = JSON.stringify({ verbalTics: ['hm.'], dialectNotes: 'Formal.', sfxWords: ['tch'] })
    const out = await draftVoice(sequenceClient([reply]), subject, card, {})
    expect(out.voiceFingerprint?.verbalTics).toEqual(['hm.'])
    expect(out.voiceFingerprint?.dialectNotes).toBe('Formal.')
    expect(out.sfxWords).toEqual(['tch'])
  })

  it('throws when neither the model nor the card has anything to offer', async () => {
    const bare = { name: 'Mira', first_mes: '', mes_example: '', alternate_greetings: [] } as unknown as CharacterCardData
    await expect(draftVoice(sequenceClient(['{}']), subject, bare, {})).rejects.toThrow(/voice/)
  })
})

describe('parseGiftScores', () => {
  it('keeps catalog ids only, rounds, clamps to -2..3 and drops zero', () => {
    const out = parseGiftScores({ 'flower-bouquet': 2.6, 'field-guide': -9, 'not-a-gift': 3, other: 0 }, gifts)
    expect(out).toEqual({ 'flower-bouquet': 3, 'field-guide': -2 })
    expect(parseGiftScores({ scores: { 'field-guide': 5 } }, gifts)).toEqual({ 'field-guide': 3 })
  })

  it('accepts a gift named by its exact name, in any case', () => {
    expect(parseGiftScores({ 'field guide': 3, 'FLOWER BOUQUET': -1 }, gifts)).toEqual({ 'field-guide': 3, 'flower-bouquet': -1 })
  })

  it('throws, naming the valid ids, when no gift got a score', () => {
    expect(() => parseGiftScores({ 'flower-bouquet': 0, 'x': 1 }, gifts)).toThrow(/flower-bouquet, field-guide/)
  })
})

describe('draftGiftScores', () => {
  it('lists the catalog in the prompt and returns the scores as giftPreferences', async () => {
    const client = sequenceClient([JSON.stringify({ 'field-guide': 3 })])
    const out = await draftGiftScores(client, subject, gifts, {})
    expect(out).toEqual({ giftPreferences: { 'field-guide': 3 } })
    expect(calls(client)[0][0].prompt).toContain('- flower-bouquet: Flower Bouquet (sweet)')
    expect(calls(client)[0][0].prompt).toContain('- field-guide: Field Guide\n')
    // The answer template carries every real id, all at zero.
    expect(calls(client)[0][0].prompt).toContain('{"flower-bouquet":0,"field-guide":0}')
  })
})

describe('parseRoutine', () => {
  const slot = (over: Record<string, unknown>) => ({ phase: 'morning', status: 'busy', activity: 'Teaching', location: 'The lab', days: [], ...over })

  it('keeps valid slots, drops the rest, orders weekdays and drops repeats of the same slot', () => {
    const out = parseRoutine({
      schedule: [
        slot({}),
        slot({ phase: 'noon' }),
        slot({ status: 'napping' }),
        slot({ activity: '' }),
        slot({ phase: 'night', status: 'sleeping', activity: 'Asleep', location: '', days: [] }),
        slot({ phase: 'evening', days: ['Sunday', 'saturday', 'funday'] }),
        slot({ phase: 'evening', days: ['saturday', 'sunday'] }),
      ],
    })
    expect(out.schedule?.map((s) => [s.phase, s.status, s.days])).toEqual([
      ['morning', 'busy', undefined],
      ['night', 'sleeping', undefined],
      ['evening', 'busy', ['saturday', 'sunday']],
    ])
    expect('location' in out.schedule![1]).toBe(false)
  })

  it('turns a season and day into a day of the year, and accepts "fall"', () => {
    expect(parseRoutine({ birthdaySeason: 'Autumn', birthdayDay: 3 }).birthday).toBe(58)
    expect(parseRoutine({ birthdaySeason: 'fall', birthdayDay: 3 }).birthday).toBe(58)
    expect(parseRoutine({ birthdaySeason: 'spring', birthdayDay: 1 }).birthday).toBe(0)
    expect(parseRoutine({ birthdaySeason: 'winter', birthdayDay: 28, outreach: 'rare' }).birthday).toBe(111)
  })

  it('rejects an out-of-range or unknown birthday', () => {
    expect(parseRoutine({ birthdaySeason: 'winter', birthdayDay: 29, outreach: 'rare' }).birthday).toBeUndefined()
    expect(parseRoutine({ birthdaySeason: 'monsoon', birthdayDay: 3, outreach: 'rare' }).birthday).toBeUndefined()
  })

  it('leaves outreach out when it is "never" or unknown', () => {
    expect(parseRoutine({ schedule: [slot({})], outreach: 'never' }).outreach).toBeUndefined()
    expect(parseRoutine({ schedule: [slot({})], outreach: 'constantly' }).outreach).toBeUndefined()
    expect(parseRoutine({ schedule: [slot({})], outreach: 'Eager' }).outreach).toEqual({ frequency: 'eager' })
  })

  it('throws when there is nothing to keep', () => {
    expect(() => parseRoutine({ schedule: [{ phase: 'x' }], outreach: 'never' })).toThrow()
  })
})

describe('parseDrive', () => {
  it('is always switched off and human, whatever the model says', () => {
    const out = parseDrive({ enabled: true, human: false, chaosBase: 0.2, energyBase: 7, fixations: ['the fridge'], loves: [], boredBy: [] })
    expect(out.drive).toMatchObject({ enabled: false, human: true, chaosBase: 0.2, energyBase: 7, fixations: ['the fridge'] })
  })

  it('understands a percentage, clamps, and rounds the energy', () => {
    expect(parseDrive({ chaosBase: 12, energyBase: 7.6, fixations: ['a'] }).drive).toMatchObject({ chaosBase: 0.12, energyBase: 8 })
    expect(parseDrive({ chaosBase: '15%', fixations: ['a'] }).drive).toMatchObject({ chaosBase: 0.15 })
    expect(parseDrive({ chaosBase: 0.9, energyBase: 99, fixations: ['a'] }).drive).toMatchObject({ chaosBase: 0.4, energyBase: 10 })
    expect(parseDrive({ chaosBase: -3, energyBase: -1, fixations: ['a'] }).drive).toMatchObject({ chaosBase: 0, energyBase: 0 })
  })

  it('falls back to the defaults for a number it cannot read', () => {
    expect(parseDrive({ chaosBase: 'lots', fixations: ['a'] }).drive).toMatchObject({ chaosBase: 0.12, energyBase: 6 })
  })

  it('keeps the lists short and drops entries with no letters', () => {
    const out = parseDrive({ fixations: ['a', 'b', 'c', 'd', 'e', 'f', '...'], loves: ['x'], boredBy: ['y'], motifs: ['one', 'two', 'three', 'four', 'five'] })
    expect(out.drive?.fixations).toHaveLength(5)
    expect(out.drive?.motifs).toHaveLength(4)
  })

  it('throws when it has nothing to draw on', () => {
    expect(() => parseDrive({ chaosBase: 0.1, energyBase: 5 })).toThrow(/fixations/)
  })
})

describe('parseIntimacy', () => {
  it('keeps real regions and kinks only, at the two levels the editor can show', () => {
    const out = parseIntimacy(
      { sensitiveRegions: ['Neck', 'nape', 'inner thigh'], unresponsiveRegions: ['feet'], likedKinks: ['Dirty Talk', 'cuddling'], dislikedKinks: ['rough'], explicitVoiceNote: ' Quieter. ' },
      '',
    )
    expect(out.touchProfile).toEqual({ sensitivity: { neck: 3, inner_thigh: 3, feet: 0 } })
    expect(out.kinkProfile).toEqual({ valence: { dirty_talk: 2, rough: -1 } })
    expect(out.explicitVoiceNote).toBe('Quieter.')
  })

  it('puts a region or a kink in one list only', () => {
    const out = parseIntimacy({ sensitiveRegions: ['neck'], unresponsiveRegions: ['neck', 'feet'], likedKinks: ['praise'], dislikedKinks: ['praise'] }, '')
    expect(out.touchProfile).toEqual({ sensitivity: { neck: 3, feet: 0 } })
    expect(out.kinkProfile).toEqual({ valence: { praise: -1 } })
  })

  it('caps each list', () => {
    const out = parseIntimacy({ sensitiveRegions: ['hair', 'face', 'lips', 'neck', 'ears', 'back'], likedKinks: ['bondage', 'toys', 'edging', 'praise', 'roleplay', 'gentle', 'oral'] }, '')
    expect(Object.keys(out.touchProfile?.sensitivity ?? {})).toHaveLength(4)
    expect(Object.keys(out.kinkProfile?.valence ?? {})).toHaveLength(5)
  })

  it('leaves everything out when the model offered nothing, which means neutral', () => {
    expect(parseIntimacy({ sensitiveRegions: [], unresponsiveRegions: [], likedKinks: [], dislikedKinks: [], explicitVoiceNote: '' }, '')).toEqual({})
  })

  it('adds limits that were stated, even when the model said nothing', () => {
    expect(parseIntimacy({ likedKinks: [] }, 'Hard limits: bondage. Please, no touching her feet.')).toEqual({
      touchProfile: { offLimits: ['feet'] },
      kinkProfile: { hardLimits: ['bondage'] },
    })
  })

  it('rejects an answer with none of the requested keys', () => {
    expect(() => parseIntimacy({ unrelated: ['x'] }, '')).toThrow(/none of the requested keys/)
  })
})

describe('describesMinor', () => {
  it('reads ages and age words', () => {
    expect(describesMinor('A 15-year-old with silver hair')).toBe(true)
    expect(describesMinor('Name: Mika. Age: 17')).toBe(true)
    expect(describesMinor('a high school student')).toBe(true)
    expect(describesMinor('x', undefined, 'a teenager')).toBe(true)
  })

  it('lets adults and ageless text through', () => {
    expect(describesMinor('A 27 year old botanist', 'aged 18', undefined)).toBe(false)
    expect(describesMinor('A 1000-year-old vampire, and a childhood friend')).toBe(false)
  })
})

describe('retrying a stage', () => {
  const good = JSON.stringify({ socialConnections: [{ name: 'Oren', relation: 'brother' }] })

  it('asks once more when the first answer is not usable', async () => {
    const client = sequenceClient(['not json at all', good])
    const out = await draftSocial(client, subject, {})
    expect(out.socialConnections?.[0].name).toBe('Oren')
    expect(calls(client)).toHaveLength(2)
  })

  it('tells the model why the first answer was rejected', async () => {
    const client = sequenceClient(['not json at all', good])
    await draftSocial(client, subject, {})
    expect(calls(client)[0][0].prompt).not.toContain('rejected')
    expect(calls(client)[1][0].prompt).toContain('Your previous answer was rejected. It was not valid JSON: every string, including each item in a list, needs double quotes.')

    const gifted = sequenceClient([JSON.stringify({ 'dried-herbs': 3 }), JSON.stringify({ 'field-guide': 3 })])
    expect(await draftGiftScores(gifted, subject, gifts, {})).toEqual({ giftPreferences: { 'field-guide': 3 } })
    expect(calls(gifted)[1][0].prompt).toContain('using only these ids exactly as written: flower-bouquet, field-guide.')
  })

  it('gives up after the second bad answer', async () => {
    const client = sequenceClient(['nope', '{"socialConnections": []}'])
    await expect(draftSocial(client, subject, {})).rejects.toThrow()
    expect(calls(client)).toHaveLength(2)
  })

  it('does not retry a backend failure', async () => {
    const client = sequenceClient([])
    ;(client.generate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection refused'))
    await expect(draftSocial(client, subject, {})).rejects.toThrow('connection refused')
    expect(calls(client)).toHaveLength(1)
  })
})
