import { describe, expect, it } from 'vitest'
import { DEFAULT_BACKGROUND_IDS, slugifyBackgroundId } from './backgrounds'

describe('slugifyBackgroundId', () => {
  it('lowercases and hyphenates a plain label', () => {
    expect(slugifyBackgroundId('Her Family Bookshop', [])).toBe('her-family-bookshop')
  })

  it('falls back to a generic id when the label has no alphanumeric characters at all', () => {
    expect(slugifyBackgroundId('!!!', [])).toBe('location')
  })

  it('appends a numeric suffix on collision with an existing (default) background id', () => {
    expect(slugifyBackgroundId('Park', DEFAULT_BACKGROUND_IDS)).toBe('park-2')
  })

  it('strips accented characters rather than transliterating them (a real, if minor, limitation)', () => {
    expect(slugifyBackgroundId('Café', [])).toBe('caf')
  })

  it("uses its own 'location' fallback word, distinct from slugifyExpressionId's 'expression'", () => {
    // Both delegate to the same shared slugifyId — this pins that each kept its own distinct default.
    expect(slugifyBackgroundId('', [])).toBe('location')
  })
})
