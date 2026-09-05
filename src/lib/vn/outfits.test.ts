import { describe, expect, it } from 'vitest'
import {
  BASE_OUTFIT_ID,
  currentOutfitFrom,
  intimateOutfitFor,
  expressionIdsForOutfit,
  isOutfitUnlocked,
  outfitCoverage,
  parseSpriteKey,
  sanitizeOutfitId,
  selectableOutfitIds,
  slugifyOutfitId,
  spriteKey,
  type Outfit,
} from './outfits'

const outfit = (o: Partial<Outfit> & { id: string }): Outfit => ({ label: o.id, ...o })

describe('spriteKey / parseSpriteKey', () => {
  it('leaves the base outfit unprefixed, so existing characters need no migration', () => {
    expect(spriteKey(BASE_OUTFIT_ID, 'blush')).toBe('blush')
    expect(spriteKey(undefined, 'blush')).toBe('blush')
  })

  it('prefixes a named outfit', () => {
    expect(spriteKey('swimsuit', 'blush')).toBe('swimsuit--blush')
  })

  it('round-trips', () => {
    for (const [o, e] of [
      [BASE_OUTFIT_ID, 'neutral'],
      ['swimsuit', 'blush'],
      ['school-uniform', 'half-smile'],
    ] as const) {
      expect(parseSpriteKey(spriteKey(o, e))).toEqual({ outfitId: o, expressionId: e })
    }
  })

  it('reads a bare key as base-outfit art', () => {
    expect(parseSpriteKey('blush')).toEqual({ outfitId: BASE_OUTFIT_ID, expressionId: 'blush' })
  })

  it('splits on the first separator even when both halves contain single hyphens', () => {
    // The whole reason `--` is safe: `slugifyId` collapses runs, so neither half can contain it.
    expect(parseSpriteKey('school-uniform--half-smile')).toEqual({
      outfitId: 'school-uniform',
      expressionId: 'half-smile',
    })
  })

  it('produces keys the server will accept as filenames', () => {
    // server/avatars.ts SAFE_KEY_RE character class — a key outside it is silently dropped on save.
    for (const key of [spriteKey('school-uniform', 'half-smile'), spriteKey(BASE_OUTFIT_ID, 'neutral')]) {
      expect(key).toMatch(/^[a-z0-9][a-z0-9-]*$/i)
    }
  })
})

describe('slugifyOutfitId', () => {
  it('slugifies a free-typed name', () => {
    expect(slugifyOutfitId('School Uniform', [])).toBe('school-uniform')
  })

  it('refuses to mint the reserved base id', () => {
    expect(slugifyOutfitId('Base', [])).toBe('base-2')
  })

  it('deduplicates against existing outfits', () => {
    expect(slugifyOutfitId('Swimsuit', ['swimsuit'])).toBe('swimsuit-2')
  })

  it('never produces a key that would break parsing', () => {
    expect(slugifyOutfitId('Winter // Coat', [])).not.toContain('--')
  })
})

describe('expressionIdsForOutfit / outfitCoverage', () => {
  const sprites = {
    neutral: 'a',
    blush: 'b',
    'swimsuit--neutral': 'c',
    'swimsuit--blush': 'd',
    'swimsuit--sultry': 'e',
  }

  it('separates the two axes', () => {
    expect(expressionIdsForOutfit(sprites, BASE_OUTFIT_ID).sort()).toEqual(['blush', 'neutral'])
    expect(expressionIdsForOutfit(sprites, 'swimsuit').sort()).toEqual(['blush', 'neutral', 'sultry'])
  })

  it('reports coverage against a given expression set', () => {
    expect(outfitCoverage(sprites, 'swimsuit', ['neutral', 'blush', 'sultry', 'angry'])).toEqual({ drawn: 3, total: 4 })
    expect(outfitCoverage(undefined, 'swimsuit', ['neutral'])).toEqual({ drawn: 0, total: 1 })
  })
})

