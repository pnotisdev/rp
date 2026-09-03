import { describe, expect, it } from 'vitest'
import { activateWorldInfo, recentMessagesText } from './activation'
import type { Lorebook, LorebookEntry } from '@/lib/characters/cardSpec'

let nextId = 1
function entry(overrides: Partial<LorebookEntry> & { content: string }): LorebookEntry {
  return {
    id: nextId++,
    keys: [],
    constant: false,
    selective: false,
    insertion_order: 100,
    enabled: true,
    ...overrides,
  }
}

function book(entries: LorebookEntry[], token_budget?: number): Lorebook {
  return { entries, token_budget }
}

describe('activateWorldInfo', () => {
  it('always includes constant/"always" entries regardless of keyword matches', () => {
    const b = book([entry({ content: 'World rule.', constant: true, activationMode: 'always' })])
    const result = activateWorldInfo([b], 'nothing relevant here')
    expect(result.activated).toHaveLength(1)
    expect(result.activated[0].content).toBe('World rule.')
  })

  it('activates a keyword entry only when its key appears in the recent text', () => {
    const b = book([entry({ content: 'About the tavern.', keys: ['tavern'] })])
    expect(activateWorldInfo([b], 'we went to the tavern last night').activated).toHaveLength(1)
    expect(activateWorldInfo([b], 'we stayed home all day').activated).toHaveLength(0)
  })

  it('matches keywords case-insensitively by default', () => {
    const b = book([entry({ content: 'X', keys: ['Tavern'] })])
    expect(activateWorldInfo([b], 'the TAVERN was loud').activated).toHaveLength(1)
  })

  it('respects case_sensitive:true and does not match a different case', () => {
    const b = book([entry({ content: 'X', keys: ['Tavern'], case_sensitive: true })])
    expect(activateWorldInfo([b], 'the tavern was loud').activated).toHaveLength(0)
    expect(activateWorldInfo([b], 'the Tavern was loud').activated).toHaveLength(1)
  })

  it('requires a secondary key too when selective is set', () => {
    const b = book([
      entry({ content: 'X', keys: ['tavern'], selective: true, secondary_keys: ['fire'] }),
    ])
    expect(activateWorldInfo([b], 'the tavern was quiet').activated).toHaveLength(0)
    expect(activateWorldInfo([b], 'the tavern caught fire').activated).toHaveLength(1)
  })

  it('never activates an entry with no keys at all in keyword mode', () => {
    const b = book([entry({ content: 'X', keys: [] })])
    expect(activateWorldInfo([b], 'anything goes here').activated).toHaveLength(0)
  })

  it('skips disabled entries entirely, even in "always" mode', () => {
    const b = book([entry({ content: 'X', constant: true, activationMode: 'always', enabled: false })])
    expect(activateWorldInfo([b], 'text').activated).toHaveLength(0)
  })

  describe('manual mode', () => {
    it('includes a manual entry when its enabled flag is on', () => {
      const b = book([entry({ content: 'X', activationMode: 'manual', enabled: true })])
      expect(activateWorldInfo([b], 'irrelevant text').activated).toHaveLength(1)
    })

    it('excludes a manual entry when its enabled flag is off', () => {
      const b = book([entry({ content: 'X', activationMode: 'manual', enabled: false })])
      expect(activateWorldInfo([b], 'text').activated).toHaveLength(0)
    })
  })

  describe('affection gating', () => {
    it('excludes an entry whose affectionMin is above the current affection', () => {
      const b = book([
        entry({ content: 'X', constant: true, activationMode: 'always', extensions: { affectionMin: 50 } }),
      ])
      expect(activateWorldInfo([b], 'text', 20).activated).toHaveLength(0)
      expect(activateWorldInfo([b], 'text', 50).activated).toHaveLength(1)
      expect(activateWorldInfo([b], 'text', 80).activated).toHaveLength(1)
    })

    it('defaults affectionMin to 0 (always eligible) when unset', () => {
      const b = book([entry({ content: 'X', constant: true, activationMode: 'always' })])
      expect(activateWorldInfo([b], 'text', 0).activated).toHaveLength(1)
    })
  })

  describe('token budget', () => {
    it('drops lower-priority matches once the book token_budget is exhausted', () => {
      const short = 'a'.repeat(20) // ~5 estimated tokens (estimateTokens ~= chars/4)
      const long = 'b'.repeat(200) // ~50 estimated tokens — alone exceeds the budget below
      const b = book(
        [
          entry({ content: short, constant: true, activationMode: 'always', insertion_order: 100 }),
          entry({ content: long, constant: true, activationMode: 'always', insertion_order: 50 }),
        ],
        10, // fits the short, higher-priority entry but not the long, lower-priority one
      )
      const result = activateWorldInfo([b], 'text')
      expect(result.activated).toHaveLength(1)
      expect(result.activated[0].insertion_order).toBe(100)
      expect(result.droppedForBudget).toHaveLength(1)
      expect(result.droppedForBudget[0].insertion_order).toBe(50)
    })

    it('treats an unset token_budget as unlimited', () => {
      const long = 'word '.repeat(500)
      const b = book([entry({ content: long, constant: true, activationMode: 'always' })])
      const result = activateWorldInfo([b], 'text')
      expect(result.activated).toHaveLength(1)
      expect(result.droppedForBudget).toHaveLength(0)
    })
  })

  it('sorts final activated entries by ascending insertion_order (not match order)', () => {
    const b = book([
      entry({ content: 'last', constant: true, activationMode: 'always', insertion_order: 200 }),
      entry({ content: 'first', constant: true, activationMode: 'always', insertion_order: 1 }),
      entry({ content: 'middle', constant: true, activationMode: 'always', insertion_order: 50 }),
    ])
    const result = activateWorldInfo([b], 'text')
    expect(result.activated.map((e) => e.content)).toEqual(['first', 'middle', 'last'])
  })

  it('scans across multiple books independently, each with its own budget', () => {
    const b1 = book([entry({ content: 'from book 1', constant: true, activationMode: 'always' })])
    const b2 = book([entry({ content: 'from book 2', constant: true, activationMode: 'always' })])
    const result = activateWorldInfo([b1, b2], 'text')
    expect(result.activated.map((e) => e.content).sort()).toEqual(['from book 1', 'from book 2'])
  })

  it('returns no activations for an empty book list', () => {
    expect(activateWorldInfo([], 'anything').activated).toEqual([])
  })

  describe('probability', () => {
    it('never fires a keyword match at probability 0', () => {
      const b = book([entry({ content: 'X', keys: ['tavern'], probability: 0 })])
      for (let i = 0; i < 20; i++) {
        expect(activateWorldInfo([b], 'the tavern was loud').activated).toHaveLength(0)
      }
    })

    it('always fires a keyword match at probability 100', () => {
      const b = book([entry({ content: 'X', keys: ['tavern'], probability: 100 })])
      for (let i = 0; i < 20; i++) {
        expect(activateWorldInfo([b], 'the tavern was loud').activated).toHaveLength(1)
      }
    })

    it('does not gate "always" entries behind probability', () => {
      const b = book([entry({ content: 'X', constant: true, activationMode: 'always', probability: 0 })])
      expect(activateWorldInfo([b], 'text').activated).toHaveLength(1)
    })

    it('does not gate manual entries behind probability', () => {
      const b = book([entry({ content: 'X', activationMode: 'manual', enabled: true, probability: 0 })])
      expect(activateWorldInfo([b], 'text').activated).toHaveLength(1)
    })
  })

  describe('regex keys', () => {
    it('matches a /pattern/flags key as a regex instead of a literal substring', () => {
      const b = book([entry({ content: 'X', keys: ['/tav(ern|erna)/'] })])
      expect(activateWorldInfo([b], 'we found a taverna nearby').activated).toHaveLength(1)
      expect(activateWorldInfo([b], 'no match here').activated).toHaveLength(0)
    })

    it('honors regex flags such as case-insensitive "i"', () => {
      const b = book([entry({ content: 'X', keys: ['/tavern/i'] })])
      expect(activateWorldInfo([b], 'the TAVERN was loud').activated).toHaveLength(1)
    })

    it('falls back to literal matching for an invalid regex pattern', () => {
      const b = book([entry({ content: 'X', keys: ['/unterminated'] })])
      expect(activateWorldInfo([b], 'text with /unterminated inside').activated).toHaveLength(1)
    })

    it('respects the entry-level case_sensitive toggle even without an explicit "i" flag', () => {
      const insensitive = book([entry({ content: 'X', keys: ['/tavern/'], case_sensitive: false })])
      expect(activateWorldInfo([insensitive], 'the TAVERN was loud').activated).toHaveLength(1)
      const sensitive = book([entry({ content: 'X', keys: ['/tavern/'], case_sensitive: true })])
      expect(activateWorldInfo([sensitive], 'the TAVERN was loud').activated).toHaveLength(0)
      expect(activateWorldInfo([sensitive], 'the tavern was loud').activated).toHaveLength(1)
    })
  })

  describe('inclusion groups', () => {
    it('fires only the highest-insertion_order entry in a shared group', () => {
      const b = book([
        entry({ content: 'low', constant: true, activationMode: 'always', group: 'reaction', insertion_order: 10 }),
        entry({ content: 'high', constant: true, activationMode: 'always', group: 'reaction', insertion_order: 90 }),
      ])
      const result = activateWorldInfo([b], 'text')
      expect(result.activated.map((e) => e.content)).toEqual(['high'])
      expect(result.droppedForGroup.map((e) => e.content)).toEqual(['low'])
    })

    it('does not cross-exclude entries in different groups', () => {
      const b = book([
        entry({ content: 'a', constant: true, activationMode: 'always', group: 'group-a' }),
        entry({ content: 'b', constant: true, activationMode: 'always', group: 'group-b' }),
      ])
      const result = activateWorldInfo([b], 'text')
      expect(result.activated.map((e) => e.content).sort()).toEqual(['a', 'b'])
      expect(result.droppedForGroup).toHaveLength(0)
    })

    it('leaves ungrouped entries unaffected', () => {
      const b = book([entry({ content: 'solo', constant: true, activationMode: 'always' })])
      const result = activateWorldInfo([b], 'text')
      expect(result.activated).toHaveLength(1)
      expect(result.droppedForGroup).toHaveLength(0)
    })

    describe('weighted groups (groupWeight)', () => {
      it('never picks a zero-weight entry over a positive-weight peer', () => {
        const b = book([
          entry({ content: 'never', constant: true, activationMode: 'always', group: 'g', groupWeight: 0, insertion_order: 999 }),
          entry({ content: 'always', constant: true, activationMode: 'always', group: 'g', groupWeight: 1 }),
        ])
        for (let i = 0; i < 30; i++) {
          expect(activateWorldInfo([b], 'text').activated.map((e) => e.content)).toEqual(['always'])
        }
      })

      it('a heavily-weighted entry wins against several zero-weight peers regardless of insertion_order', () => {
        const b = book([
          entry({ content: 'winner', constant: true, activationMode: 'always', group: 'g', groupWeight: 1, insertion_order: 1 }),
          entry({ content: 'loser-a', constant: true, activationMode: 'always', group: 'g', groupWeight: 0, insertion_order: 999 }),
          entry({ content: 'loser-b', constant: true, activationMode: 'always', group: 'g', groupWeight: 0, insertion_order: 500 }),
        ])
        for (let i = 0; i < 30; i++) {
          expect(activateWorldInfo([b], 'text').activated.map((e) => e.content)).toEqual(['winner'])
        }
      })

      it('ignores groupWeight entirely (falls back to insertion_order) when no member of the group sets it', () => {
        const b = book([
          entry({ content: 'low', constant: true, activationMode: 'always', group: 'g', insertion_order: 10 }),
          entry({ content: 'high', constant: true, activationMode: 'always', group: 'g', insertion_order: 90 }),
        ])
        for (let i = 0; i < 10; i++) {
          expect(activateWorldInfo([b], 'text').activated.map((e) => e.content)).toEqual(['high'])
        }
      })

      it('an unset weight in a weighted group defaults to 1, not 0', () => {
        // Only one member ever sets groupWeight; the other two default to weight 1 and must be
        // reachable — asserting the winner varies across the 3 members over enough draws.
        const b = book([
          entry({ content: 'a', constant: true, activationMode: 'always', group: 'g' }),
          entry({ content: 'b', constant: true, activationMode: 'always', group: 'g' }),
          entry({ content: 'c', constant: true, activationMode: 'always', group: 'g', groupWeight: 1 }),
        ])
        const winners = new Set<string>()
        for (let i = 0; i < 200; i++) {
          winners.add(activateWorldInfo([b], 'text').activated[0].content)
        }
        expect(winners.size).toBeGreaterThan(1)
      })
    })
  })

  describe('recursive scanning', () => {
    it('activates a second entry whose keyword only appears in a first entry\'s content, when recursive_scanning is on', () => {
      const b: Lorebook = {
        recursive_scanning: true,
        entries: [
          entry({ content: 'The Duke rules from Ashfall Keep.', keys: ['duke'] }),
          entry({ content: 'Ashfall Keep is a fortress.', keys: ['ashfall keep'] }),
        ],
      }
      const result = activateWorldInfo([b], 'tell me about the duke')
      expect(result.activated.map((e) => e.content)).toEqual(
        expect.arrayContaining(['The Duke rules from Ashfall Keep.', 'Ashfall Keep is a fortress.']),
      )
    })

    it('does not chain into further entries when recursive_scanning is off', () => {
      const b: Lorebook = {
        recursive_scanning: false,
        entries: [
          entry({ content: 'The Duke rules from Ashfall Keep.', keys: ['duke'] }),
          entry({ content: 'Ashfall Keep is a fortress.', keys: ['ashfall keep'] }),
        ],
      }
      const result = activateWorldInfo([b], 'tell me about the duke')
      expect(result.activated.map((e) => e.content)).toEqual(['The Duke rules from Ashfall Keep.'])
    })

    it('does not loop forever on a cycle of entries that reference each other', () => {
      const b: Lorebook = {
        recursive_scanning: true,
        entries: [
          entry({ content: 'Mentions beta.', keys: ['alpha'] }),
          entry({ content: 'Mentions alpha.', keys: ['beta'] }),
        ],
      }
      const start = Date.now()
      const result = activateWorldInfo([b], 'alpha')
      expect(Date.now() - start).toBeLessThan(1000)
      expect(result.activated.map((e) => e.content).sort()).toEqual(['Mentions alpha.', 'Mentions beta.'])
    })

    it('never lets always/manual entries recursively trigger further matches', () => {
      const b: Lorebook = {
        recursive_scanning: true,
        entries: [
          entry({ content: 'Always mentions dragons.', constant: true, activationMode: 'always' }),
          entry({ content: 'About dragons.', keys: ['dragons'] }),
        ],
      }
      const result = activateWorldInfo([b], 'nothing relevant')
      expect(result.activated.map((e) => e.content)).toEqual(['Always mentions dragons.'])
    })
  })
})

describe('recentMessagesText', () => {
  it('joins the last N messages with newlines', () => {
    const messages = [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }]
    expect(recentMessagesText(messages, 2)).toBe('c\nd')
  })

  it('returns everything when scanDepth exceeds the message count', () => {
    const messages = [{ text: 'a' }, { text: 'b' }]
    expect(recentMessagesText(messages, 10)).toBe('a\nb')
  })

  it('returns an empty string for no messages', () => {
    expect(recentMessagesText([], 5)).toBe('')
  })
})
