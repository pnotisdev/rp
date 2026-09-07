import { describe, expect, it } from 'vitest'
import { isVnReady, vnArtHint } from './artHint'
import type { Character } from '@/lib/characters/cardSpec'
import type { WorldCard } from '@/lib/types'

const char = (over: Partial<Character> = {}): Character =>
  ({
    id: 'c1',
    card: { name: 'Mira', description: '', personality: '', scenario: '', first_mes: '', mes_example: '' },
    sprites: {},
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as Character

const world = (over: Partial<WorldCard> = {}): WorldCard =>
  ({ id: 'w1', name: 'Sakura Hill', description: '', lorebook: { entries: [] }, createdAt: 0, updatedAt: 0, ...over }) as WorldCard

describe('vnArtHint', () => {
  it('flags a missing sprite set first, before anything about the world', () => {
    expect(vnArtHint(char({ sprites: {} }), undefined, [])).toMatch(/no expression sprites for mira/i)
    // even with a fully-stocked world, sprites are still the first thing called out
    expect(vnArtHint(char({ sprites: {} }), world({ backgrounds: { park: 'x' } }), [])).toMatch(/sprites/i)
  })

  it('once sprites exist, flags an unbound world', () => {
    const c = char({ sprites: { neutral: 'data:...' } })
    expect(vnArtHint(c, undefined, [])).toMatch(/isn't bound to a world/i)
  })

  it('once a world is bound, flags that world having no backgrounds', () => {
    const c = char({ sprites: { neutral: 'x' } })
    expect(vnArtHint(c, world({ backgrounds: {} }), [])).toMatch(/sakura hill has no scene backgrounds/i)
  })

  it('returns null once sprites and world backgrounds both exist', () => {
    const c = char({ sprites: { neutral: 'x' } })
    expect(vnArtHint(c, world({ backgrounds: { park: 'x' } }), [])).toBeNull()
  })

  it('returns null when the character dismissed the hint, and null with no character', () => {
    expect(vnArtHint(char(), undefined, ['c1'])).toBeNull()
    expect(vnArtHint(undefined, undefined, [])).toBeNull()
  })

  it('falls back to a generic name when the card name is blank', () => {
    expect(vnArtHint(char({ card: { ...char().card, name: '  ' } }), undefined, [])).toMatch(/for this character/i)
  })
})

describe('isVnReady', () => {
  it('is false with no character at all, unlike vnArtHint (which has nothing to hint about there)', () => {
    expect(isVnReady(undefined, undefined)).toBe(false)
  })

  it('is false until both sprites and world backgrounds exist', () => {
    expect(isVnReady(char({ sprites: {} }), undefined)).toBe(false)
    expect(isVnReady(char({ sprites: { neutral: 'x' } }), undefined)).toBe(false)
    expect(isVnReady(char({ sprites: { neutral: 'x' } }), world({ backgrounds: {} }))).toBe(false)
  })

  it('is true once the character has sprites and the world has scene backgrounds', () => {
    expect(isVnReady(char({ sprites: { neutral: 'x' } }), world({ backgrounds: { park: 'x' } }))).toBe(true)
  })
})
