import { describe, expect, it } from 'vitest'
import { buildPrompt, type ChatMessage, type PromptBuildInput } from './builder'
import { getInstructTemplate } from './instructTemplates'
import type { CharacterCardData } from '@/lib/characters/cardSpec'

const template = getInstructTemplate('plain-chat') // {name}-prefixed turns, so speaker names are visible in output

function character(overrides: Partial<CharacterCardData> & { name: string }): CharacterCardData {
  return {
    description: '',
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    ...overrides,
  }
}

function baseInput(overrides: Partial<PromptBuildInput> = {}): PromptBuildInput {
  return {
    character: character({ name: 'Aria' }),
    personaName: 'You',
    personaDescription: '',
    history: [],
    lorebooks: [],
    template,
    contextBudget: 4000,
    scanDepth: 8,
    countTokens: async (text: string) => Math.ceil(text.length / 4),
    ...overrides,
  }
}

describe('buildPrompt — group chat (multiple speaking characters)', () => {
  it('renders each historical turn under its own speaker name, not always the active character', async () => {
    const history: ChatMessage[] = [
      { id: '1', role: 'user', name: 'You', text: 'Hello everyone.' },
      { id: '2', role: 'char', name: 'Aria', text: 'Hey there!' },
      { id: '3', role: 'user', name: 'You', text: 'Kestrel, say hi.' },
      { id: '4', role: 'char', name: 'Kestrel', text: 'Hm.' },
    ]
    // Kestrel is the active speaker for this turn (their card is `character`), but Aria's earlier
    // line must still be attributed to Aria in the rendered history, not silently relabeled.
    const result = await buildPrompt(baseInput({ character: character({ name: 'Kestrel' }), history }))
    expect(result.prompt).toContain('Aria: Hey there!')
    expect(result.prompt).toContain('Kestrel: Hm.')
  })

  it('lists other scene participants as a compact roster, separate from the active character block', async () => {
    const result = await buildPrompt(
      baseInput({
        character: character({ name: 'Kestrel', description: 'A stoic ranger.', personality: 'Guarded.' }),
        participants: [{ name: 'Aria', description: 'A cheerful bard.', personality: 'Playful.' }],
      }),
    )
    expect(result.prompt).toContain('You are Kestrel.')
    expect(result.prompt).toContain('A stoic ranger.')
    expect(result.prompt).toContain('Also present in this scene:')
    expect(result.prompt).toContain('- Aria: A cheerful bard. Personality: Playful.')
  })

  it('omits the roster block entirely for an ordinary single-character chat', async () => {
    const result = await buildPrompt(baseInput())
    expect(result.prompt).not.toContain('Also present in this scene')
  })

  it('uses nextSpeakerName for the generation cue instead of always the active character\'s own name', async () => {
    const result = await buildPrompt(baseInput({ nextSpeakerName: 'Kestrel' }))
    // The generation cue is the final line of the prompt — it should prompt for Kestrel's turn.
    expect(result.prompt.trim().endsWith('Kestrel:')).toBe(true)
  })

  it('falls back to the active character\'s own name when nextSpeakerName is unset (ordinary chats)', async () => {
    const result = await buildPrompt(baseInput())
    expect(result.prompt.trim().endsWith('Aria:')).toBe(true)
  })
})

describe('buildPrompt — characterProfile (10e life-context fields)', () => {
  it('folds the pre-built profile note into the identity block when set', async () => {
    const result = await buildPrompt(
      baseInput({ characterProfile: 'Life beyond this scene: Works as a librarian at Sakura Hill University.' }),
    )
    expect(result.prompt).toContain('Life beyond this scene: Works as a librarian at Sakura Hill University.')
  })

  it('omits nothing extra when characterProfile is unset', async () => {
    const result = await buildPrompt(baseInput())
    expect(result.prompt).not.toContain('Life beyond this scene')
  })
})
