import { describe, expect, it } from 'vitest'
import {
  BUILTIN_INSTRUCT_TEMPLATES,
  detectInstructTemplateId,
  getInstructTemplate,
  resolveInstructTemplate,
  wrapAssistPrompt,
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

describe('SillyTavern coverage', () => {
  const ids = BUILTIN_INSTRUCT_TEMPLATES.map((t) => t.id)

  it('ships a template for every SillyTavern instruct preset it has a distinct format for', () => {
    expect(ids).toEqual(
      expect.arrayContaining(['llama4', 'llama3-names', 'chatml-names', 'glm4', 'harmony', 'harmony-thinking', 'kimi-k2', 'tulu', 'dots1', 'mistral-v3-tekken', 'mistral-v7-tekken', 'llama2', 'koala', 'vicuna-1-0', 'wizardlm', 'synthia', 'openorca-openchat', 'lightning', 'libra', 'koboldcpp-adapter']),
    )
  })

  it('has unique ids, and a stop sequence for every template that marks its turns', () => {
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of BUILTIN_INSTRUCT_TEMPLATES) {
      if (!['plain-chat', 'koboldcpp-adapter'].includes(t.id)) expect(t.stopSequences.length, t.id).toBeGreaterThan(0)
    }
  })

  it('writes the exact turn markers of the formats that changed most recently', () => {
    expect(getInstructTemplate('llama4').userPrefix).toBe('<|header_start|>user<|header_end|>\n\n{name}: ')
    expect(getInstructTemplate('kimi-k2').assistantPrefix).toBe('<|im_assistant|>assistant<|im_middle|>{name}: ')
    expect(getInstructTemplate('glm4').systemPrefix).toBe('[gMASK]<sop><|system|>\n')
    expect(getInstructTemplate('harmony').assistantPrefix).toBe('<|start|>assistant<|channel|>final<|message|>{name}: ')
  })

  it('lets a thinking Harmony model open its own channel, and does not stop on the channel switch', () => {
    const t = getInstructTemplate('harmony-thinking')
    expect(t.assistantCuePrefix).toBe('<|start|>assistant')
    expect(t.stopSequences).not.toContain('<|start|>')
    expect(wrapAssistPrompt('x', t)).toBe('<|start|>system<|message|>x<|end|><|start|>assistant')
  })

  it('wraps a judge prompt for a template that puts the name in the turn header', () => {
    expect(wrapAssistPrompt('x', getInstructTemplate('chatml-names'))).toBe('<|im_start|>system\nx<|im_end|>\n<|im_start|>assistant\n')
  })
})

describe('detectInstructTemplateId', () => {
  it('reads the newer formats from their markers', () => {
    expect(detectInstructTemplateId('<|header_start|>user<|header_end|>')).toBe('llama4')
    expect(detectInstructTemplateId('<|start|>assistant<|channel|>final<|message|>')).toBe('harmony')
    expect(detectInstructTemplateId('<|im_user|>user<|im_middle|>')).toBe('kimi-k2')
    expect(detectInstructTemplateId('[gMASK]<sop><|user|>')).toBe('glm4')
    expect(detectInstructTemplateId('<|userprompt|>hi<|endofuserprompt|>')).toBe('dots1')
    expect(detectInstructTemplateId('<|user|>\nhi\n<|assistant|>\n')).toBe('tulu')
    expect(detectInstructTemplateId('[INST] <<SYS>>\nx\n<</SYS>>')).toBe('llama2')
  })

  it('still reads Phi and Metharme, which share the Tulu markers', () => {
    expect(detectInstructTemplateId('<|user|>hi<|end|><|assistant|>')).toBe('phi')
    expect(detectInstructTemplateId('<|user|>hi<|model|>')).toBe('metharme')
  })

  it('reads Gemma from a start_of_turn template', () => {
    expect(detectInstructTemplateId('{{ bos_token }}{% for message in messages %}{{ "<start_of_turn>" + role }}')).toBe('gemma')
  })

  it('reads Gemma 4 from the real KoboldCpp /props comment header', () => {
    expect(detectInstructTemplateId('{#\n  Template: Google Gemma 4 Canonical Chat Template\n#}\n{%- macro ...')).toBe('gemma4')
  })

  it('reads Gemma 4 from its <|turn> markers, ahead of the older Gemma check', () => {
    expect(detectInstructTemplateId("{{- bos_token -}}{{- '<|turn>system\n' -}}{{- '<turn|>\n' -}}")).toBe('gemma4')
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

describe('wrapAssistPrompt', () => {
  // rp#7: a background judge call (relationship tracker, objectives, ...) used to send its raw prompt straight to KoboldCpp's…
  it('wraps the prompt in Gemma turn markers, ending with the model turn open and no fake name', () => {
    const gemma = getInstructTemplate('gemma')
    const wrapped = wrapAssistPrompt('Return ONLY JSON.\n\nJSON:', gemma)
    expect(wrapped).toBe('<start_of_turn>user\nReturn ONLY JSON.\n\nJSON:<end_of_turn>\n<start_of_turn>model\n')
  })

  it('wraps for Gemma 4 with its empty thought channel already closed, so the model skips straight to the answer', () => {
    const wrapped = wrapAssistPrompt('Return ONLY JSON.', getInstructTemplate('gemma4'))
    expect(wrapped).toBe('<|turn>system\nReturn ONLY JSON.<turn|>\n<|turn>model\n<|channel>thought\n<channel|>')
  })

  it('is a no-op (beyond a trailing newline) for plain-chat, same as the main reply path', () => {
    const plainChat = getInstructTemplate('plain-chat')
    expect(wrapAssistPrompt('Return ONLY JSON.', plainChat)).toBe('Return ONLY JSON.\n')
  })

  it('never leaves the {name} placeholder unexpanded, for every builtin template', () => {
    for (const template of BUILTIN_INSTRUCT_TEMPLATES) {
      expect(wrapAssistPrompt('x', template)).not.toContain('{name}')
    }
  })
})
