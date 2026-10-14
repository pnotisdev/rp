import { describe, expect, it } from 'vitest'
import { agentContextBlock, withAgentContext } from './agentContext'

const now = new Date(2026, 9, 14, 12, 5)

describe('agent context', () => {
  it('always states the date', () => {
    expect(agentContextBlock({ now, notes: [] })).toMatch(/Right now it is .*14 October 2026/)
  })

  it('adds the workspace, notes and summary when present', () => {
    const block = agentContextBlock({ now, workspaceName: 'rp', notes: ['Prefers metric units.'], summary: 'We planned a trip.' })
    expect(block).toContain('workspace folder "rp"')
    expect(block).toContain('- Prefers metric units.')
    expect(block).toContain('We planned a trip.')
  })

  it('keeps only the newest notes', () => {
    const notes = Array.from({ length: 40 }, (_, i) => `note ${i}`)
    const block = agentContextBlock({ now, notes })
    expect(block).toContain('note 39')
    expect(block).not.toContain('note 5\n')
    expect(block.match(/^- note/gm)).toHaveLength(25)
  })

  it('appends to the base prompt', () => {
    expect(withAgentContext('Base.', { now, notes: [] }).startsWith('Base.\n\nRight now')).toBe(true)
  })
})
