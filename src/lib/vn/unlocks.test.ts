import { describe, expect, it } from 'vitest'
import type { Character, CharacterCardData } from '@/lib/characters/cardSpec'
import type { WorldCard } from '@/lib/types'
import { DEFAULT_EXPRESSION_IDS } from '@/lib/vn/expressions'
import { DEFAULT_BACKGROUND_IDS } from '@/lib/vn/backgrounds'
import { getUnlockedBackgroundIds, getUnlockedExpressionIds } from './unlocks'

function character(overrides: Partial<Character> = {}, card: Partial<CharacterCardData> = {}): Character {
  return {
    id: 'char-1',
    createdAt: 0,
    updatedAt: 0,
    card: { name: 'Aria', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', ...card },
    ...overrides,
  }
}

describe('getUnlockedExpressionIds', () => {
  it('offers the built-in default set when the card has no custom sprites at all', () => {
    expect(getUnlockedExpressionIds(character(), 0)).toEqual(DEFAULT_EXPRESSION_IDS)
  })

  it('offers only sprites unlocked at the given affection', () => {
    const c = character({ sprites: { neutral: 'a', happy: 'b', smitten: 'c' }, spriteUnlocks: { happy: 20, smitten: 60 } })
    expect(getUnlockedExpressionIds(c, 30)).toEqual(['neutral', 'happy'])
  })

  it('falls back to just neutral when nothing is unlocked yet', () => {
    const c = character({ sprites: { happy: 'a', smitten: 'b' }, spriteUnlocks: { happy: 20, smitten: 60 } })
    expect(getUnlockedExpressionIds(c, 0)).toEqual(['neutral'])
  })

  it('treats an unlisted sprite as unlocked from 0', () => {
    const c = character({ sprites: { neutral: 'a', happy: 'b' }, spriteUnlocks: { happy: 20 } })
    expect(getUnlockedExpressionIds(c, 0)).toEqual(['neutral'])
  })
})

describe('getUnlockedBackgroundIds', () => {
  it('offers the built-in default ids when the world has no custom backgrounds at all', () => {
    expect(getUnlockedBackgroundIds(undefined, 0)).toEqual(DEFAULT_BACKGROUND_IDS)
  })

  const world = (overrides: Partial<WorldCard> = {}): WorldCard =>
    ({ id: 'w1', name: 'World', description: '', lorebook: { entries: [] }, createdAt: 0, updatedAt: 0, ...overrides }) as WorldCard

  it('offers only backgrounds unlocked at the given affection', () => {
    const w = world({ backgrounds: { cafe: 'a', bedroom: 'b' }, backgroundUnlocks: { bedroom: 85 } })
    expect(getUnlockedBackgroundIds(w, 30)).toEqual(['cafe'])
  })

  it('falls back to the full default list when nothing is unlocked yet', () => {
    const w = world({ backgrounds: { bedroom: 'a' }, backgroundUnlocks: { bedroom: 85 } })
    expect(getUnlockedBackgroundIds(w, 0)).toEqual(DEFAULT_BACKGROUND_IDS)
  })
})
