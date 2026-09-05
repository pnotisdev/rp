import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { draftCharacterFromPortrait, regenerateCardField, suggestLoreEntries } from './aiAssist'
import type { ChatBackend } from '@/lib/api/chatBackend'

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

const CHARACTER = { name: 'Mira', description: 'A tall scientist.', personality: 'Blunt.', scenario: '', first_mes: '', mes_example: '' } as never

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

describe('regenerateCardField', () => {
  it('returns the rewritten field, trimmed', async () => {
    const client = mockClient('  A tall woman with short silver hair.  ')
    const text = await regenerateCardField(client, CHARACTER, 'description')
    expect(text).toBe('A tall woman with short silver hair.')
  })

  it('includes the requested field label and any hint in the prompt', async () => {
    const client = mockClient('text')
    await regenerateCardField(client, CHARACTER, 'personality', 'Make her warmer')
    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.prompt).toContain('Personality')
    expect(call.prompt).toContain('Make her warmer')
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