describe('isOutfitUnlocked', () => {
  it('gates on affection', () => {
    const o = outfit({ id: 'swimsuit', unlockAffection: 50 })
    expect(isOutfitUnlocked(o, 49, new Set())).toBe(false)
    expect(isOutfitUnlocked(o, 50, new Set())).toBe(true)
  })

  it('defaults to ungated', () => {
    expect(isOutfitUnlocked(outfit({ id: 'casual' }), 0, new Set())).toBe(true)
  })

  it('requires every listed flag', () => {
    const o = outfit({ id: 'nightwear', requiredFlags: ['first_date', 'confession'] })
    expect(isOutfitUnlocked(o, 100, new Set(['first_date']))).toBe(false)
    expect(isOutfitUnlocked(o, 100, new Set(['first_date', 'confession']))).toBe(true)
  })

  it('ignores manualOnly — that gates the model, not availability', () => {
    expect(isOutfitUnlocked(outfit({ id: 'undressed', manualOnly: true }), 0, new Set())).toBe(true)
  })
})

describe('selectableOutfitIds', () => {
  const sprites = { neutral: 'a', 'swimsuit--neutral': 'b', 'undressed--neutral': 'c', 'gala--neutral': 'd' }
  const outfits = [
    outfit({ id: 'swimsuit', unlockAffection: 40 }),
    outfit({ id: 'undressed', manualOnly: true }),
    outfit({ id: 'gala', requiredFlags: ['first_date'] }),
    outfit({ id: 'artless' }),
  ]

  it('always offers the base outfit', () => {
    expect(selectableOutfitIds(undefined, undefined, 0)).toEqual([BASE_OUTFIT_ID])
    expect(selectableOutfitIds(outfits, sprites, 0)).toContain(BASE_OUTFIT_ID)
  })

  it('withholds a locked outfit until its affection gate is met', () => {
    expect(selectableOutfitIds(outfits, sprites, 39)).not.toContain('swimsuit')
    expect(selectableOutfitIds(outfits, sprites, 40)).toContain('swimsuit')
  })

  it('withholds a manualOnly outfit from the model even when unlocked', () => {
    expect(selectableOutfitIds(outfits, sprites, 100, new Set(['first_date']))).not.toContain('undressed')
  })

  it('withholds a flag-gated outfit until the flag is set', () => {
    expect(selectableOutfitIds(outfits, sprites, 100)).not.toContain('gala')
    expect(selectableOutfitIds(outfits, sprites, 100, new Set(['first_date']))).toContain('gala')
  })

  it('withholds an outfit that has no art, so no prompt tokens are spent on a dead id', () => {
    expect(selectableOutfitIds(outfits, sprites, 100, new Set(['first_date']))).not.toContain('artless')
  })
})

describe('sanitizeOutfitId', () => {
  const sprites = { neutral: 'a', 'swimsuit--neutral': 'b', 'undressed--neutral': 'c' }
  const outfits = [outfit({ id: 'swimsuit', unlockAffection: 40 }), outfit({ id: 'undressed', manualOnly: true })]

  it('accepts a legitimately selectable outfit', () => {
    expect(sanitizeOutfitId('swimsuit', outfits, sprites, 50)).toBe('swimsuit')
  })

  it('is case- and whitespace-insensitive, matching the scene-tag parser', () => {
    expect(sanitizeOutfitId('  SwimSuit ', outfits, sprites, 50)).toBe('swimsuit')
  })

  it('collapses a locked outfit to base rather than honouring the tag', () => {
    expect(sanitizeOutfitId('swimsuit', outfits, sprites, 10)).toBe(BASE_OUTFIT_ID)
  })

  it('collapses a manualOnly outfit the model tried to pick anyway', () => {
    // The model proposes, the app disposes — same contract as scene flags and relationship deltas.
    expect(sanitizeOutfitId('undressed', outfits, sprites, 100)).toBe(BASE_OUTFIT_ID)
  })

  it('collapses an outright invented id', () => {
    expect(sanitizeOutfitId('battle-armor', outfits, sprites, 100)).toBe(BASE_OUTFIT_ID)
  })

  it('collapses a missing tag', () => {
    expect(sanitizeOutfitId(undefined, outfits, sprites, 100)).toBe(BASE_OUTFIT_ID)
  })
})

