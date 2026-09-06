import { describe, expect, it, vi, type Mock } from 'vitest'
import { summarizeMessages } from './summarize'
import type { ChatMessage } from './builder'

const MESSAGES: ChatMessage[] = [
  { id: '1', role: 'char', name: 'Rin', text: '"Well, it\'s not like I missed you or anything." *She looks away.*' },
]

interface TestInput extends Omit<Parameters<typeof summarizeMessages>[0], 'generate'> {
  generate: Mock
}

function baseInput(overrides: Partial<TestInput> = {}): TestInput {
  return {
    existingSummary: '',
    messages: MESSAGES,
    charName: 'Rin',
    userName: 'You',
    generate: vi.fn(async () => 'Updated memory.'),
    ...overrides,
  }
}

describe('summarizeMessages', () => {
  it('builds a prompt with no voice-retention instruction when no fingerprint is passed', async () => {
    const input = baseInput()
    await summarizeMessages(input)
    const prompt = input.generate.mock.calls[0][0] as string
    expect(prompt).not.toContain('distinctive voice worth protecting')
  })

  it('builds a prompt with no voice-retention instruction for an empty fingerprint object', async () => {
    const input = baseInput({ voiceFingerprint: {} })
    await summarizeMessages(input)
    const prompt = input.generate.mock.calls[0][0] as string
    expect(prompt).not.toContain('distinctive voice worth protecting')
  })

  it('adds a voice-retention instruction naming the character and a concrete example when a fingerprint has catchphrases', async () => {
    const input = baseInput({ voiceFingerprint: { catchphrases: ["it's not like i"], verbalTics: ['well'] } })
    await summarizeMessages(input)
    const prompt = input.generate.mock.calls[0][0] as string
    expect(prompt).toContain('Rin has a distinctive voice worth protecting')
    expect(prompt).toContain(`"it's not like i"`)
    expect(prompt).toContain('keep a brief exact quote')
  })

  it('falls back to a verbal tic as the named example when there is no catchphrase', async () => {
    const input = baseInput({ voiceFingerprint: { verbalTics: ['hmph'] } })
    await summarizeMessages(input)
    const prompt = input.generate.mock.calls[0][0] as string
    expect(prompt).toContain('"hmph"')
  })

  it('still adds the instruction (without a named example) when only dialect/register notes are set', async () => {
    const input = baseInput({ voiceFingerprint: { dialectNotes: 'never swears, even when hurt' } })
    await summarizeMessages(input)
    const prompt = input.generate.mock.calls[0][0] as string
    expect(prompt).toContain('distinctive voice worth protecting')
    expect(prompt).not.toContain('(something like')
  })

  it('keeps the existing length/no-em-dash/no-invention instructions intact alongside the new one', async () => {
    const input = baseInput({ voiceFingerprint: { catchphrases: ['you are impossible'] }, detail: 'detailed' })
    await summarizeMessages(input)
    const prompt = input.generate.mock.calls[0][0] as string
    expect(prompt).toContain('no em dashes')
    expect(prompt).toContain('under 450 words')
    expect(prompt).toContain("Do not invent anything that didn't happen above.")
  })

  it('trims and returns the generated result', async () => {
    const input = baseInput()
    input.generate = vi.fn(async () => '  Trimmed memory.  \n')
    const result = await summarizeMessages(input)
    expect(result).toBe('Trimmed memory.')
  })
})
