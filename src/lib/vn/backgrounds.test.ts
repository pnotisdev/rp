import { describe, expect, it } from 'vitest'
import { DEFAULT_BACKGROUND_IDS, DEFAULT_BACKGROUNDS, matchBackgroundKeyword, slugifyBackgroundId } from './backgrounds'

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

describe('matchBackgroundKeyword', () => {
  const candidates = DEFAULT_BACKGROUNDS

  it('matches a background label appearing in the text', () => {
    expect(matchBackgroundKeyword('You find her waiting in the classroom after the bell rings.', candidates)).toBe(
      'classroom',
    )
  })

  it('matches on the id (hyphens as spaces) when the label itself is absent', () => {
    expect(matchBackgroundKeyword('The city street outside your window is quiet tonight.', candidates)).toBe('city-street')
  })

  it('prefers the longer, more specific needle over a shorter one also present', () => {
    // "school hallway" (a full label) should win over any coincidental shorter substring match.
    expect(matchBackgroundKeyword('The school hallway echoes as the last students leave.', candidates)).toBe('school-hallway')
  })

  it('returns undefined when nothing in the text matches any candidate', () => {
    expect(matchBackgroundKeyword('A spaceship drifts silently through the void.', candidates)).toBeUndefined()
  })

  it('ignores needles shorter than 4 characters to avoid noise matches', () => {
    // "Park" is 4 chars and should still match; a hypothetical 3-char id/label would not.
    expect(matchBackgroundKeyword('They sit together in the park at dusk.', candidates)).toBe('park')
  })

  it('is case-insensitive', () => {
    expect(matchBackgroundKeyword('THE BEACH IS EMPTY AT THIS HOUR.', candidates)).toBe('beach')
  })
})
