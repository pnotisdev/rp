import { describe, expect, it } from 'vitest'
import { promptTurnsOf, type AssistantMessage } from './thread'

const msg = (over: Partial<AssistantMessage>): AssistantMessage => ({ id: 'x', role: 'user', text: '', createdAt: 0, ...over })

describe('promptTurnsOf', () => {
  it('notes attached pictures in the text', () => {
    const turns = promptTurnsOf([msg({ text: 'what is this?', images: ['data:image/png;base64,AA', 'data:image/png;base64,BB'] }), msg({ text: '', images: ['data:image/png;base64,AA'] })])
    expect(turns[0].text).toBe('what is this?\n[attached 2 pictures]')
    expect(turns[1].text).toBe('[attached 1 picture]')
  })

  it('drops failed and empty turns', () => {
    expect(promptTurnsOf([msg({ text: 'a', error: 'boom' }), msg({ text: '   ' }), msg({ role: 'assistant', text: 'ok' })])).toEqual([{ role: 'assistant', text: 'ok' }])
  })

  it('turns a tool message into a call and its result, shortening old results', () => {
    const tool = (text: string): AssistantMessage => msg({ role: 'assistant', tool: { name: 'read_file', arguments: { path: 'a' }, result: text, isError: false } })
    const long = 'y'.repeat(3000)
    const old = promptTurnsOf([tool(long), ...Array.from({ length: 9 }, () => msg({ text: 'next' }))])
    expect(old[1].text.length).toBeLessThan(700)
    const recent = promptTurnsOf([tool(long), msg({ text: 'next' })])
    expect(recent[1].text.length).toBeGreaterThan(3000)
    expect(recent[0].text).toContain('"read_file"')
  })
})
