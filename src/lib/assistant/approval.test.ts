import { describe, expect, it } from 'vitest'
import { alwaysAsk, describeToolCall } from './approval'

describe('describeToolCall', () => {
  it('shows an edit as a before/after', () => {
    const p = describeToolCall({ name: 'edit_file', arguments: { path: 'a.ts', old_text: 'one\ntwo', new_text: 'three' } })
    expect(p.title).toBe('Edit a.ts?')
    expect(p.detail).toBe('- one\n- two\n+ three')
  })

  it('names the file for writes and whether it replaces', () => {
    expect(describeToolCall({ name: 'write_file', arguments: { path: 'n.md', content: 'hi' } })).toMatchObject({ title: 'Create n.md?', detail: 'hi' })
    expect(describeToolCall({ name: 'write_file', arguments: { path: 'n.md', content: 'hi', overwrite: true } }).title).toBe('Replace n.md?')
  })

  it('shows the exact command', () => {
    expect(describeToolCall({ name: 'run_command', arguments: { command: 'npm test' } })).toMatchObject({ detail: 'npm test', confirmLabel: 'Run command' })
  })

  it('cuts very long content and falls back to the raw arguments', () => {
    expect(describeToolCall({ name: 'write_file', arguments: { path: 'x', content: 'z'.repeat(5000) } }).detail).toContain('more characters')
    expect(describeToolCall({ name: 'weird', arguments: { a: 1 } }).detail).toContain('"a": 1')
  })

  it('never auto-approves commands', () => {
    expect(alwaysAsk('run_command')).toBe(true)
    expect(alwaysAsk('edit_file')).toBe(false)
  })
})
