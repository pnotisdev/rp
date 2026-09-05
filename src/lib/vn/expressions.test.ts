import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPRESSION_IDS, EXPRESSION_FALLBACKS, resolveExpressionSprite, slugifyExpressionId } from './expressions'
import { BASE_OUTFIT_ID } from './outfits'

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

describe('resolveExpressionSprite — outfits', () => {
  const AVATAR = 'data:avatar'
  // A character drawn before outfits existed, plus a partially-drawn swimsuit added later.
  const sprites = {
    neutral: 'base-neutral',
    blush: 'base-blush',
    angry: 'base-angry',
    'swimsuit--neutral': 'swim-neutral',
    'swimsuit--blush': 'swim-blush',
  }

  it('resolves within the requested outfit', () => {
    expect(resolveExpressionSprite(sprites, {}, AVATAR, 'blush', 50, 'swimsuit')).toBe('swim-blush')
  })

  it('is byte-for-byte unchanged when no outfit is passed', () => {
    // The backward-compatibility guarantee: every pre-outfit character and every call site that
    // does not pass an outfit must resolve exactly as it did before this feature existed.
    expect(resolveExpressionSprite(sprites, {}, AVATAR, 'blush', 50)).toBe('base-blush')
    expect(resolveExpressionSprite(sprites, {}, AVATAR, 'angry', 50)).toBe('base-angry')
  })

  it('treats an explicit base outfit the same as omitting it', () => {
    expect(resolveExpressionSprite(sprites, {}, AVATAR, 'blush', 50, BASE_OUTFIT_ID)).toBe('base-blush')
  })

  it('walks the same-family fallback chain inside the outfit before leaving it', () => {
    // 'embarrassed' falls back to 'blush', which the swimsuit has — so it must not reach base art.
    expect(resolveExpressionSprite(sprites, {}, AVATAR, 'embarrassed', 50, 'swimsuit')).toBe('swim-blush')
  })

  it("falls back to the outfit's own neutral before leaving the outfit", () => {
    // 'sleepy' has an empty fallback list, so the outfit's neutral is the last in-outfit option.
    expect(resolveExpressionSprite(sprites, {}, AVATAR, 'sleepy', 50, 'swimsuit')).toBe('swim-neutral')
  })

  it('degrades a partially-drawn outfit to base art rather than to the avatar', () => {
    const partial = { neutral: 'base-neutral', angry: 'base-angry', 'swimsuit--sultry': 'swim-sultry' }
    // Wrong clothes for one beat beats no character at all.
    expect(resolveExpressionSprite(partial, {}, AVATAR, 'angry', 50, 'swimsuit')).toBe('base-angry')
  })

  it('falls through to the avatar when neither the outfit nor base has anything', () => {
    expect(resolveExpressionSprite({ 'gala--happy': 'gala-happy' }, {}, AVATAR, 'happy', 50, 'swimsuit')).toBe(AVATAR)
  })

  it('gates each outfit sprite on its own unlock threshold', () => {
    const unlocks = { 'swimsuit--blush': 60 }
    expect(resolveExpressionSprite(sprites, unlocks, AVATAR, 'blush', 59, 'swimsuit')).toBe('swim-neutral')
    expect(resolveExpressionSprite(sprites, unlocks, AVATAR, 'blush', 60, 'swimsuit')).toBe('swim-blush')
  })

  it('does not let an outfit sprite leak into a base-outfit resolution', () => {
    const onlyOutfit = { 'swimsuit--blush': 'swim-blush' }
    expect(resolveExpressionSprite(onlyOutfit, {}, AVATAR, 'blush', 50)).toBe(AVATAR)
  })

  it('handles an unknown outfit id by resolving base art', () => {
    expect(resolveExpressionSprite(sprites, {}, AVATAR, 'blush', 50, 'battle-armor')).toBe('base-blush')
  })
})
