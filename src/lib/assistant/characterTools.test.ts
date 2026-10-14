import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBackend } from '@/lib/api/chatBackend'
import type { Character } from '@/lib/characters/cardSpec'
import { BUILD_CHARACTER, EDIT_CHARACTER_SECTION, characterTools, runBuildCharacter, runEditCharacterSection, type CharacterToolContext } from './characterTools'

const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), world: vi.fn() }))
vi.mock('@/lib/api/client', () => ({
  charactersApi: { get: api.get, update: api.update },
  worldsApi: { get: api.world },
  isConflict: (e: unknown) => (e as { status?: number })?.status === 409,
}))
vi.mock('@/lib/api/assistShaping', () => ({ resolveAssistShaping: async () => ({ reasoningReserve: 0, template: undefined, timeoutMs: 1000 }) }))

const CARD = { name: 'Mira', description: 'A tall woman with silver hair.', personality: 'Blunt.', scenario: 'A lab.', first_mes: '"Hi."', mes_example: '', alternate_greetings: ['old one'] }

/** Answers each model call in order. */
function client(responses: string[]): ChatBackend {
  let i = 0
  return {
    generate: vi.fn().mockImplementation(async () => responses[Math.min(i++, responses.length - 1)]),
    generateStream: vi.fn(),
    getEffectiveMaxContext: vi.fn().mockResolvedValue(4096),
  } as unknown as ChatBackend
}

const prompts = (c: ChatBackend) => (c.generate as ReturnType<typeof vi.fn>).mock.calls.map((x) => x[0].prompt as string)

const ctx = (c: ChatBackend, approve = true): CharacterToolContext & { approve: ReturnType<typeof vi.fn> } => ({ client: c, styleGuidance: '', approve: vi.fn().mockResolvedValue(approve) })

const saved = (extra: Record<string, unknown> = {}) => ({ id: 'c1', card: CARD, updatedAt: 100, ...extra }) as unknown as Character

beforeEach(() => {
  api.get.mockReset()
  api.update.mockReset().mockResolvedValue({})
  api.world.mockReset()
})

describe('characterTools', () => {
  it('lists a draft tool that only drafts and an edit tool that writes', () => {
    const [build, edit] = characterTools()
    expect([build.name, build.write]).toEqual([BUILD_CHARACTER, false])
    expect([edit.name, edit.write, edit.confirm]).toEqual([EDIT_CHARACTER_SECTION, true, undefined])
  })
})

describe('build_character', () => {
  it('needs a brief and known sections', async () => {
    expect((await runBuildCharacter({ name: BUILD_CHARACTER, arguments: {} }, ctx(client([])))).isError).toBe(true)
    const bad = await runBuildCharacter({ name: BUILD_CHARACTER, arguments: { brief: 'x', sections: 'voice, moods' } }, ctx(client([])))
    expect(bad.text).toMatch(/Unknown section: moods/)
  })

  it('returns a draft for the thread and saves nothing', async () => {
    const c = client([JSON.stringify(CARD), JSON.stringify({ verbalTics: ['hm.'], sfxWords: [] })])
    const out = await runBuildCharacter({ name: BUILD_CHARACTER, arguments: { brief: 'a blunt scientist', sections: 'voice' } }, ctx(c))
    expect(out.isError).toBe(false)
    expect(out.draft?.card.name).toBe('Mira')
    expect(out.draft?.extras?.voiceFingerprint?.verbalTics).toEqual(['hm.'])
    expect(out.text).toMatch(/Nothing is saved yet/)
    expect(api.update).not.toHaveBeenCalled()
  })

  it('names a section that failed instead of hiding it', async () => {
    const out = await runBuildCharacter({ name: BUILD_CHARACTER, arguments: { brief: 'x', sections: 'social' } }, ctx(client([JSON.stringify(CARD), 'nope', 'nope'])))
    expect(out.text).toMatch(/Failed: Connections & rules/)
    expect(out.draft?.failedStages).toEqual(['social'])
  })

  it('reports an unknown world', async () => {
    api.world.mockResolvedValue(undefined)
    expect((await runBuildCharacter({ name: BUILD_CHARACTER, arguments: { brief: 'x', world_id: 'w9' } }, ctx(client([])))).text).toMatch(/no world with id "w9"/)
  })
})

