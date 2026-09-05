import { describe, expect, it } from 'vitest'
import { indefiniteArticleFor, withIndefiniteArticle } from './article'

describe('indefiniteArticleFor', () => {
  it('uses "a" before a consonant', () => {
    expect(indefiniteArticleFor('Flower Bouquet')).toBe('a')
    expect(indefiniteArticleFor('Silver Pendant')).toBe('a')
    expect(indefiniteArticleFor('Festival Kimono')).toBe('a')
  })

  it('uses "an" before a vowel', () => {
    expect(indefiniteArticleFor('Artisan Chocolate')).toBe('an')
    expect(indefiniteArticleFor('Old Photograph')).toBe('an')
  })

  it('handles a silent h', () => {
    expect(indefiniteArticleFor('Hourglass')).toBe('an')
    expect(indefiniteArticleFor('Honest Letter')).toBe('an')
    // Not silent — the ordinary rule still applies.
    expect(indefiniteArticleFor('Handmade Charm')).toBe('a')
  })

  it('handles a vowel that opens on a consonant sound', () => {
    expect(indefiniteArticleFor('University Scarf')).toBe('a')
    expect(indefiniteArticleFor('Used Paperback')).toBe('a')
    expect(indefiniteArticleFor('One-Way Ticket')).toBe('a')
  })

  it('adds nothing to a phrase that already has a determiner', () => {
    expect(indefiniteArticleFor('The Blue Scarf')).toBeNull()
    expect(indefiniteArticleFor('A Cup of Tea')).toBeNull()
    expect(indefiniteArticleFor('Some Sweets')).toBeNull()
    expect(indefiniteArticleFor('Her Old Diary')).toBeNull()
  })

  it('adds nothing to a count', () => {
    expect(indefiniteArticleFor('Two Tickets')).toBeNull()
    expect(indefiniteArticleFor('3 Gold Coins')).toBeNull()
  })

  it('adds nothing to a plural', () => {
    expect(indefiniteArticleFor('Chocolates')).toBeNull()
    expect(indefiniteArticleFor('Pressed Flowers')).toBeNull()
  })

  it('still adds one to a singular that merely ends in s', () => {
    expect(indefiniteArticleFor('Hand Mirror Glass')).toBe('a')
    expect(indefiniteArticleFor('Iris')).toBe('an')
  })

  it('takes number from the last word, not the first', () => {
    // "Box of Chocolates" is one box.
    expect(indefiniteArticleFor('Box of Chocolates')).toBeNull()
    expect(indefiniteArticleFor('Bouquet of Roses')).toBeNull()
    expect(indefiniteArticleFor('Silver Pendant')).toBe('a')
  })

  it('returns null rather than throwing on empty or punctuation-only input', () => {
    expect(indefiniteArticleFor('')).toBeNull()
    expect(indefiniteArticleFor('   ')).toBeNull()
    expect(indefiniteArticleFor('!!!')).toBeNull()
  })
})

describe('withIndefiniteArticle', () => {
  it('produces the gift line that prompted this', () => {
    // Was: "I give Sumire Pressed Flower Bookmark."
    expect(`I give Sumire ${withIndefiniteArticle('Pressed Flower Bookmark')}.`).toBe('I give Sumire a Pressed Flower Bookmark.')
  })

  it('leaves a phrase that takes no article alone, and trims it', () => {
    expect(withIndefiniteArticle('Chocolates')).toBe('Chocolates')
    expect(withIndefiniteArticle('  The Blue Scarf  ')).toBe('The Blue Scarf')
  })

  it('never doubles an article on repeated application', () => {
    expect(withIndefiniteArticle(withIndefiniteArticle('Flower Bouquet'))).toBe('a Flower Bouquet')
  })
})
