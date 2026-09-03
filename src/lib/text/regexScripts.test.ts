import { describe, expect, it } from 'vitest'
import { applyRegexScripts, isValidRegexScript } from './regexScripts'
import type { RegexScript } from '@/lib/types'

const script = (over: Partial<RegexScript>): RegexScript => ({
  id: '1',
  name: 'test',
  find: '',
  replace: '',
  target: 'both',
  enabled: true,
  ...over,
})

describe('applyRegexScripts', () => {
  it('returns the text unchanged when there are no scripts', () => {
    expect(applyRegexScripts('hello', undefined, 'display')).toBe('hello')
    expect(applyRegexScripts('hello', [], 'display')).toBe('hello')
  })

  it('applies a global replace', () => {
    const s = [script({ find: 'cat', replace: 'dog' })]
    expect(applyRegexScripts('a cat and a cat', s, 'display')).toBe('a dog and a dog')
  })

  it('supports capture-group backreferences', () => {
    const s = [script({ find: '\\*(.+?)\\*', replace: '<$1>' })]
    expect(applyRegexScripts('he *smiles* warmly', s, 'display')).toBe('he <smiles> warmly')
  })

  it('turns \\n in the replacement into a real newline', () => {
    const s = [script({ find: ' — ', replace: '\\n' })]
    expect(applyRegexScripts('one — two', s, 'display')).toBe('one\ntwo')
  })

  it('honours target filtering', () => {
    const displayOnly = [script({ find: 'x', replace: 'y', target: 'display' })]
    expect(applyRegexScripts('x', displayOnly, 'display')).toBe('y')
    expect(applyRegexScripts('x', displayOnly, 'prompt')).toBe('x')
  })

  it('runs "both" scripts against either target', () => {
    const s = [script({ find: 'x', replace: 'y', target: 'both' })]
    expect(applyRegexScripts('x', s, 'display')).toBe('y')
    expect(applyRegexScripts('x', s, 'prompt')).toBe('y')
  })

  it('skips disabled scripts', () => {
    const s = [script({ find: 'x', replace: 'y', enabled: false })]
    expect(applyRegexScripts('x', s, 'display')).toBe('x')
  })

  it('skips a script with an invalid pattern instead of throwing', () => {
    const s = [script({ find: '(', replace: 'y' }), script({ find: 'x', replace: 'z' })]
    expect(applyRegexScripts('x', s, 'display')).toBe('z')
  })

  it('applies extra flags (case-insensitive)', () => {
    const s = [script({ find: 'CAT', replace: 'dog', flags: 'i' })]
    expect(applyRegexScripts('a Cat', s, 'display')).toBe('a dog')
  })

  it('chains multiple scripts in order', () => {
    const s = [script({ find: 'a', replace: 'b' }), script({ find: 'b', replace: 'c' })]
    expect(applyRegexScripts('a', s, 'display')).toBe('c')
  })

  it('the "avoid em dashes" managed rule (WritingStyleSection) strips a dash cleanly, spaced or not', () => {
    const s = [script({ find: '\\s*—\\s*', replace: ', ' })]
    expect(applyRegexScripts('The room was quiet — she hesitated.', s, 'display')).toBe('The room was quiet, she hesitated.')
    expect(applyRegexScripts('one—two', s, 'display')).toBe('one, two')
  })
})

describe('isValidRegexScript', () => {
  it('accepts a valid pattern and an empty one', () => {
    expect(isValidRegexScript({ find: '\\d+' })).toBe(true)
    expect(isValidRegexScript({ find: '' })).toBe(true)
  })
  it('rejects an unbalanced pattern', () => {
    expect(isValidRegexScript({ find: '(unclosed' })).toBe(false)
  })
})
