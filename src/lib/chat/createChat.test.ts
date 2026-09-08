import { describe, expect, it, vi } from 'vitest'
import type { Character, CharacterCardData } from '@/lib/characters/cardSpec'
import type { WorldCard } from '@/lib/types'

// `createChat` writes through `chatsApi`/`messagesApi` — stubbed so these tests only exercise its
// own resolution logic (mode/assistOverrides), not the real HTTP layer.
vi.mock('@/lib/api/client', () => ({
  chatsApi: {
    create: vi.fn(async (input: unknown) => ({ id: 'chat-1', createdAt: 0, updatedAt: 0, ...(input as object) })),
    update: vi.fn(),
  },
  messagesApi: { create: vi.fn(async (input: unknown) => ({ id: 'msg-1', ...(input as object) })), update: vi.fn() },
}))

import { availableGreetings, createChat } from './createChat'
import { chatsApi } from '@/lib/api/client'

/** The most recent `chatsApi.update` payload, or undefined if it was never called. */
function lastUpdatePayload(): { scene?: { location?: string | null } } | undefined {
  const calls = vi.mocked(chatsApi.update).mock.calls
  return calls.length ? (calls[calls.length - 1][1] as { scene?: { location?: string | null } }) : undefined
}

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

function world(overrides: Partial<WorldCard> = {}): WorldCard {
  return {
    id: 'world-1',
    name: 'Test World',
    description: '',
    lorebook: { name: '', entries: [], token_budget: 512, scan_depth: 8 },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

/** The payload `createChat` most recently handed to `chatsApi.create`. */
function lastCreatePayload(): { mode?: string; assistOverrides?: object } {
  const calls = vi.mocked(chatsApi.create).mock.calls
  return calls[calls.length - 1][0] as { mode?: string; assistOverrides?: object }
}

describe('createChat: mode resolution', () => {
  it('writes the explicit mode, overriding the bound world template', async () => {
    await createChat({
      character: character(),
      world: world({ template: 'dating_sim' }),
      personaId: '',
      mode: 'freeform',
    })
    const payload = lastCreatePayload()
    expect(payload.mode).toBe('freeform')
    // Freeform disables the relationship assists (and its other romance-flavored bundling) even
    // though the bound world's own template (dating_sim) wouldn't.
    expect(payload.assistOverrides).toEqual({
      autoTrackRelationship: false,
      autoSuggestChoices: false,
      slowBurnPacing: false,
      showIntentChips: false,
      showDateEventButton: false,
      systemPromptId: 'balanced',
    })
  })

  it("falls back to the bound world's template when no mode is given", async () => {
    await createChat({
      character: character(),
      world: world({ template: 'freeform' }),
      personaId: '',
    })
    expect(lastCreatePayload().mode).toBe('freeform')
  })

  it("normalizes a bound world's retired template id (from before Slice of Life merged into Freeform) to its live replacement", async () => {
    await createChat({
      character: character(),
      world: world({ template: 'slice_of_life' as never }),
      personaId: '',
    })
    expect(lastCreatePayload().mode).toBe('freeform')
  })

  it("falls back to 'dating_sim' when there's neither an explicit mode nor a bound world", async () => {
    await createChat({ character: character(), world: undefined, personaId: '' })
    expect(lastCreatePayload().mode).toBe('dating_sim')
  })
})

describe('createChat: scene location seeding', () => {
  it("seeds Chat.scene.location from the greeting's detected background, with no client needed", async () => {
    vi.mocked(chatsApi.update).mockClear()
    await createChat({
      character: character({ first_mes: "*The library's second floor is cold enough that the windows have fogged.*" }),
      world: undefined,
      personaId: '',
      personaName: 'Kai',
    })
    expect(lastUpdatePayload()?.scene?.location).toBe('Library')
  })

  it('leaves the scene unset when the greeting matches no known background', async () => {
    vi.mocked(chatsApi.update).mockClear()
    await createChat({
      character: character({ first_mes: '*She looks up from whatever she was scribbling.* "Oh. You."' }),
      world: undefined,
      personaId: '',
      personaName: 'Kai',
    })
    expect(lastUpdatePayload()).toBeUndefined()
  })
})

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
