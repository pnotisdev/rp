import { describe, expect, it } from 'vitest'
import { anyKeyIsRisky, extractSlashRegexPattern, isRiskyRegexPattern } from './regexSafety'

describe('isRiskyRegexPattern', () => {
  it('flags the classic nested-quantifier shapes', () => {
    expect(isRiskyRegexPattern('(a+)+$')).toBe(true)
    expect(isRiskyRegexPattern('(a*)+')).toBe(true)
    expect(isRiskyRegexPattern('([a-z]+)*')).toBe(true)
    expect(isRiskyRegexPattern('(\\d*)+')).toBe(true)
  })

  it('leaves ordinary, non-nested patterns alone', () => {
    expect(isRiskyRegexPattern('dragon')).toBe(false)
    expect(isRiskyRegexPattern('a+b*c')).toBe(false)
    expect(isRiskyRegexPattern('(dragon|wyvern)')).toBe(false)
    expect(isRiskyRegexPattern('^\\s*$')).toBe(false)
    expect(isRiskyRegexPattern('(cafe|coffee)s?')).toBe(false)
  })

  it('handles an empty pattern without throwing', () => {
    expect(isRiskyRegexPattern('')).toBe(false)
  })

  it('does not flag a quantified group followed by unrelated text', () => {
    expect(isRiskyRegexPattern('(abc)+ def')).toBe(false)
  })
})

describe('extractSlashRegexPattern', () => {
  it('pulls the pattern out of a /regex/flags key', () => {
    expect(extractSlashRegexPattern('/(a+)+$/i')).toBe('(a+)+$')
    expect(extractSlashRegexPattern('/dragon/')).toBe('dragon')
  })

  it('returns null for a plain keyword key', () => {
    expect(extractSlashRegexPattern('dragon')).toBeNull()
    expect(extractSlashRegexPattern('/unterminated')).toBeNull()
  })
})

describe('anyKeyIsRisky', () => {
  it('flags a list containing one risky regex key among plain ones', () => {
    expect(anyKeyIsRisky(['dragon', 'wyvern', '/(a+)+$/'])).toBe(true)
  })

  it('is false for an all-plain or all-safe-regex key list', () => {
    expect(anyKeyIsRisky(['dragon', 'wyvern'])).toBe(false)
    expect(anyKeyIsRisky(['/dragon/i', 'wyvern'])).toBe(false)
  })
})
