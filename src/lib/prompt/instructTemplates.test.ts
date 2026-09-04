import { describe, expect, it } from 'vitest'
import {
  BUILTIN_INSTRUCT_TEMPLATES,
  detectInstructTemplateId,
  getInstructTemplate,
  resolveInstructTemplate,
} from './instructTemplates'

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

describe('builtin coverage', () => {
  it('ships gemma and llama3 alongside the originals', () => {
    const ids = BUILTIN_INSTRUCT_TEMPLATES.map((t) => t.id)
    expect(ids).toEqual(expect.arrayContaining(['plain-chat', 'alpaca', 'vicuna', 'chatml', 'mistral', 'gemma', 'llama3']))
  })

  it('every structured builtin carries a stop sequence for its own turn marker', () => {
    for (const id of ['alpaca', 'vicuna', 'chatml', 'mistral', 'gemma', 'llama3']) {
      expect(getInstructTemplate(id).stopSequences.length).toBeGreaterThan(0)
    }
  })
})

describe('detectInstructTemplateId', () => {
  it('reads Gemma from a start_of_turn template', () => {
    expect(detectInstructTemplateId('{{ bos_token }}{% for message in messages %}{{ "<start_of_turn>" + role }}')).toBe('gemma')
  })

  it('reads Gemma from the real KoboldCpp /props comment header', () => {
    expect(detectInstructTemplateId('{#\n  Template: Google Gemma 4 Canonical Chat Template\n#}\n{%- macro ...')).toBe('gemma')
  })

  it('reads ChatML, Llama 3, Mistral, Alpaca, Vicuna', () => {
    expect(detectInstructTemplateId('<|im_start|>system')).toBe('chatml')
    expect(detectInstructTemplateId('<|start_header_id|>system<|end_header_id|>')).toBe('llama3')
    expect(detectInstructTemplateId("{{ '[INST] ' + message['content'] + ' [/INST]' }}")).toBe('mistral')
    expect(detectInstructTemplateId('### Instruction:\n{{ prompt }}')).toBe('alpaca')
    expect(detectInstructTemplateId('A chat.\nUSER: hi\nASSISTANT: ')).toBe('vicuna')
  })

  it('returns null for an empty, missing, or unrecognised template', () => {
    expect(detectInstructTemplateId(null)).toBeNull()
    expect(detectInstructTemplateId(undefined)).toBeNull()
    expect(detectInstructTemplateId('')).toBeNull()
    expect(detectInstructTemplateId('something bespoke with no known markers')).toBeNull()
  })
})
