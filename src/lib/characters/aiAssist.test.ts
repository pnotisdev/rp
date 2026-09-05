import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  draftCharacterBonds,
  draftCharacterFromBrief,
  draftCharacterFromPortrait,
  draftCharacterOutfits,
  draftCharacterProfile,
  regenerateCardField,
  suggestLoreEntries,
} from './aiAssist'
import type { ChatBackend } from '@/lib/api/chatBackend'
import type { CharacterCardData } from './cardSpec'

function mockClient(response: string): ChatBackend {
  return {
    generate: vi.fn().mockResolvedValue(response),
    generateStream: vi.fn(),
    getEffectiveMaxContext: vi.fn().mockResolvedValue(4096),
    tokenCount: vi.fn(),
    abort: vi.fn(),
    getChatTemplate: vi.fn().mockResolvedValue(null),
  }
}

/** Never resolves or rejects on its own — only reacts to the caller's abort signal. */
function hangingClient(onAbort: () => void): ChatBackend {
  return {
    generate: (_p, signal) =>
      new Promise<string>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          onAbort()
          reject(new DOMException('aborted', 'AbortError'))
        })
      }),
    generateStream: vi.fn(),
    getEffectiveMaxContext: vi.fn().mockResolvedValue(4096),
    tokenCount: vi.fn(),
    abort: vi.fn(),
    getChatTemplate: vi.fn().mockResolvedValue(null),
  }
}

const CHARACTER: CharacterCardData = {
  name: 'Mira',
  description: 'A tall scientist.',
  personality: 'Blunt.',
  scenario: '',
  first_mes: '',
  mes_example: '',
}

const VALID_CARD_JSON = JSON.stringify({
  name: 'Mira',
  description: 'A tall woman with short silver hair, wearing a lab coat.',
  personality: 'Blunt, curious, impatient with small talk.',
  scenario: 'Meeting in a university lab.',
  first_mes: '"You touched my equipment, didn\'t you."',
  mes_example: '<START>\n{{user}}: Hi.\n{{char}}: "Hi" is not a hypothesis.',
  creator_notes: '',
  tags: ['scientist'],
})

describe('draftCharacterFromPortrait', () => {
  it('sends the portrait as the images array, not inline in the prompt text', async () => {
    const client = mockClient(VALID_CARD_JSON)
    await draftCharacterFromPortrait(client, 'FAKE_BASE64_DATA')
    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.images).toEqual(['FAKE_BASE64_DATA'])
    expect(call.prompt).not.toContain('FAKE_BASE64_DATA')
  })

  it('parses the model output into a normalized character card', async () => {
    const client = mockClient(VALID_CARD_JSON)
    const { card } = await draftCharacterFromPortrait(client, 'b64')
    expect(card.name).toBe('Mira')
    expect(card.description).toContain('silver hair')
    expect(card.tags).toEqual(['scientist'])
  })

  it('returns the raw output alongside the parsed card, for the failure-path "show raw output" UI', async () => {
    const client = mockClient(VALID_CARD_JSON)
    const { rawOutput } = await draftCharacterFromPortrait(client, 'b64')
    expect(rawOutput).toBe(VALID_CARD_JSON)
  })

  it('includes worldTone in the prompt when given, fitting the draft to the world instead of contradicting it', async () => {
    const client = mockClient(VALID_CARD_JSON)
    await draftCharacterFromPortrait(client, 'b64', { worldTone: 'A gritty cyberpunk megacity.' })
    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.prompt).toContain('A gritty cyberpunk megacity.')
  })

  it('omits any world-tone instruction when none is given, rather than sending an empty section', async () => {
    const client = mockClient(VALID_CARD_JSON)
    await draftCharacterFromPortrait(client, 'b64')
    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.prompt).not.toContain('Fit the character to')
  })

  it('includes the creator\'s additional brief text when given', async () => {
    const client = mockClient(VALID_CARD_JSON)
    await draftCharacterFromPortrait(client, 'b64', { brief: 'Make her left-handed.' })
    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.prompt).toContain('Make her left-handed.')
  })

  it('propagates a parse failure rather than silently returning a blank card', async () => {
    const client = mockClient('not json at all, sorry')
    await expect(draftCharacterFromPortrait(client, 'b64')).rejects.toThrow()
  })
})

