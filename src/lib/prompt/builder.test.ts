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

describe('buildPrompt — styleGuidance', () => {
  it('folds global writing-style guidance into the late, right-before-generation block', async () => {
    const result = await buildPrompt(baseInput({ styleGuidance: 'Never use em dashes (the — character) in your writing.' }))
    expect(result.prompt).toContain('Never use em dashes')
  })

  it('omits nothing extra when styleGuidance is unset', async () => {
    const result = await buildPrompt(baseInput())
    expect(result.prompt).not.toContain('em dash')
  })
})

describe("buildPrompt — Author's Note", () => {
  const history: ChatMessage[] = [
    { id: '1', role: 'user', name: 'You', text: 'FIRST_LINE' },
    { id: '2', role: 'char', name: 'Aria', text: 'SECOND_LINE' },
  ]

  it('places a before_char note ahead of the character identity block', async () => {
    const result = await buildPrompt(
      baseInput({
        character: character({ name: 'Aria', description: 'A cheerful bard.' }),
        authorNote: { text: 'NOTE_MARKER', position: 'before_char', depth: 0 },
      }),
    )
    expect(result.prompt).toContain('NOTE_MARKER')
    expect(result.prompt.indexOf('NOTE_MARKER')).toBeLessThan(result.prompt.indexOf('A cheerful bard.'))
  })

  it('places an after_char note after the card but before the history', async () => {
    const result = await buildPrompt(
      baseInput({
        character: character({ name: 'Aria', description: 'A cheerful bard.' }),
        history,
        authorNote: { text: 'NOTE_MARKER', position: 'after_char', depth: 0 },
      }),
    )
    const noteAt = result.prompt.indexOf('NOTE_MARKER')
    expect(noteAt).toBeGreaterThan(result.prompt.indexOf('A cheerful bard.'))
    expect(noteAt).toBeLessThan(result.prompt.indexOf('FIRST_LINE'))
  })

  it('injects an at_depth note (depth 0) after the latest message, before the generation cue', async () => {
    const result = await buildPrompt(
      baseInput({ history, authorNote: { text: 'NOTE_MARKER', position: 'at_depth', depth: 0 } }),
    )
    expect(result.prompt.indexOf('NOTE_MARKER')).toBeGreaterThan(result.prompt.indexOf('SECOND_LINE'))
    expect(result.prompt.trim().endsWith('Aria:')).toBe(true)
  })

  it('injects an at_depth note (depth 1) one message up from the latest', async () => {
    const result = await buildPrompt(
      baseInput({ history, authorNote: { text: 'NOTE_MARKER', position: 'at_depth', depth: 1 } }),
    )
    const noteAt = result.prompt.indexOf('NOTE_MARKER')
    expect(noteAt).toBeGreaterThan(result.prompt.indexOf('FIRST_LINE'))
    expect(noteAt).toBeLessThan(result.prompt.indexOf('SECOND_LINE'))
  })

  it('ignores a blank or unset note', async () => {
    const unset = await buildPrompt(baseInput({ history }))
    expect(unset.prompt).not.toContain('NOTE_MARKER')
    const blank = await buildPrompt(
      baseInput({ history, authorNote: { text: '   ', position: 'at_depth', depth: 0 } }),
    )
    expect(blank.prompt).not.toContain('NOTE_MARKER')
  })

  it('counts the at_depth note against the token budget', async () => {
    const withNote = await buildPrompt(
      baseInput({ history, authorNote: { text: 'NOTE_MARKER text here', position: 'at_depth', depth: 0 } }),
    )
    const without = await buildPrompt(baseInput({ history }))
    expect(withNote.tokensUsed).toBeGreaterThan(without.tokensUsed)
  })
})

describe('buildPrompt — regex scripts (prompt target)', () => {
  const history: ChatMessage[] = [
    { id: '1', role: 'user', name: 'You', text: 'the WIDGET is here' },
    { id: '2', role: 'char', name: 'Aria', text: 'yes the WIDGET' },
  ]

  it('rewrites history turn text before it reaches the prompt', async () => {
    const result = await buildPrompt(
      baseInput({
        history,
        regexScripts: [{ id: '1', name: 'x', find: 'WIDGET', replace: 'gadget', target: 'prompt', enabled: true }],
      }),
    )
    expect(result.prompt).toContain('the gadget is here')
    expect(result.prompt).not.toContain('WIDGET')
  })

  it('leaves history untouched for a display-only script', async () => {
    const result = await buildPrompt(
      baseInput({
        history,
        regexScripts: [{ id: '1', name: 'x', find: 'WIDGET', replace: 'gadget', target: 'display', enabled: true }],
      }),
    )
    expect(result.prompt).toContain('the WIDGET is here')
  })
})

describe('buildPrompt — promptSections (section 13 instruct-template-manager part c)', () => {
  it('includes every section by default when promptSections is unset, same as before this option existed', async () => {
    const result = await buildPrompt(
      baseInput({
        character: character({ name: 'Aria', description: 'A cheerful bard.', mes_example: 'EXAMPLE_LINE' }),
        personaDescription: 'A curious traveler.',
        chatSummary: 'SUMMARY_LINE',
        worldDescription: 'WORLD_LINE',
        participants: [{ name: 'Kestrel' }],
      }),
    )
    expect(result.prompt).toContain('You are Aria.')
    expect(result.prompt).toContain('A cheerful bard.')
    expect(result.prompt).toContain('SUMMARY_LINE')
    expect(result.prompt).toContain('WORLD_LINE')
    expect(result.prompt).toContain('About You')
    expect(result.prompt).toContain('Also present in this scene')
    expect(result.prompt).toContain('EXAMPLE_LINE')
  })

  it('omits exactly the disabled sections and leaves the rest untouched', async () => {
    const result = await buildPrompt(
      baseInput({
        character: character({ name: 'Aria', description: 'A cheerful bard.', mes_example: 'EXAMPLE_LINE' }),
        personaDescription: 'A curious traveler.',
        chatSummary: 'SUMMARY_LINE',
        worldDescription: 'WORLD_LINE',
        promptSections: { summary: false, world: false, examples: false },
      }),
    )
    expect(result.prompt).not.toContain('SUMMARY_LINE')
    expect(result.prompt).not.toContain('WORLD_LINE')
    expect(result.prompt).not.toContain('EXAMPLE_LINE')
    // Untouched sections still present.
    expect(result.prompt).toContain('A cheerful bard.')
    expect(result.prompt).toContain('About You')
  })

  it('turning off the description section still lets the generic system line and history through', async () => {
    const result = await buildPrompt(
      baseInput({
        character: character({ name: 'Aria', description: 'A cheerful bard.' }),
        promptSections: { description: false },
      }),
    )
    expect(result.prompt).toContain('You are Aria.')
    expect(result.prompt).not.toContain('A cheerful bard.')
  })

  it('turning off the system section drops the generic identity line entirely', async () => {
    const result = await buildPrompt(baseInput({ promptSections: { system: false } }))
    expect(result.prompt).not.toContain('You are Aria.')
  })

  it('turning off persona drops the "About {{user}}" line', async () => {
    const result = await buildPrompt(
      baseInput({ personaDescription: 'A curious traveler.', promptSections: { persona: false } }),
    )
    expect(result.prompt).not.toContain('About You')
    expect(result.prompt).not.toContain('A curious traveler.')
  })

  it('turning off participants drops the roster even when other characters are present', async () => {
    const result = await buildPrompt(
      baseInput({ participants: [{ name: 'Kestrel' }], promptSections: { participants: false } }),
    )
    expect(result.prompt).not.toContain('Also present in this scene')
  })
})
