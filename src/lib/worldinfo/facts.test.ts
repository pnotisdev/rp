import { describe, expect, it } from 'vitest'
import { buildFactsLorebook, factContent, FACTS_TOKEN_BUDGET } from './facts'
import { activateWorldInfo } from './activation'
import type { ChatFact } from '@/lib/types'

let nextId = 1
function fact(overrides: Partial<ChatFact> & { text: string; createdAt: number }): ChatFact {
  return {
    id: String(nextId++),
    chatId: 'chat-1',
    active: true,
    ...overrides,
  }
}

describe('buildFactsLorebook', () => {
  it('returns nothing for an empty fact list', () => {
    expect(buildFactsLorebook([])).toEqual([])
  })

  it('wraps facts as one always-mode, constant-entry book', () => {
    const books = buildFactsLorebook([fact({ text: 'Likes tea.', createdAt: 1 })])
    expect(books).toHaveLength(1)
    expect(books[0].name).toBe('Remembered facts')
    expect(books[0].entries).toHaveLength(1)
    expect(books[0].entries[0]).toMatchObject({ content: 'Likes tea.', constant: true, activationMode: 'always' })
  })

  it('caps the book to the given token budget', () => {
    const books = buildFactsLorebook([fact({ text: 'x', createdAt: 1 })], 42)
    expect(books[0].token_budget).toBe(42)
  })

  it('defaults to FACTS_TOKEN_BUDGET when no budget is given', () => {
    const books = buildFactsLorebook([fact({ text: 'x', createdAt: 1 })])
    expect(books[0].token_budget).toBe(FACTS_TOKEN_BUDGET)
  })

  it('orders entries oldest-to-newest, giving more recent facts a higher insertion_order', () => {
    const older = fact({ text: 'Old fact.', createdAt: 100 })
    const newer = fact({ text: 'New fact.', createdAt: 200 })
    // Passed in newest-first, on purpose — the function does its own sort, not just a pass-through.
    const [book] = buildFactsLorebook([newer, older])
    const [olderEntry, newerEntry] = book.entries
    expect(olderEntry.content).toBe('Old fact.')
    expect(newerEntry.content).toBe('New fact.')
    expect(newerEntry.insertion_order).toBeGreaterThan(olderEntry.insertion_order)
  })

  it('with no emotional metadata, still orders purely by recency (unchanged behaviour)', () => {
    const [book] = buildFactsLorebook([
      fact({ text: 'oldest', createdAt: 1 }),
      fact({ text: 'middle', createdAt: 2 }),
      fact({ text: 'newest', createdAt: 3 }),
    ])
    expect(book.entries.map((e) => e.content)).toEqual(['oldest', 'middle', 'newest'])
  })

  it('a high-importance older fact outranks a trivial recent one', () => {
    const [book] = buildFactsLorebook([
      fact({ text: 'She told me her real reason for leaving her hometown.', createdAt: 1, importance: 0.9 }),
      fact({ text: 'Ordered the pasta.', createdAt: 2, importance: 0.1 }),
    ])
    // higher insertion_order = kept under budget pressure + printed closest to generation
    const important = book.entries.find((e) => e.content.includes('real reason'))!
    const trivial = book.entries.find((e) => e.content.includes('pasta'))!
    expect(important.insertion_order).toBeGreaterThan(trivial.insertion_order)
  })

  it('an unresolved fact gets a priority bump and a flagged content wrapper', () => {
    const [book] = buildFactsLorebook([
      fact({ text: 'Likes her coffee black.', createdAt: 2, importance: 0.4 }),
      fact({ text: 'Forgot her birthday.', createdAt: 1, importance: 0.4, valence: -0.7, unresolved: true }),
    ])
    const wound = book.entries.find((e) => e.content.includes('birthday'))!
    const trivial = book.entries.find((e) => e.content.includes('coffee'))!
    expect(wound.content).toBe('Still unsettled, not resolved: Forgot her birthday.')
    expect(wound.insertion_order).toBeGreaterThan(trivial.insertion_order)
  })

  it('factContent: negative unresolved gets the strong tag, non-negative unresolved the light one, resolved is plain', () => {
    expect(factContent({ text: 'x', valence: -0.5, unresolved: true })).toBe('Still unsettled, not resolved: x')
    expect(factContent({ text: 'x', valence: 0.3, unresolved: true })).toBe('Still an open thread: x')
    expect(factContent({ text: 'x', valence: -0.5, unresolved: false })).toBe('x')
    expect(factContent({ text: 'x' })).toBe('x')
  })

  it('end to end with activateWorldInfo: a tight budget keeps the most recent facts, drops the oldest', () => {
    const facts = [
      fact({ text: 'This is the oldest remembered fact about the trip.', createdAt: 1 }),
      fact({ text: 'This is a middle remembered fact about the promise.', createdAt: 2 }),
      fact({ text: 'This is the newest remembered fact about tonight.', createdAt: 3 }),
    ]
    // Each fact costs ~13 tokens (chars/4) — a budget that only fits one forces the choice.
    const books = buildFactsLorebook(facts, 15)
    const result = activateWorldInfo(books, '')
    expect(result.activated).toHaveLength(1)
    expect(result.activated[0].content).toContain('newest')
    expect(result.droppedForBudget.map((e) => e.content)).toEqual(
      expect.arrayContaining([expect.stringContaining('oldest'), expect.stringContaining('middle')]),
    )
  })
})
