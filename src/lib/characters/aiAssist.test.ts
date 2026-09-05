import { describe, expect, it, vi } from 'vitest'
import { draftCharacterFromPortrait } from './aiAssist'
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
