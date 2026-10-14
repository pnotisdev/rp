import { describe, expect, it, vi } from 'vitest'
import { summarizeTurns, summaryIsStale, summaryPrompt } from './summary'
import type { ChatBackend } from '@/lib/api/chatBackend'

const turns = [
  { role: 'user' as const, text: 'Help me plan a trip to Kyoto.' },
  { role: 'assistant' as const, text: 'Sure. When are you going?' },
]

describe('summary', () => {
  it('asks to fold the turns into the earlier notes', () => {
    const p = summaryPrompt('User is planning a trip.', turns)
    expect(p).toContain('Notes so far:\nUser is planning a trip.')
    expect(p).toContain('User: Help me plan a trip to Kyoto.')
    expect(p).toContain('Assistant: Sure. When are you going?')
    expect(summaryPrompt(undefined, turns)).toContain('There are no notes yet.')
  })

  it('returns the trimmed, capped reply', async () => {
    const client = { generate: vi.fn().mockResolvedValue('  - Planning Kyoto trip.  '), generateStream: vi.fn() } as unknown as ChatBackend
    expect(await summarizeTurns(client, undefined, turns, { contextLength: 4096 })).toBe('- Planning Kyoto trip.')
    const long = { generate: vi.fn().mockResolvedValue('x'.repeat(5000)) } as unknown as ChatBackend
    expect((await summarizeTurns(long, undefined, turns, { contextLength: 4096 })).length).toBe(1800)
  })

  it('knows when the stored summary is behind', () => {
    expect(summaryIsStale(undefined, 0)).toBe(false)
    expect(summaryIsStale(undefined, 3)).toBe(true)
    expect(summaryIsStale({ covers: 3 }, 3)).toBe(false)
    expect(summaryIsStale({ covers: 3 }, 5)).toBe(true)
  })
})
