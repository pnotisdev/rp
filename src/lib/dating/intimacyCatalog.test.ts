import { describe, expect, it } from 'vitest'
import {
  composeIntimacyActionText,
  DEFAULT_INTIMACY_CATALOG,
  getIntimacyCatalog,
  getUnlockedIntimacyOptions,
  intimacyOptionsGuidance,
  nextLockedInCategory,
} from './intimacyCatalog'

describe('getUnlockedIntimacyOptions', () => {
  it('unlocks nothing at zero warmth', () => {
    expect(getUnlockedIntimacyOptions(0, 'none')).toEqual([])
  })

  it('unlocks low-warmth kissing spots before anything else', () => {
    const unlocked = getUnlockedIntimacyOptions(20, 'none')
    expect(unlocked.length).toBeGreaterThan(0)
    expect(unlocked.every((i) => i.category === 'kissing_spot')).toBe(true)
  })

  it('keeps a warmth-eligible item locked when its commitment floor is not met', () => {
    // pos-missionary needs warmth 75 + commitment 'dating' — plenty of warmth, no commitment yet.
    const unlocked = getUnlockedIntimacyOptions(100, 'none')
    expect(unlocked.find((i) => i.id === 'pos-missionary')).toBeUndefined()
  })

  it('unlocks a commitment-gated item once both warmth and commitment are met', () => {
    const unlocked = getUnlockedIntimacyOptions(100, 'dating')
    expect(unlocked.find((i) => i.id === 'pos-missionary')).toBeDefined()
  })

  it('treats exclusive as meeting a dating-level floor (commitment tiers are ordered, not exact-match)', () => {
    const unlocked = getUnlockedIntimacyOptions(100, 'exclusive')
    expect(unlocked.find((i) => i.id === 'pos-missionary')).toBeDefined()
    expect(unlocked.find((i) => i.id === 'pos-against-wall')).toBeDefined()
  })

  it('every catalog id is unique', () => {
    const ids = DEFAULT_INTIMACY_CATALOG.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('with no world, behaves exactly as before per-world customization existed', () => {
    expect(getUnlockedIntimacyOptions(100, 'exclusive')).toEqual(getUnlockedIntimacyOptions(100, 'exclusive', undefined))
  })

  it("unlocks a world's own custom addition once its threshold is met, alongside the built-in catalog", () => {
    const world = { customIntimacyOptions: [{ id: 'custom-1', category: 'toy' as const, label: 'a hand-carved comb', minWarmth: 40 }] }
    expect(getUnlockedIntimacyOptions(30, 'none', world).find((i) => i.id === 'custom-1')).toBeUndefined()
    const unlocked = getUnlockedIntimacyOptions(40, 'none', world)
    expect(unlocked.find((i) => i.id === 'custom-1')).toBeDefined()
    // The built-in catalog is still there alongside it, not replaced.
    expect(unlocked.some((i) => i.category === 'kissing_spot')).toBe(true)
  })

  it("respects a custom entry's own minCommitment floor", () => {
    const world = {
      customIntimacyOptions: [{ id: 'custom-2', category: 'position' as const, label: 'a custom position', minWarmth: 0, minCommitment: 'married' as const }],
    }
    expect(getUnlockedIntimacyOptions(100, 'exclusive', world).find((i) => i.id === 'custom-2')).toBeUndefined()
    expect(getUnlockedIntimacyOptions(100, 'married', world).find((i) => i.id === 'custom-2')).toBeDefined()
  })

  describe('ownedToyIds', () => {
    it('with ownedToyIds omitted, returns every eligible toy regardless of ownership (the Relationship panel\'s own use, to render a Buy affordance)', () => {
      const unlocked = getUnlockedIntimacyOptions(100, 'exclusive')
      expect(unlocked.some((i) => i.category === 'toy')).toBe(true)
    })

    it('with ownedToyIds provided, excludes an eligible toy not in the set', () => {
      const unlocked = getUnlockedIntimacyOptions(100, 'exclusive', undefined, new Set())
      expect(unlocked.some((i) => i.category === 'toy')).toBe(false)
      // Non-toy categories are unaffected by the ownership filter.
      expect(unlocked.some((i) => i.category === 'kissing_spot')).toBe(true)
      expect(unlocked.some((i) => i.category === 'position')).toBe(true)
      expect(unlocked.some((i) => i.category === 'activity')).toBe(true)
    })

    it('includes a toy once its id is in ownedToyIds', () => {
      const unlocked = getUnlockedIntimacyOptions(100, 'exclusive', undefined, new Set(['toy-massage-oil']))
      expect(unlocked.find((i) => i.id === 'toy-massage-oil')).toBeDefined()
      expect(unlocked.find((i) => i.id === 'toy-vibrator')).toBeUndefined()
    })

    it('never returns a toy that is owned but not yet warmth/commitment-eligible', () => {
      const unlocked = getUnlockedIntimacyOptions(0, 'none', undefined, new Set(['toy-vibrator']))
      expect(unlocked.find((i) => i.id === 'toy-vibrator')).toBeUndefined()
    })
  })
})

describe('composeIntimacyActionText', () => {
  it("substitutes {char} into a built-in entry's own authored actionText", () => {
    const kiss = DEFAULT_INTIMACY_CATALOG.find((i) => i.id === 'kiss-forehead')!
    expect(composeIntimacyActionText(kiss, 'Sumire')).toBe("*leans in and presses a slow kiss to Sumire's forehead*")
  })

  it('every built-in entry has its own hand-written actionText, not the generic fallback', () => {
    for (const item of DEFAULT_INTIMACY_CATALOG) {
      expect(item.actionText, `${item.id} is missing actionText`).toBeTruthy()
    }
  })

  it('falls back to a kissing-spot template for a custom entry with no authored actionText', () => {
    const custom = { id: 'custom-5', category: 'kissing_spot' as const, label: 'earlobe', minWarmth: 20 }
    expect(composeIntimacyActionText(custom, 'Kai')).toBe('*kisses Kai on the earlobe*')
  })

  it('falls back to a generic template for a non-kissing-spot custom entry with no authored actionText', () => {
    const custom = { id: 'custom-6', category: 'activity' as const, label: 'stargazing', minWarmth: 20 }
    expect(composeIntimacyActionText(custom, 'Kai')).toBe('*brings up trying stargazing*')
  })

  it('replaces every occurrence of {char}, not just the first', () => {
    const custom = { id: 'custom-7', category: 'activity' as const, label: 'x', minWarmth: 0, actionText: '*looks at {char}, then at {char} again*' }
    expect(composeIntimacyActionText(custom, 'Kai')).toBe('*looks at Kai, then at Kai again*')
  })
})

describe('getIntimacyCatalog', () => {
  it('returns just the built-in defaults with no world or an empty custom list', () => {
    expect(getIntimacyCatalog()).toBe(DEFAULT_INTIMACY_CATALOG)
    expect(getIntimacyCatalog({ customIntimacyOptions: [] })).toBe(DEFAULT_INTIMACY_CATALOG)
  })

  it("appends a world's custom entries to the built-in defaults, additive not a replacement", () => {
    const custom = [{ id: 'custom-3', category: 'activity' as const, label: 'stargazing', minWarmth: 20 }]
    const catalog = getIntimacyCatalog({ customIntimacyOptions: custom })
    expect(catalog.length).toBe(DEFAULT_INTIMACY_CATALOG.length + 1)
    expect(catalog).toEqual([...DEFAULT_INTIMACY_CATALOG, ...custom])
  })
})

describe('nextLockedInCategory', () => {
  it('finds the lowest-warmth locked kissing spot at zero warmth', () => {
    const next = nextLockedInCategory('kissing_spot', 0, 'none')
    expect(next?.minWarmth).toBe(15)
  })

  it('returns undefined once every entry in a category is unlocked', () => {
    expect(nextLockedInCategory('kissing_spot', 100, 'married')).toBeUndefined()
  })

  it('advances past entries that are already unlocked', () => {
    // At warmth 20, the 3 warmth-15 kissing spots are unlocked — next should be a warmth-35 one.
    const next = nextLockedInCategory('kissing_spot', 20, 'none')
    expect(next?.minWarmth).toBe(35)
  })

  it("includes a world's own custom entry as a candidate", () => {
    const world = { customIntimacyOptions: [{ id: 'custom-4', category: 'kissing_spot' as const, label: 'somewhere new', minWarmth: 5 }] }
    expect(nextLockedInCategory('kissing_spot', 0, 'none', world)?.id).toBe('custom-4')
  })
})

describe('intimacyOptionsGuidance', () => {
  it('says nothing with no unlocked items', () => {
    expect(intimacyOptionsGuidance([], 'explicit')).toBe('')
  })

  it('names unlocked kissing spots regardless of intimacy level', () => {
    const unlocked = getUnlockedIntimacyOptions(20, 'none')
    for (const level of ['default', 'fade_to_black', 'suggestive', 'explicit'] as const) {
      const guidance = intimacyOptionsGuidance(unlocked, level)
      expect(guidance).toContain('kiss could land')
    }
  })

  it('never mentions positions, toys, or activities unless intimacyLevel is explicit', () => {
    const unlocked = getUnlockedIntimacyOptions(100, 'exclusive')
    for (const level of ['default', 'fade_to_black', 'suggestive'] as const) {
      const guidance = intimacyOptionsGuidance(unlocked, level)
      expect(guidance).not.toContain('Positions')
      expect(guidance).not.toContain('Toys')
    }
    const explicit = intimacyOptionsGuidance(unlocked, 'explicit')
    expect(explicit).toContain('Positions')
    expect(explicit).toContain('Toys')
    expect(explicit).toContain('Other things')
  })

  it('caps how many items from one category are actually named', () => {
    // At full warmth + exclusive, every 'position' entry is unlocked (9 of them) — the guidance
    // should still only name the top 4 (by minWarmth), not the full list.
    const unlocked = getUnlockedIntimacyOptions(100, 'exclusive')
    const positionCount = unlocked.filter((i) => i.category === 'position').length
    expect(positionCount).toBeGreaterThan(4)
    const guidance = intimacyOptionsGuidance(unlocked, 'explicit')
    const namedPositions = unlocked.filter((i) => i.category === 'position' && guidance.includes(i.label))
    expect(namedPositions.length).toBeLessThanOrEqual(4)
  })

  it('always leaves room for the scene to not use any of it', () => {
    const unlocked = getUnlockedIntimacyOptions(100, 'exclusive')
    expect(intimacyOptionsGuidance(unlocked, 'explicit')).toContain('never force one in')
  })

  it('never emits a {{char}}/{{user}} macro — styleGuidance strings are not macro-substituted', () => {
    const unlocked = getUnlockedIntimacyOptions(100, 'exclusive')
    expect(intimacyOptionsGuidance(unlocked, 'explicit')).not.toContain('{{')
  })
})