describe('edit_character_section', () => {
  const call = (section: string, instruction = 'make it shyer') => ({ name: EDIT_CHARACTER_SECTION, arguments: { id: 'c1', section, instruction } })

  it('rewrites only that section, after the user has seen before and after', async () => {
    api.get.mockResolvedValue(saved({ occupation: 'baker', likes: ['bread'] }))
    const c = client([JSON.stringify({ occupation: 'librarian', workplace: 'the library', homeLocation: '', frequentedLocations: [], likes: ['quiet'], goals: [], boundaries: [], loveLanguage: '' })])
    const k = ctx(c)
    const out = await runEditCharacterSection(call('profile'), k)
    expect(out.isError).toBe(false)
    expect(prompts(c)[0]).toContain('Current version of this section, to be rewritten:')
    expect(prompts(c)[0]).toContain('make it shyer')
    const shown = k.approve.mock.calls[0][0]
    expect(shown.detail).toContain('Before:\noccupation: "baker"')
    expect(shown.detail).toContain('After:\noccupation: "librarian"')
    const [id, body] = api.update.mock.calls[0]
    expect(id).toBe('c1')
    expect(body).toMatchObject({ occupation: 'librarian', likes: ['quiet'], ifUpdatedAt: 100 })
    expect(Object.keys(body)).not.toContain('card')
    expect(out.undo).toMatchObject({ characterId: 'c1', section: 'profile', before: { occupation: 'baker', likes: ['bread'], workplace: null } })
  })

  it('writes card fields into the card and leaves the rest of it alone', async () => {
    api.get.mockResolvedValue(saved())
    const c = client([JSON.stringify({ greetings: ['*Rain.* "Hello."', '*Dusk.* "Late again."'] })])
    await runEditCharacterSection(call('greetings'), ctx(c))
    expect(api.update.mock.calls[0][1].card).toEqual({ ...CARD, alternate_greetings: ['*Rain.* "Hello."', '*Dusk.* "Late again."'] })
  })

  it('changes nothing when the user declines', async () => {
    api.get.mockResolvedValue(saved())
    const out = await runEditCharacterSection(call('voice'), ctx(client([JSON.stringify({ verbalTics: ['hm.'] })]), false))
    expect(out.isError).toBe(true)
    expect(out.undo).toBeUndefined()
    expect(api.update).not.toHaveBeenCalled()
  })

  it('stops when the character changed while the section was being written', async () => {
    api.get.mockResolvedValue(saved())
    api.update.mockRejectedValue(Object.assign(new Error('stale'), { status: 409 }))
    const out = await runEditCharacterSection(call('voice'), ctx(client([JSON.stringify({ verbalTics: ['hm.'] })])))
    expect(out.isError).toBe(true)
    expect(out.text).toMatch(/was changed while this was being written/)
  })

  it('keeps the persona engine switch and decks the user set', async () => {
    api.get.mockResolvedValue(saved({ drive: { enabled: true, chaosBase: 0.3, energyBase: 2, fixations: ['old'], loves: [], boredBy: [], impulses: [{ id: 'i', line: 'x', weight: 1, cooldown: 5 }] } }))
    const c = client([JSON.stringify({ chaosBase: 0.1, energyBase: 7, fixations: ['the lamp'], loves: ['maps'], boredBy: ['small talk'] })])
    await runEditCharacterSection(call('drive'), ctx(c))
    expect(api.update.mock.calls[0][1].drive).toMatchObject({ enabled: true, chaosBase: 0.1, fixations: ['the lamp'], impulses: [{ id: 'i' }] })
  })

  it('leaves intimacy settings blank for a card that describes someone under 18', async () => {
    api.get.mockResolvedValue(saved({ card: { ...CARD, description: 'A 15-year-old with silver hair.' } }))
    const c = client([JSON.stringify({ likedKinks: ['praise'] })])
    const out = await runEditCharacterSection(call('intimacy'), ctx(c))
    expect(out.isError).toBe(true)
    expect(out.text).toMatch(/under 18/)
    expect(prompts(c)).toHaveLength(0)
    expect(api.update).not.toHaveBeenCalled()
  })

  it('takes hard limits only from the instruction', async () => {
    api.get.mockResolvedValue(saved())
    const c = client([JSON.stringify({ likedKinks: ['praise', 'bondage'] })])
    await runEditCharacterSection(call('intimacy', 'Hard limits: bondage.'), ctx(c))
    expect(api.update.mock.calls[0][1].kinkProfile).toEqual({ valence: { praise: 2 }, hardLimits: ['bondage'] })
  })

  it('rejects an unknown section, the core card and a missing character', async () => {
    expect((await runEditCharacterSection(call('card'), ctx(client([])))).text).toMatch(/update_character/)
    api.get.mockResolvedValue(undefined)
    expect((await runEditCharacterSection(call('voice'), ctx(client([])))).text).toMatch(/no character with id "c1"/)
  })
})
