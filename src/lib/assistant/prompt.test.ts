import { describe, expect, it } from 'vitest'
import { assistantStopSequences, ASSISTANT_SYSTEM_PROMPT, buildAssistantPrompt, type AssistantTurn } from './prompt'
import { getInstructTemplate } from '@/lib/prompt/instructTemplates'

const template = getInstructTemplate('chatml')
const turn = (role: AssistantTurn['role'], text: string): AssistantTurn => ({ role, text })

/** One token per character, so budgets in these tests are counted in characters. */
const perChar = (text: string) => text.length

describe('buildAssistantPrompt', () => {
  it('renders the system block and both roles in the template\'s own turn format', () => {
    const { prompt } = buildAssistantPrompt({
      turns: [turn('user', 'What is a monad?'), turn('assistant', 'A monoid in the category of endofunctors.')],
      template,
      contextBudget: 4000,
    })
    expect(prompt).toContain(template.systemPrefix)
    // The prefix as it actually lands, with `{name}` resolved to the role.
    expect(prompt).toContain(template.userPrefix.replace(/\{name\}/g, 'User'))
    expect(prompt).toContain('What is a monad?')
    expect(prompt).toContain('A monoid in the category of endofunctors.')
  })

  it('carries the default instruction, which says it is not a character', () => {
    const { prompt } = buildAssistantPrompt({ turns: [turn('user', 'hi')], template, contextBudget: 4000 })
    expect(prompt).toContain(ASSISTANT_SYSTEM_PROMPT)
    expect(prompt).toContain('not a character')
  })

  it('uses a custom system prompt instead of the default when one is set', () => {
    const { prompt } = buildAssistantPrompt({
      turns: [turn('user', 'hi')],
      template,
      systemPrompt: 'You answer only in haiku.',
      contextBudget: 4000,
    })
    expect(prompt).toContain('You answer only in haiku.')
    expect(prompt).not.toContain(ASSISTANT_SYSTEM_PROMPT)
  })

  it('appends the writing-style setting to the system block', () => {
    const { prompt } = buildAssistantPrompt({
      turns: [turn('user', 'hi')],
      template,
      styleGuidance: 'British spelling throughout.',
      contextBudget: 4000,
    })
    expect(prompt).toContain('British spelling throughout.')
  })

  it('ends on an open assistant prefix, so the model writes the reply and nothing else', () => {
    const { prompt } = buildAssistantPrompt({ turns: [turn('user', 'hi')], template, contextBudget: 4000 })
    expect(prompt.endsWith(template.assistantPrefix.replace(/\{name\}/g, 'Assistant'))).toBe(true)
  })

  it('never leaves a {name} macro in the prompt', () => {
    const named = getInstructTemplate('plain-chat')
    const { prompt } = buildAssistantPrompt({
      turns: [turn('user', 'hi'), turn('assistant', 'hello')],
      template: named,
      contextBudget: 4000,
    })
    expect(prompt).not.toContain('{name}')
  })

  it('drops the oldest turns to fit the budget, keeping the newest', () => {
    const turns = [
      turn('user', 'A'.repeat(200)),
      turn('assistant', 'B'.repeat(200)),
      turn('user', 'C'.repeat(200)),
    ]
    const { prompt, usedTurns } = buildAssistantPrompt({ turns, template, contextBudget: 900, estimate: perChar })
    expect(usedTurns).toBeLessThan(3)
    expect(prompt).toContain('C'.repeat(200))
    expect(prompt).not.toContain('A'.repeat(200))
  })

  it('drops whole turns only, never half of one', () => {
    const turns = [turn('user', 'A'.repeat(500)), turn('assistant', 'B'.repeat(20)), turn('user', 'C'.repeat(20))]
    const { prompt } = buildAssistantPrompt({ turns, template, contextBudget: 400, estimate: perChar })
    // Either the whole long turn is present or none of it — a truncated turn would teach the model a
    // malformed turn format, which costs more than the lost context.
    expect(prompt.includes('A'.repeat(500)) || !prompt.includes('AAAA')).toBe(true)
  })

  it('keeps the newest turn even when it alone blows the budget — a prompt without the question is useless', () => {
    const { prompt, usedTurns } = buildAssistantPrompt({
      turns: [turn('user', 'Z'.repeat(5000))],
      template,
      contextBudget: 10,
      estimate: perChar,
    })
    expect(usedTurns).toBe(1)
    expect(prompt).toContain('Z'.repeat(5000))
  })

  it('handles an empty thread without producing a malformed prompt', () => {
    const { prompt, usedTurns } = buildAssistantPrompt({ turns: [], template, contextBudget: 4000 })
    expect(usedTurns).toBe(0)
    expect(prompt).toContain(ASSISTANT_SYSTEM_PROMPT)
  })
})

describe('assistantStopSequences', () => {
  it("includes the template's own stops plus the user prefix, so a reply can't write the next question", () => {
    const stops = assistantStopSequences(template)
    for (const own of template.stopSequences) expect(stops).toContain(own)
    expect(stops.some((s) => s.includes('user'))).toBe(true)
  })

  it('de-duplicates, and never emits an empty stop that would halt generation instantly', () => {
    const stops = assistantStopSequences(template)
    expect(new Set(stops).size).toBe(stops.length)
    expect(stops).not.toContain('')
  })
})
