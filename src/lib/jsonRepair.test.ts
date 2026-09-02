import { describe, expect, it } from 'vitest'
import { parseLenientJson } from './jsonRepair'

describe('parseLenientJson', () => {
  it('parses strictly valid JSON unchanged', () => {
    expect(parseLenientJson('{"name":"Mika","age":21}')).toEqual({ name: 'Mika', age: 21 })
  })

  it('extracts a JSON object wrapped in markdown fences and commentary', () => {
    const raw = 'Sure, here you go:\n```json\n{"name":"Mika"}\n```\nHope that helps!'
    expect(parseLenientJson(raw)).toEqual({ name: 'Mika' })
  })

  it('strips a trailing comma before a closing brace or bracket', () => {
    expect(parseLenientJson('{"tags":["a","b",],"name":"Mika",}')).toEqual({
      tags: ['a', 'b'],
      name: 'Mika',
    })
  })

  it('escapes a literal newline inside a string value', () => {
    const raw = '{"first_mes":"Hello there.\nHow are you?"}'
    expect(parseLenientJson(raw)).toEqual({ first_mes: 'Hello there.\nHow are you?' })
  })

  it('inserts a missing comma between two properties', () => {
    const raw = '{"name":"Mika"\n"age":21}'
    expect(parseLenientJson(raw)).toEqual({ name: 'Mika', age: 21 })
  })

  it('inserts a missing comma between two array elements', () => {
    const raw = '{"tags":["a" "b" "c"]}'
    expect(parseLenientJson(raw)).toEqual({ tags: ['a', 'b', 'c'] })
  })

  it('escapes an unescaped literal quote inside dialogue text', () => {
    const raw = '{"personality":"gruff. "Don\'t push me," he said.","name":"Rex"}'
    const result = parseLenientJson(raw) as Record<string, unknown>
    expect(result.name).toBe('Rex')
    expect(result.personality).toContain('Don\'t push me')
  })

  it('normalizes curly quotes to straight quotes', () => {
    const raw = '{“name”: “Mika”}'
    expect(parseLenientJson(raw)).toEqual({ name: 'Mika' })
  })

  it('closes an object truncated mid-string and mid-structure', () => {
    const raw = '{"name":"Mika","tags":["a","b"'
    expect(parseLenientJson(raw)).toEqual({ name: 'Mika', tags: ['a', 'b'] })
  })

  it('closes an object cut off in the middle of a string value', () => {
    const raw = '{"name":"Mika","description":"A tall wom'
    const result = parseLenientJson(raw) as Record<string, unknown>
    expect(result.name).toBe('Mika')
    expect(result.description).toBe('A tall wom')
  })

  it('throws when there is no JSON object anywhere in the input', () => {
    expect(() => parseLenientJson('I cannot help with that request.')).toThrow()
  })

  it('handles a realistic multi-problem model response', () => {
    const raw = [
      'Here is the character:',
      '```json',
      '{',
      '  "name": "Elias",',
      '  "personality": "Stoic. "Say less," he mutters often.",',
      '  "tags": ["stoic", "quiet",]',
      '}',
      '```',
    ].join('\n')
    const result = parseLenientJson(raw) as Record<string, unknown>
    expect(result.name).toBe('Elias')
    expect(result.tags).toEqual(['stoic', 'quiet'])
  })
})
