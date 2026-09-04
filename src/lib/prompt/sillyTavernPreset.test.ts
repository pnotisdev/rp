import { describe, expect, it } from 'vitest'
import { parseSillyTavernPreset } from './sillyTavernPreset'

const CHATML = {
  input_sequence: '<|im_start|>user',
  output_sequence: '<|im_start|>assistant',
  system_sequence: '<|im_start|>system',
  stop_sequence: '<|im_end|>',
  wrap: true,
  names_behavior: 'force',
  output_suffix: '<|im_end|>\n',
  input_suffix: '<|im_end|>\n',
  system_suffix: '<|im_end|>\n',
  story_string_prefix: '<|im_start|>system',
  story_string_suffix: '<|im_end|>\n',
  name: 'ChatML',
}

const GEMMA = {
  input_sequence: '<start_of_turn>user',
  output_sequence: '<start_of_turn>model',
  system_sequence: '<start_of_turn>system',
  stop_sequence: '<end_of_turn>',
  wrap: true,
  names_behavior: 'force',
  output_suffix: '<end_of_turn>\n',
  input_suffix: '<end_of_turn>\n',
  story_string_prefix: '<start_of_turn>user',
  story_string_suffix: '<end_of_turn>\n',
  name: 'Gemma 2',
}

const CHATML_NAMES = {
  input_sequence: '<|im_start|>{{name}}',
  output_sequence: '<|im_start|>{{name}}',
  stop_sequence: '<|im_end|>',
  wrap: true,
  names_behavior: 'none',
  output_suffix: '<|im_end|>\n',
  input_suffix: '<|im_end|>\n',
  name: 'ChatML-Names',
}

describe('parseSillyTavernPreset — instruct', () => {
  it('converts a wrapped, force-names ChatML preset', () => {
    const r = parseSillyTavernPreset(CHATML)
    expect(r?.kind).toBe('instruct')
    if (r?.kind !== 'instruct') return
    expect(r.template.userPrefix).toBe('<|im_start|>user\n{name}: ')
    expect(r.template.assistantPrefix).toBe('<|im_start|>assistant\n{name}: ')
    expect(r.template.userSuffix).toBe('<|im_end|>\n')
    expect(r.template.systemPrefix).toBe('<|im_start|>system\n')
    expect(r.template.systemSuffix).toBe('<|im_end|>\n')
    expect(r.template.namesInPrompt).toBe(true)
    expect(r.template.stopSequences).toEqual(expect.arrayContaining(['<|im_end|>', '<|im_start|>user', '<|im_start|>assistant']))
  })

  it('wraps the story string in the opening user turn for Gemma', () => {
    const r = parseSillyTavernPreset(GEMMA)
    if (r?.kind !== 'instruct') throw new Error('expected instruct')
    expect(r.template.systemPrefix).toBe('<start_of_turn>user\n')
    expect(r.template.assistantPrefix).toBe('<start_of_turn>model\n{name}: ')
  })

  it('translates a {{name}} sequence to {name} without doubling the prefix', () => {
    const r = parseSillyTavernPreset(CHATML_NAMES)
    if (r?.kind !== 'instruct') throw new Error('expected instruct')
    expect(r.template.userPrefix).toBe('<|im_start|>{name}\n')
    expect(r.template.namesInPrompt).toBe(true)
  })
})

describe('parseSillyTavernPreset — sysprompt', () => {
  it('reads content and post_history', () => {
    const r = parseSillyTavernPreset({ name: 'Roleplay - Immersive', content: 'Write one reply only.', post_history: 'Stay in character.' })
    expect(r).toEqual({ kind: 'sysprompt', name: 'Roleplay - Immersive', prompt: 'Write one reply only.', postHistory: 'Stay in character.' })
  })

  it('defaults an absent post_history to empty', () => {
    const r = parseSillyTavernPreset({ name: 'X', content: 'hi' })
    expect(r?.kind === 'sysprompt' && r.postHistory).toBe('')
  })
})

describe('parseSillyTavernPreset — unsupported / invalid', () => {
  it('flags a context/story-string preset', () => {
    const r = parseSillyTavernPreset({ story_string: '{{system}}\n{{description}}', name: 'ChatML' })
    expect(r?.kind).toBe('unsupported')
  })

  it('flags a sampler preset', () => {
    const r = parseSillyTavernPreset({ temp: 0.7, rep_pen: 1.1, top_p: 0.9 })
    expect(r?.kind).toBe('unsupported')
  })

  it('returns null for non-objects', () => {
    expect(parseSillyTavernPreset(null)).toBeNull()
    expect(parseSillyTavernPreset('nope')).toBeNull()
    expect(parseSillyTavernPreset([1, 2])).toBeNull()
  })
})