describe('intimateOutfitFor', () => {
  const sprites = { neutral: 'a', 'undressed--neutral': 'b', 'lingerie--neutral': 'c', 'ghost--neutral': undefined as unknown as string }

  it('returns nothing when no outfit is marked intimate', () => {
    expect(intimateOutfitFor([outfit({ id: 'undressed' })], sprites, 100)).toBeUndefined()
    expect(intimateOutfitFor(undefined, sprites, 100)).toBeUndefined()
  })

  it('finds the marked outfit', () => {
    expect(intimateOutfitFor([outfit({ id: 'undressed', intimate: true })], sprites, 100)).toBe('undressed')
  })

  it('still finds it when it is manualOnly — that only hides it from the model, not from the app', () => {
    expect(intimateOutfitFor([outfit({ id: 'undressed', intimate: true, manualOnly: true })], sprites, 100)).toBe('undressed')
  })

  it('respects the affection gate', () => {
    const outfits = [outfit({ id: 'undressed', intimate: true, unlockAffection: 80 })]
    expect(intimateOutfitFor(outfits, sprites, 79)).toBeUndefined()
    expect(intimateOutfitFor(outfits, sprites, 80)).toBe('undressed')
  })

  it('respects the flag gate', () => {
    const outfits = [outfit({ id: 'undressed', intimate: true, requiredFlags: ['confession'] })]
    expect(intimateOutfitFor(outfits, sprites, 100)).toBeUndefined()
    expect(intimateOutfitFor(outfits, sprites, 100, new Set(['confession']))).toBe('undressed')
  })

  it('skips an intimate outfit with no art, which would resolve straight back to base anyway', () => {
    expect(intimateOutfitFor([outfit({ id: 'artless', intimate: true })], sprites, 100)).toBeUndefined()
  })

  it('takes the first eligible one when several are marked', () => {
    const outfits = [outfit({ id: 'lingerie', intimate: true }), outfit({ id: 'undressed', intimate: true })]
    expect(intimateOutfitFor(outfits, sprites, 100)).toBe('lingerie')
  })
})

describe('currentOutfitFrom', () => {
  const charMsg = (outfitId?: string) => ({ role: 'char', scene: outfitId ? { outfit: outfitId } : undefined })
  const userMsg = (outfitId?: string) => ({ role: 'user', scene: outfitId ? { outfit: outfitId } : undefined })

  it('defaults to base with no history', () => {
    expect(currentOutfitFrom([])).toBe(BASE_OUTFIT_ID)
    expect(currentOutfitFrom([charMsg(), userMsg()])).toBe(BASE_OUTFIT_ID)
  })

  it('is sticky — an untagged reply does not undress anyone', () => {
    expect(currentOutfitFrom([charMsg('swimsuit'), charMsg(), charMsg()])).toBe('swimsuit')
  })

  it('takes the most recent explicit tag', () => {
    expect(currentOutfitFrom([charMsg('swimsuit'), charMsg('gala'), charMsg()])).toBe('gala')
  })

  it("honours an outfit stamped on the player's own message", () => {
    // An explicit intimacy action takes effect immediately, not once the reply agrees.
    expect(currentOutfitFrom([charMsg('base'), userMsg('undressed')])).toBe('undressed')
  })

  it('lets a later reply tag its way back out of an app-set outfit', () => {
    expect(currentOutfitFrom([userMsg('undressed'), charMsg('base')])).toBe('base')
  })

  it('reads the active swipe, not the stored scene, when swipes exist', () => {
    expect(
      currentOutfitFrom([{ role: 'char', scene: { outfit: 'gala' }, swipeScenes: [{ outfit: 'swimsuit' }, { outfit: 'gala' }], activeSwipe: 0 }]),
    ).toBe('swimsuit')
  })
})
