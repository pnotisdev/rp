import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPRESSION_IDS, slugifyExpressionId } from './expressions'

describe('slugifyExpressionId', () => {
  it('lowercases and hyphenates a plain label', () => {
    expect(slugifyExpressionId('Sly Grin', [])).toBe('sly-grin')
  })

  it('strips punctuation and collapses runs of separators into one hyphen', () => {
    expect(slugifyExpressionId("Aww, that's cute!!", [])).toBe('aww-that-s-cute')
  })

  it('trims leading/trailing hyphens left over from stripped punctuation', () => {
    expect(slugifyExpressionId('  -Smug- ', [])).toBe('smug')
  })

  it('falls back to a generic id when the label has no alphanumeric characters at all', () => {
    expect(slugifyExpressionId('!!!', [])).toBe('expression')
  })

  it('appends a numeric suffix on collision with an existing id', () => {
    expect(slugifyExpressionId('Happy', DEFAULT_EXPRESSION_IDS)).toBe('happy-2')
  })

  it('keeps incrementing the suffix past multiple collisions', () => {
    expect(slugifyExpressionId('Smirk', [...DEFAULT_EXPRESSION_IDS, 'smirk-2', 'smirk-3'])).toBe('smirk-4')
  })

  it('caps the length so an unreasonably long label still produces a safe filename', () => {
    const id = slugifyExpressionId('a'.repeat(200), [])
    expect(id.length).toBeLessThanOrEqual(40)
  })
})