describe('draftCharacterFromBrief', () => {
  it('parses the model output into a normalized card', async () => {
    const client = mockClient(VALID_CARD_JSON)
    const { card, rawOutput } = await draftCharacterFromBrief(client, 'a blunt scientist')
    expect(card.name).toBe('Mira')
    expect(card.personality).toContain('Blunt')
    expect(rawOutput).toBe(VALID_CARD_JSON)
  })

  it('folds worldTone into the prompt when given, and omits the instruction otherwise', async () => {
    const withTone = mockClient(VALID_CARD_JSON)
    await draftCharacterFromBrief(withTone, 'brief', { worldTone: 'A gritty cyberpunk megacity.' })
    expect((withTone.generate as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt).toContain('gritty cyberpunk megacity')

    const without = mockClient(VALID_CARD_JSON)
    await draftCharacterFromBrief(without, 'brief')
    expect((without.generate as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt).not.toContain("Fit the character to this world")
  })

  it('propagates a parse failure rather than returning a blank card', async () => {
    await expect(draftCharacterFromBrief(mockClient('sorry, not json'), 'brief')).rejects.toThrow()
  })

  it('folds the global writing-style setting into the prompt when set', async () => {
    const client = mockClient(VALID_CARD_JSON)
    await draftCharacterFromBrief(client, 'brief', { styleGuidance: 'Second person, present tense. STYLE_MARKER.' })
    expect((client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt).toContain('STYLE_MARKER')
  })
})

describe('draftCharacterProfile', () => {
  const PROFILE_JSON = JSON.stringify({
    occupation: 'field researcher',
    workplace: 'the university biology department',
    homeLocation: 'a cramped flat above a laundromat',
    frequentedLocations: ['the campus greenhouse', 'a 24-hour diner', 'the river path'],
    likes: ['taxonomy', 'cold coffee', 'arguing about methodology'],
    goals: ['publish the wetlands survey', 'stop working nights'],
    boundaries: ['no one touches her samples'],
    loveLanguage: 'She notices when you remember the small things.',
  })

  it('coerces every field and caps list lengths', async () => {
    const bloated = JSON.stringify({
      occupation: '  nurse  ',
      likes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 42],
      goals: [],
      boundaries: ['x'],
      frequentedLocations: ['p', 'q', 'r', 's', 't'],
      loveLanguage: 'words',
    })
    const p = await draftCharacterProfile(mockClient(bloated), CHARACTER)
    expect(p.occupation).toBe('nurse')
    expect(p.likes).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(p.frequentedLocations).toHaveLength(4)
    expect(p.workplace).toBe('')
    expect(p.goals).toEqual([])
  })

  it('parses a well-formed profile', async () => {
    const p = await draftCharacterProfile(mockClient(PROFILE_JSON), CHARACTER)
    expect(p.occupation).toBe('field researcher')
    expect(p.goals).toContain('stop working nights')
  })

  it('throws when the model returns an array instead of an object', async () => {
    await expect(draftCharacterProfile(mockClient('["nope"]'), CHARACTER)).rejects.toThrow(/JSON object/)
  })
})

describe('draftCharacterBonds', () => {
  it('drops out-of-set weather values and assigns ids + clamped affection to starters', async () => {
    const json = JSON.stringify({
      giftLikes: ['handmade things', 'field guides'],
      giftDislikes: ['perfume'],
      weatherLoves: ['overcast', 'RAIN', 'moonlight'],
      weatherHates: ['storm'],
      relationshipStarters: [
        { label: 'Strangers', blurb: 'You and Mira have never spoken.', startingAffection: 0 },
        { label: 'Lab neighbours', blurb: 'You share a bench.', startingAffection: 999 },
        { label: 'No blurb', startingAffection: 10 },
      ],
    })
    const b = await draftCharacterBonds(mockClient(json), CHARACTER)
    expect(b.weatherLoves).toEqual(['overcast', 'rain'])
    expect(b.relationshipStarters).toHaveLength(2)
    expect(b.relationshipStarters[0].id).toBeTruthy()
    expect(b.relationshipStarters[1].startingAffection).toBe(100)
  })

  it('throws when the model does not return an object', async () => {
    await expect(draftCharacterBonds(mockClient('not json'), CHARACTER)).rejects.toThrow()
  })
})

describe('draftCharacterOutfits', () => {
  it('mints deduped ids, keeps only positive unlocks, and flags an intimate outfit manualOnly', async () => {
    const json = JSON.stringify([
      { label: 'Lab coat', unlockAffection: 0, intimate: false },
      { label: 'Lab coat', unlockAffection: 10 },
      { label: 'Undressed', unlockAffection: 65, intimate: true },
    ])
    const outfits = await draftCharacterOutfits(mockClient(json), CHARACTER)
    expect(outfits.map((o) => o.id)).toEqual(['lab-coat', 'lab-coat-2', 'undressed'])
    expect(outfits[0].unlockAffection).toBeUndefined()
    expect(outfits[1].unlockAffection).toBe(10)
    expect(outfits[2]).toMatchObject({ intimate: true, manualOnly: true, unlockAffection: 65 })
  })

  it('caps at 4 outfits and skips entries with no label', async () => {
    const json = JSON.stringify([
      { label: 'A' }, { label: '' }, { label: 'B' }, { label: 'C' }, { label: 'D' }, { label: 'E' },
    ])
    const outfits = await draftCharacterOutfits(mockClient(json), CHARACTER)
    expect(outfits.map((o) => o.label)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('throws when the model does not return an array', async () => {
    await expect(draftCharacterOutfits(mockClient('{"label":"nope"}'), CHARACTER)).rejects.toThrow(/JSON array/)
  })
})

describe('regenerateCardField', () => {
  it('returns the rewritten field, trimmed', async () => {
    const client = mockClient('  A tall woman with short silver hair.  ')
    const text = await regenerateCardField(client, CHARACTER, 'description')
    expect(text).toBe('A tall woman with short silver hair.')
  })

  it('grounds the rewrite in the current text and per-field guidance, and threads hint + style through', async () => {
    const client = mockClient('text')
    await regenerateCardField(client, CHARACTER, 'personality', {
      hint: 'Make her warmer',
      styleGuidance: 'Terse noir. STYLE_MARKER.',
    })
    const { prompt } = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(prompt).toContain('Current personality, which needs work:\nBlunt.')
    expect(prompt).toContain('Traits with edges and contradictions')
    expect(prompt).toContain('What the writer specifically wants changed: Make her warmer')
    expect(prompt).toContain('STYLE_MARKER')
  })

  it('omits the writing-style note when the setting is blank', async () => {
    const client = mockClient('text')
    await regenerateCardField(client, CHARACTER, 'description', { styleGuidance: '   ' })
    const { prompt } = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(prompt).not.toContain('style notes for everything they make')
  })

  it('names the slop the current text leans on so the model has something concrete to avoid', async () => {
    const sloppy: CharacterCardData = {
      ...CHARACTER,
      description: "She had an unreadable expression, and couldn't help but feel a shiver down her spine.",
    }
    const client = mockClient('text')
    await regenerateCardField(client, sloppy, 'description')
    const { prompt } = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(prompt).toMatch(/Do not reuse any of them.*couldn't help but/i)
  })

  it('handles an empty field without a "current version" or slop section', async () => {
    const blank: CharacterCardData = { ...CHARACTER, scenario: '' }
    const client = mockClient('text')
    await regenerateCardField(client, blank, 'scenario')
    const { prompt } = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(prompt).toContain('The scenario field is empty')
    expect(prompt).not.toContain('leans on these tells')
  })
})

describe('suggestLoreEntries', () => {
  it('parses proposed entries into keys + content', async () => {
    const client = mockClient('[{"keys":["lab","equipment"],"content":"The lab is off-limits after hours."}]')
    const entries = await suggestLoreEntries(client, CHARACTER, [])
    expect(entries).toEqual([{ keys: ['lab', 'equipment'], content: 'The lab is off-limits after hours.' }])
  })

  it('drops entries with no keys or no content', async () => {
    const client = mockClient('[{"keys":[],"content":"x"},{"keys":["a"],"content":""},{"keys":["a"],"content":"real"}]')
    const entries = await suggestLoreEntries(client, CHARACTER, [])
    expect(entries).toEqual([{ keys: ['a'], content: 'real' }])
  })

  it('throws when the model does not return a JSON array', async () => {
    const client = mockClient('{"not": "an array"}')
    await expect(suggestLoreEntries(client, CHARACTER, [])).rejects.toThrow('Model did not return a JSON array of lore entries')
  })
})

describe('timeout handling', () => {
  // Same live-confirmed failure mode `generateWithTimeout` exists for: a provider response that
  // simply never resolves used to leave every one of this file's callers — the field "Regenerate"
  // button, `GenerateCharacterDialog`, the lore-entry suggester — stuck forever with no error and
  // no way to retry.
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('regenerateCardField times out with a labelled message', async () => {
    const pending = regenerateCardField(hangingClient(() => {}), CHARACTER, 'description')
    const assertion = expect(pending).rejects.toThrow(/Regenerate field timed out after 45s/)
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion
  })

  it('draftCharacterFromPortrait times out with a labelled message', async () => {
    const pending = draftCharacterFromPortrait(hangingClient(() => {}), 'b64')
    const assertion = expect(pending).rejects.toThrow(/Draft character from portrait timed out after 45s/)
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion
  })

  it('suggestLoreEntries times out with a labelled message', async () => {
    const pending = suggestLoreEntries(hangingClient(() => {}), CHARACTER, [])
    const assertion = expect(pending).rejects.toThrow(/Suggest lore entries timed out after 45s/)
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion
  })
})
