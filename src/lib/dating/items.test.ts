import { describe, expect, it } from 'vitest'
import { DEFAULT_ITEM_CATALOG, getItemCatalog, itemById, itemEffectSummary } from './items'
import type { ItemDef, WorldCard } from '@/lib/types'
import { SCENE_FLAGS } from './stage'

describe('getItemCatalog', () => {
  // The bug this catalog exists to fix: with no default, the Items section, the Bag panel and the
  // whole ItemEffect engine were invisible on a fresh install.
  it('falls back to the built-in catalog for a world with no items of its own', () => {
    expect(getItemCatalog(undefined)).toBe(DEFAULT_ITEM_CATALOG)
    expect(getItemCatalog({ items: [] } as unknown as WorldCard)).toBe(DEFAULT_ITEM_CATALOG)
  })

  it("uses a world's own catalog when it authored one, same precedence as gifts", () => {
    const own: ItemDef[] = [
      { id: 'x', name: 'X', rarity: 'common', price: 1, tags: [], effect: { kind: 'currency', amount: 1 } },
    ]
    expect(getItemCatalog({ items: own } as unknown as WorldCard)).toBe(own)
  })

  it('resolves an id against the defaults', () => {
    expect(itemById('apology-cake')?.name).toBe('Apology Cake')
    expect(itemById('not-a-real-item')).toBeUndefined()
  })
})

describe('DEFAULT_ITEM_CATALOG', () => {
  it('has unique ids', () => {
    const ids = DEFAULT_ITEM_CATALOG.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only ever sets a scene flag that actually exists', () => {
    for (const item of DEFAULT_ITEM_CATALOG) {
      if (item.effect.kind === 'flag') expect(SCENE_FLAGS).toContain(item.effect.flag)
    }
  })

  it('prices every entry inside the coin economy it has to be earned in', () => {
    // Milestones pay +15, a commitment ask +25, an objective +12, from a starting 24 — so nothing
    // here should cost more than a little over one milestone.
    for (const item of DEFAULT_ITEM_CATALOG) {
      expect(item.price).toBeGreaterThanOrEqual(0)
      expect(item.price).toBeLessThanOrEqual(30)
    }
  })

  // `tension` is the one dimension where down is the good direction; it had no deliberate mover.
  it('gives the player a way to bring tension down', () => {
    const reducers = DEFAULT_ITEM_CATALOG.filter(
      (i) => i.effect.kind === 'relationship' && i.effect.dimension === 'tension' && i.effect.amount < 0,
    )
    expect(reducers.length).toBeGreaterThan(0)
  })

  it('includes a coin source, so the shop is not a strictly finite budget', () => {
    const income = DEFAULT_ITEM_CATALOG.filter((i) => i.effect.kind === 'currency' && i.effect.amount > 0)
    expect(income.length).toBeGreaterThan(0)
    // And it has to be affordable at zero coins, or it can't dig anyone out.
    expect(income.every((i) => i.price < (i.effect as { amount: number }).amount)).toBe(true)
  })
})

describe('itemEffectSummary', () => {
  it('reads each effect kind in plain language', () => {
    expect(itemEffectSummary(itemById('part-time-shift')!)).toBe('+12 coins when used')
    expect(itemEffectSummary(itemById('festival-tickets')!)).toBe('Sets "first date"')
    expect(itemEffectSummary(itemById('canned-coffee')!)).toBe('+3 comfort when used')
  })

  it('keeps the sign on a negative nudge, so a tension reducer does not read as a gain', () => {
    expect(itemEffectSummary(itemById('apology-cake')!)).toBe('-8 tension when used')
  })
})

// §9.1 of CATALOG_IDEAS.md. Most things a consumable naturally wants to do are two-part.
describe('multi effects', () => {
  it('reads both halves of a two-part item in one line', () => {
    expect(itemEffectSummary(itemById('long-walk')!)).toBe('-6 tension, +3 comfort when used')
  })

  it('composes any mix of kinds', () => {
    const item: ItemDef = {
      id: 'x',
      name: 'X',
      rarity: 'common',
      price: 1,
      tags: [],
      effect: {
        kind: 'multi',
        effects: [
          { kind: 'currency', amount: 5 },
          { kind: 'flag', flag: 'promise' },
          { kind: 'relationship', dimension: 'trust', amount: 2 },
        ],
      },
    }
    expect(itemEffectSummary(item)).toBe('+5 coins, sets "promise", +2 trust when used')
  })

  it('leaves the single-effect wordings exactly as they were', () => {
    expect(itemEffectSummary(itemById('part-time-shift')!)).toBe('+12 coins when used')
    expect(itemEffectSummary(itemById('festival-tickets')!)).toBe('Sets "first date"')
    expect(itemEffectSummary(itemById('canned-coffee')!)).toBe('+3 comfort when used')
  })
})
