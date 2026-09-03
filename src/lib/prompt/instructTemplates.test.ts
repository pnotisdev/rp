import { describe, expect, it } from 'vitest'
import { BUILTIN_INSTRUCT_TEMPLATES, getInstructTemplate, resolveInstructTemplate } from './instructTemplates'

describe('resolveInstructTemplate', () => {
  it('resolves a builtin id with no custom templates given', () => {
    expect(resolveInstructTemplate('chatml').id).toBe('chatml')
  })

  it('prefers a custom template over a builtin with the same id', () => {
    const overridden = { ...getInstructTemplate('alpaca'), id: 'alpaca', name: 'My Alpaca', userPrefix: '### Q:\n' }
    expect(resolveInstructTemplate('alpaca', [overridden]).userPrefix).toBe('### Q:\n')
  })

  it('finds a custom template with its own id, not shadowed by any builtin', () => {
    const custom = { ...getInstructTemplate('vicuna'), id: 'my-custom-id', name: 'Custom' }
    expect(resolveInstructTemplate('my-custom-id', [custom]).name).toBe('Custom')
  })

  it('falls back to the first builtin for an unknown id', () => {
    expect(resolveInstructTemplate('does-not-exist', []).id).toBe(BUILTIN_INSTRUCT_TEMPLATES[0].id)
  })

  it('falls back to the first builtin when no custom templates are given at all', () => {
    expect(resolveInstructTemplate('does-not-exist').id).toBe(BUILTIN_INSTRUCT_TEMPLATES[0].id)
  })
})
