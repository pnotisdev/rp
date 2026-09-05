import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPRESSION_IDS, EXPRESSION_FALLBACKS, resolveExpressionSprite, slugifyExpressionId } from './expressions'

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

describe('resolveExpressionSprite', () => {
  const AVATAR = 'data:avatar'

  it('returns the exact tagged expression when it is uploaded and unlocked', () => {
    const sprites = { happy: 'data:happy', neutral: 'data:neutral' }
    expect(resolveExpressionSprite(sprites, {}, AVATAR, 'happy', 50)).toBe('data:happy')
  })

  it('falls through to the first available fallback when the exact tag has no sprite', () => {
    // yearning's chain is [love, sad, blush] — only 'sad' is actually uploaded here.
    const sprites = { sad: 'data:sad', neutral: 'data:neutral' }
    expect(resolveExpressionSprite(sprites, {}, AVATAR, 'yearning', 50)).toBe('data:sad')
  })

  it('skips a fallback that is uploaded but not yet unlocked at the current affection', () => {
    const sprites = { love: 'data:love', sad: 'data:sad', neutral: 'data:neutral' }
    const unlocks = { love: 80 } // locked at affection 50
    expect(resolveExpressionSprite(sprites, unlocks, AVATAR, 'yearning', 50)).toBe('data:sad')
  })

  it('falls back to neutral when nothing in the expression chain is available', () => {
    const sprites = { neutral: 'data:neutral' }
    expect(resolveExpressionSprite(sprites, {}, AVATAR, 'aroused', 50)).toBe('data:neutral')
  })

  it('falls all the way back to the avatar when even neutral is unavailable', () => {
    expect(resolveExpressionSprite({}, {}, AVATAR, 'happy', 50)).toBe(AVATAR)
  })

  it('returns undefined when there is no fallback left and no avatar either', () => {
    expect(resolveExpressionSprite(undefined, undefined, undefined, 'happy', 50)).toBeUndefined()
  })

  it("respects the exact tag's own unlock threshold before ever consulting a fallback", () => {
    const sprites = { happy: 'data:happy', laughing: 'data:laughing', neutral: 'data:neutral' }
    const unlocks = { happy: 90 }
    expect(resolveExpressionSprite(sprites, unlocks, AVATAR, 'happy', 10)).toBe('data:laughing')
  })

  it('every DEFAULT_EXPRESSIONS id used as a fallback target is a real known expression id (no typos)', () => {
    const knownIds = new Set(DEFAULT_EXPRESSION_IDS)
    for (const [expression, fallbacks] of Object.entries(EXPRESSION_FALLBACKS)) {
      expect(knownIds.has(expression)).toBe(true)
      for (const fallback of fallbacks) {
        expect(knownIds.has(fallback)).toBe(true)
      }
    }
  })

  it('never lists an expression as its own fallback', () => {
    for (const [expression, fallbacks] of Object.entries(EXPRESSION_FALLBACKS)) {
      expect(fallbacks).not.toContain(expression)
    }
  })

  it("never lists 'neutral' inside a fallback chain (it's the universal last resort, checked separately)", () => {
    for (const fallbacks of Object.values(EXPRESSION_FALLBACKS)) {
      expect(fallbacks).not.toContain('neutral')
    }
  })
})
