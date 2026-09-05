import { describe, expect, it } from 'vitest'
import { buildRelationshipDescription } from './relationshipDescription'
import type { Character } from '@/lib/characters/cardSpec'
import type { Chat } from '@/lib/types'

const character = { id: 'c1', card: { name: 'Sumire' } } as Character

const chat = (over: Partial<Chat>): Parameters<typeof buildRelationshipDescription>[0] => ({
  affection: 60,
  relationshipStats: { trust: 60, chemistry: 55, comfort: 60, respect: 50, curiosity: 40, tension: 10 },
  ...over,
})

describe('buildRelationshipDescription — momentum', () => {
  it('folds a fast-momentum pacing clause into the block', () => {
    const out = buildRelationshipDescription(chat({ momentum: 3 }), undefined, character)!
    expect(out).toMatch(/moved fast/i)
  })

  it('folds a cooldown clause when momentum is negative', () => {
    const out = buildRelationshipDescription(chat({ momentum: -2 }), undefined, character)!
    expect(out).toMatch(/cooled|guarded/i)
  })

  it('adds nothing extra when momentum is unset (a pre-feature chat)', () => {
    const settled = buildRelationshipDescription(chat({}), undefined, character)!
    // warmth is mid-high and steady, so the "steady and comfortable" line is expected; the
    // fast/cooldown ones must not be.
    expect(settled).not.toMatch(/moved fast/i)
    expect(settled).not.toMatch(/cooled things off/i)
  })

  it('returns undefined when the chat has no affection at all', () => {
    expect(buildRelationshipDescription({ affection: undefined } as never, undefined, character)).toBeUndefined()
  })
})
