import { describe, expect, it } from 'vitest'
import {
  allowedIntimacyCategories,
  composeIntimacyActionText,
  isExplicitCategory,
  DEFAULT_INTIMACY_CATALOG,
  getIntimacyCatalog,
  intimacyEntryKinks,
  intimacyEntryRegions,
  getUnlockedIntimacyOptions,
  intimacyActionDirective,
  intimacyOptionsGuidance,
  nextLockedInCategory,
  resolveIntimacyPromptNote,
  type IntimacyCategory,
  type IntimacyUnlockable,
} from './intimacyCatalog'
import { BUILT_IN_KINKS, isAnyHardLimit } from './kinks'

describe('getUnlockedIntimacyOptions', () => {
  it('unlocks nothing at zero warmth', () => {
    expect(getUnlockedIntimacyOptions(0, 'none')).toEqual([])
  })

  it('unlocks only non-explicit closeness and kissing at low warmth', () => {
    const unlocked = getUnlockedIntimacyOptions(20, 'none')
    expect(unlocked.length).toBeGreaterThan(0)
    // Both low-band categories, and nothing explicit — `affection` joined `kissing_spot` here so
    // the ladder has rungs below its first kiss, which it previously did not.
    expect(unlocked.every((i) => i.category === 'kissing_spot' || i.category === 'affection')).toBe(true)
    expect(unlocked.some((i) => i.category === 'affection')).toBe(true)
    expect(unlocked.some((i) => i.category === 'kissing_spot')).toBe(true)
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
    const text = composeIntimacyActionText(kiss, 'Sumire')
    expect(text).toContain('Sumire')
    expect(text).not.toContain('{char}')
    expect(text.startsWith('*') && text.endsWith('*')).toBe(true)
  })

  it('every built-in entry has its own hand-written actionText and a promptNote, not the generic fallback', () => {
    for (const item of DEFAULT_INTIMACY_CATALOG) {
      expect(item.actionText, `${item.id} is missing actionText`).toBeTruthy()
      expect(item.promptNote, `${item.id} is missing promptNote`).toBeTruthy()
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

describe('resolveIntimacyPromptNote', () => {
  it("uses the entry's own promptNote with {char} substituted", () => {
    const missionary = DEFAULT_INTIMACY_CATALOG.find((i) => i.id === 'pos-missionary')!
    const note = resolveIntimacyPromptNote(missionary, 'Sumire')
    expect(note).toContain('missionary position')
    expect(note).toContain('Sumire')
    expect(note).not.toContain('{char}')
  })

  it('falls back to a per-category template for a custom entry with no promptNote', () => {
    const kissCustom: IntimacyUnlockable = { id: 'c1', category: 'kissing_spot', label: 'earlobe', minWarmth: 20 }
    expect(resolveIntimacyPromptNote(kissCustom, 'Kai')).toBe("a kiss to Kai's earlobe")
    const posCustom: IntimacyUnlockable = { id: 'c2', category: 'position', label: 'standing', minWarmth: 50 }
    expect(resolveIntimacyPromptNote(posCustom, 'Kai')).toBe('the standing position')
    const toyCustom: IntimacyUnlockable = { id: 'c3', category: 'toy', label: 'a wand', minWarmth: 50 }
    expect(resolveIntimacyPromptNote(toyCustom, 'Kai')).toBe('using a wand on Kai')
  })
})

describe('intimacyActionDirective', () => {
  it('names the persona, the act, and the character, and tells the model to write a real response', () => {
    const missionary = DEFAULT_INTIMACY_CATALOG.find((i) => i.id === 'pos-missionary')!
    const line = intimacyActionDirective(missionary, 'Kai', 'Sumire')
    expect(line).toContain('Kai has just moved the scene into')
    expect(line).toContain('missionary position')
    expect(line).toMatch(/write sumire's response/i)
    expect(line).not.toContain('{{')
    expect(line).not.toContain('{char}')
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

  it('item 11: replaceIntimacyCatalog makes custom entries the entire catalog, dropping the humanoid-anatomy defaults', () => {
    const custom = [{ id: 'custom-3', category: 'activity' as const, label: 'bioluminescent glow-sharing', minWarmth: 20 }]
    const catalog = getIntimacyCatalog({ customIntimacyOptions: custom, replaceIntimacyCatalog: true })
    expect(catalog).toEqual(custom)
    expect(catalog.some((e) => DEFAULT_INTIMACY_CATALOG.includes(e))).toBe(false)
  })

  it('replaceIntimacyCatalog with no custom entries yet falls back to an empty catalog, not the defaults', () => {
    expect(getIntimacyCatalog({ replaceIntimacyCatalog: true })).toEqual([])
    expect(getIntimacyCatalog({ customIntimacyOptions: [], replaceIntimacyCatalog: true })).toEqual([])
  })

  it('replaceIntimacyCatalog is ignored (stays additive) when false/unset, regardless of custom entries', () => {
    const custom = [{ id: 'custom-3', category: 'activity' as const, label: 'stargazing', minWarmth: 20 }]
    expect(getIntimacyCatalog({ customIntimacyOptions: custom, replaceIntimacyCatalog: false })).toEqual([...DEFAULT_INTIMACY_CATALOG, ...custom])
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

describe('allowedIntimacyCategories / isExplicitCategory', () => {
  it('treats closeness and kissing as romantic rather than explicit, at every level', () => {
    expect(isExplicitCategory('kissing_spot')).toBe(false)
    // Holding hands in public is not explicit content. Filed under `activity` it would have been
    // hidden from every rating except 'explicit', which is exactly backwards.
    expect(isExplicitCategory('affection')).toBe(false)
    for (const level of ['default', 'fade_to_black', 'suggestive', 'explicit'] as const) {
      expect(allowedIntimacyCategories(level)).toContain('kissing_spot')
      expect(allowedIntimacyCategories(level)).toContain('affection')
    }
  })

  it('treats positions, toys and activities as explicit-tier', () => {
    expect(isExplicitCategory('position')).toBe(true)
    expect(isExplicitCategory('toy')).toBe(true)
    expect(isExplicitCategory('activity')).toBe(true)
  })

  it('offers everything at the explicit level', () => {
    expect(allowedIntimacyCategories('explicit')).toEqual(['affection', 'kissing_spot', 'position', 'toy', 'activity'])
  })

  it('takes explicit actions away only when the rating asks for less', () => {
    for (const level of ['fade_to_black', 'suggestive'] as const) {
      expect(allowedIntimacyCategories(level)).toEqual(['affection', 'kissing_spot'])
    }
  })

  it("leaves 'default' untouched, because that level promises no behavior change at all", () => {
    // `intimacyGuidance`'s own contract: 'default' is "the exact behavior every chat already had
    // before this setting existed". Hiding actions from someone who never opened the setting would
    // break that promise and silently remove buttons they already had.
    expect(allowedIntimacyCategories('default')).toEqual(['affection', 'kissing_spot', 'position', 'toy', 'activity'])
  })

  it('deliberately differs from the prompt gating at the default level', () => {
    // Two different questions: what the model may volunteer unprompted (stricter) vs. what the
    // player may explicitly ask for (only restricted by a rating that asks for less).
    const unlocked = getUnlockedIntimacyOptions(100, 'married')
    expect(intimacyOptionsGuidance(unlocked, 'default')).not.toContain('Positions this relationship has earned')
    expect(allowedIntimacyCategories('default')).toContain('position')
  })

  it('agrees with the prompt wherever the rating is an actual statement of intent', () => {
    const unlocked = getUnlockedIntimacyOptions(100, 'married')
    for (const level of ['fade_to_black', 'suggestive', 'explicit'] as const) {
      const text = intimacyOptionsGuidance(unlocked, level)
      const allowed = allowedIntimacyCategories(level)
      expect(text.includes('Positions this relationship has earned')).toBe(allowed.includes('position'))
      expect(text.includes('Toys or props')).toBe(allowed.includes('toy'))
    }
  })
})

describe('per-character limits on the action set', () => {
  it('drops an entry that touches a region this character has ruled out', () => {
    const withFeet = { touch: { offLimits: ['feet' as const] } }
    // `kiss-thigh` involves inner_thigh/thighs, so it survives a feet limit.
    expect(getUnlockedIntimacyOptions(100, 'exclusive', undefined, undefined, withFeet).some((i) => i.id === 'kiss-thigh')).toBe(true)
    const noThighs = { touch: { offLimits: ['inner_thigh' as const] } }
    expect(getUnlockedIntimacyOptions(100, 'exclusive', undefined, undefined, noThighs).some((i) => i.id === 'kiss-thigh')).toBe(false)
  })

  it('drops an entry whose region is gated above the current warmth, and restores it above the gate', () => {
    const gated = { touch: { gated: { genitals: 95 } } }
    expect(getUnlockedIntimacyOptions(90, 'exclusive', undefined, undefined, gated).some((i) => i.id === 'pos-missionary')).toBe(false)
    expect(getUnlockedIntimacyOptions(100, 'exclusive', undefined, undefined, gated).some((i) => i.id === 'pos-missionary')).toBe(true)
  })

  it('drops an entry involving a hard-limited kink entirely — never rendered, never prompted', () => {
    const noBondage = { kinks: { hardLimits: ['bondage'] } }
    const options = getUnlockedIntimacyOptions(100, 'exclusive', undefined, undefined, noBondage)
    expect(options.some((i) => i.id === 'toy-handcuffs')).toBe(false)
    expect(options.some((i) => i.id === 'toy-silk-ties')).toBe(false)
    // A merely disliked kink still appears — only a hard limit filters.
    const dislikes = { kinks: { valence: { bondage: -1 as const } } }
    expect(getUnlockedIntimacyOptions(100, 'exclusive', undefined, undefined, dislikes).some((i) => i.id === 'toy-handcuffs')).toBe(true)
  })

  it('withholds nothing from a profile-less character beyond the opt-in entries', () => {
    const eligible = DEFAULT_INTIMACY_CATALOG.filter((o) => o.minWarmth <= 100 && o.category !== 'toy')
    const offered = getUnlockedIntimacyOptions(100, 'exclusive')
    const withheld = eligible.filter((o) => !offered.some((k) => k.id === o.id))
    // Every other entry is a veto model: absent a hard limit, it is offered. These are the only
    // ones that are opt-in, and "no profile at all" is exactly the case they exist to catch —
    // an unauthored character sits at 0 on every kink, and 0 is not consent.
    expect(withheld.map((o) => o.id)).toEqual(['act-recording'])
    expect(withheld.every((o) => o.requiresEagerness)).toBe(true)
    // An empty profile object behaves identically to no profile at all.
    const withEmptyProfile = getUnlockedIntimacyOptions(100, 'exclusive', undefined, undefined, {})
    expect(withEmptyProfile.map((o) => o.id)).toEqual(offered.map((o) => o.id))
  })

  it('withholds a requiresEagerness entry until the character is actually into it, not merely silent', () => {
    const has = (profile: Parameters<typeof getUnlockedIntimacyOptions>[4]) =>
      getUnlockedIntimacyOptions(100, 'exclusive', undefined, undefined, profile).some((o) => o.id === 'act-recording')
    expect(has({})).toBe(false)
    expect(has({ kinks: { valence: { recording: 0 } } })).toBe(false)
    expect(has({ kinks: { valence: { recording: -1 } } })).toBe(false)
    expect(has({ kinks: { valence: { recording: 1 } } })).toBe(true)
    expect(has({ kinks: { valence: { recording: 2 } } })).toBe(true)
    // A hard limit still wins over eagerness recorded elsewhere.
    expect(has({ kinks: { valence: { recording: 2 }, hardLimits: ['recording'] } })).toBe(false)
  })
})

describe('entry tagging', () => {
  it('leaves no built-in entry untagged on both axes — a limit has to be able to reach it', () => {
    for (const entry of DEFAULT_INTIMACY_CATALOG) {
      const tagged = intimacyEntryRegions(entry).length + intimacyEntryKinks(entry).length
      expect(tagged, entry.id).toBeGreaterThan(0)
    }
  })

  it('tags every entry that involves physical contact with the regions it touches', () => {
    // `act-roleplay` is the one built-in with no inherent region — acting out a fantasy is a frame
    // around the scene rather than a place on a body — so it carries a kink tag instead.
    for (const entry of DEFAULT_INTIMACY_CATALOG.filter((e) => e.id !== 'act-roleplay')) {
      expect(intimacyEntryRegions(entry).length, entry.id).toBeGreaterThan(0)
    }
  })

  it("prefers an entry's own tags over the built-in map, so a world can author its own", () => {
    const custom = { ...DEFAULT_INTIMACY_CATALOG[0], regions: ['feet' as const], kinks: ['rough'] }
    expect(intimacyEntryRegions(custom)).toEqual(['feet'])
    expect(intimacyEntryKinks(custom)).toEqual(['rough'])
  })

  it('reads an untagged entry as involving no kinks rather than guessing', () => {
    expect(intimacyEntryKinks({ id: 'unknown', category: 'activity', label: 'x', minWarmth: 0 })).toEqual([])
  })
})

// §8 of CATALOG_IDEAS.md. `isAnyHardLimit([])` is always false, so an entry missing from
// `BUILT_IN_ENTRY_KINKS` can never be excluded by a limit — which is fine for a wrist kiss and is
// the entire safety mechanism for an explicit entry. These pin that the table stays the gate.
describe('built-in entries are reachable by the hard-limit system', () => {
  const EXPLICIT_CATEGORIES: IntimacyCategory[] = ['position', 'toy', 'activity']

  // The entries where an untagged row would mean the limits system is inert for the riskiest
  // content in the catalog. Pinned individually rather than as a coverage percentage, because the
  // thing that matters is not how many are tagged but that *these* are.
  const MUST_DECLARE: Record<string, string> = {
    'act-anal': 'anal',
    'act-recording': 'recording',
    'act-overstimulation': 'overstimulation',
    'act-finish-on': 'bodily_fluids',
    'act-cleaning-up': 'bodily_fluids',
    'act-marking': 'marking',
    'act-begging': 'degradation',
    'act-public-risk': 'exhibitionism',
    'act-mutual-watching': 'voyeurism',
    'pos-full-nelson': 'bondage',
    'pos-window': 'exhibitionism',
    'toy-plug': 'anal',
    'toy-wand': 'overstimulation',
    'toy-under-bed': 'bondage',
    'toy-spreader': 'bondage',
    'toy-mirror': 'voyeurism',
  }

  it('declares the content class on every entry a limit most needs to reach', () => {
    for (const [id, kink] of Object.entries(MUST_DECLARE)) {
      const entry = DEFAULT_INTIMACY_CATALOG.find((o) => o.id === id)
      expect(entry, `${id} is missing from the catalog`).toBeDefined()
      expect(intimacyEntryKinks(entry!), id).toContain(kink)
    }
  })

  it('keeps untagged explicit entries to the handful that carry no stance at all', () => {
    const untagged = DEFAULT_INTIMACY_CATALOG.filter(
      (o) => EXPLICIT_CATEGORIES.includes(o.category) && intimacyEntryKinks(o).length === 0,
    )
    // A ceiling rather than an exact list: a new entry is free to be stanceless, but if most of a
    // growing catalog drifts that way the hard-limit system quietly stops meaning anything.
    const explicit = DEFAULT_INTIMACY_CATALOG.filter((o) => EXPLICIT_CATEGORIES.includes(o.category))
    expect(untagged.length / explicit.length).toBeLessThan(0.3)
    for (const entry of untagged) expect(Object.keys(MUST_DECLARE)).not.toContain(entry.id)
  })

  it('a hard limit actually removes the entries that declare it', () => {
    const profile = { hardLimits: ['bondage' as const] }
    const bondage = DEFAULT_INTIMACY_CATALOG.filter((o) => intimacyEntryKinks(o).includes('bondage'))
    expect(bondage.length).toBeGreaterThan(0)
    for (const entry of bondage) {
      expect(isAnyHardLimit(profile, intimacyEntryKinks(entry))).toBe(true)
    }
  })

  it('names every kink the catalog uses in BUILT_IN_KINKS, so an author can actually set it as a limit', () => {
    const used = new Set(DEFAULT_INTIMACY_CATALOG.flatMap((o) => intimacyEntryKinks(o)))
    for (const kink of used) {
      expect(BUILT_IN_KINKS).toContain(kink)
    }
  })
})

// §9.2 of CATALOG_IDEAS.md. "The edge of the onsen" is nonsense in a classroom, and warmth is no
// kind of gate on that.
describe('requiresBackground', () => {
  const at = (background?: string) =>
    getUnlockedIntimacyOptions(100, 'exclusive', undefined, undefined, undefined, background).map((o) => o.id)

  it('offers a location-tied entry only where it makes sense', () => {
    expect(at('onsen')).toContain('pos-onsen-edge')
    expect(at('classroom')).not.toContain('pos-onsen-edge')
    expect(at('bedroom')).not.toContain('pos-onsen-edge')
  })

  it('offers it in any of the places it lists, not just the first', () => {
    expect(at('shower')).toContain('pos-shower-bench')
    expect(at('onsen')).toContain('pos-shower-bench')
    expect(at('kitchen')).not.toContain('pos-shower-bench')
  })

  it("treats 'unknown' as different from 'wrong place', so a caller with no background loses nothing", () => {
    expect(at(undefined)).toContain('pos-onsen-edge')
    expect(at(undefined)).toContain('pos-desk')
  })

  it('leaves every entry with no location requirement alone', () => {
    // `requiresEagerness` entries are withheld for their own reason; this is about location only.
    const unrestricted = DEFAULT_INTIMACY_CATALOG.filter((o) => !o.requiresBackground && !o.requiresEagerness)
    for (const background of ['classroom', 'onsen', 'bedroom']) {
      const offered = at(background)
      for (const entry of unrestricted) {
        if (entry.minWarmth <= 100 && entry.category !== 'toy') expect(offered, `${entry.id} in ${background}`).toContain(entry.id)
      }
    }
  })
})
