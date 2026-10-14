import { describe, expect, it } from 'vitest'
import { lorebookFromJson, lorebookToStJson } from './lorebookIo'

const st = {
  entries: {
    '0': { uid: 0, key: ['tea'], keysecondary: ['shop'], content: 'Tea facts', order: 50, position: 1, disable: false },
    '1': { uid: 1, key: ['moon'], content: 'Moon facts', constant: true, disable: true },
  },
}

describe('lorebook import/export', () => {
  it('reads a SillyTavern World Info file', () => {
    const book = lorebookFromJson(st)!
    expect(book.entries).toHaveLength(2)
    expect(book.entries[0]).toMatchObject({ keys: ['tea'], secondary_keys: ['shop'], insertion_order: 50, position: 'after_char', enabled: true })
    expect(book.entries[1]).toMatchObject({ constant: true, enabled: false })
  })

  it('finds the book inside a V2 card', () => {
    const card = { spec: 'chara_card_v2', data: { name: 'A', character_book: { entries: [{ keys: ['x'], content: 'y', enabled: true, constant: false, selective: false, insertion_order: 1 }] } } }
    expect(lorebookFromJson(card)!.entries[0].keys).toEqual(['x'])
  })

  it('round-trips through the ST format', () => {
    const book = lorebookFromJson(st)!
    expect(lorebookFromJson(lorebookToStJson(book))!.entries).toEqual(book.entries)
  })

  it('returns undefined for unrelated JSON', () => {
    expect(lorebookFromJson({ hello: 1 })).toBeUndefined()
  })
})

describe('SillyTavern entry options', () => {
  it('reads them from a World Info export', () => {
    const book = lorebookFromJson({
      entries: {
        '0': { uid: 0, key: ['a'], content: 'x', position: 7, outletName: 'weather', selectiveLogic: 3, scanDepth: 6, matchWholeWords: true, groupOverride: true, useGroupScoring: true, excludeRecursion: true, preventRecursion: true, delayUntilRecursion: true, ignoreBudget: true },
      },
    })!
    expect(book.entries[0]).toMatchObject({
      position: 'outlet', outletName: 'weather', selectiveLogic: 'and_all', scanDepth: 6, matchWholeWords: true, groupOverride: true, useGroupScoring: true, excludeRecursion: true, preventRecursion: true, delayUntilRecursion: true, ignoreBudget: true,
    })
  })

  it('reads them from the snake_case extensions of a V2 card', () => {
    const card = {
      spec: 'chara_card_v2',
      data: { name: 'A', character_book: { entries: [{ keys: ['k'], content: 'y', enabled: true, constant: false, selective: true, insertion_order: 1, extensions: { selectiveLogic: 2, scan_depth: 3, match_whole_words: true, group_override: true, exclude_recursion: true, prevent_recursion: true, delay_until_recursion: true } }] } },
    }
    expect(lorebookFromJson(card)!.entries[0]).toMatchObject({ selectiveLogic: 'not_any', scanDepth: 3, matchWholeWords: true, groupOverride: true, excludeRecursion: true, preventRecursion: true, delayUntilRecursion: true })
  })

  it('leaves them off an entry that does not set them', () => {
    const e = lorebookFromJson(st)!.entries[0]
    expect(e.selectiveLogic).toBeUndefined()
    expect(e.scanDepth).toBeUndefined()
    expect(e.matchWholeWords).toBeUndefined()
    expect(e.outletName).toBeUndefined()
  })

  it('round-trips every option through the export', () => {
    const entry = { keys: ['a'], content: 'x', enabled: true, constant: false, selective: true, secondary_keys: ['b'], insertion_order: 5, position: 'outlet' as const, outletName: 'weather', selectiveLogic: 'not_all' as const, scanDepth: 4, matchWholeWords: true, groupOverride: true, useGroupScoring: true, excludeRecursion: true, preventRecursion: true, delayUntilRecursion: true, ignoreBudget: true, group: 'g', sticky: 2, cooldown: 3, delay: 1 }
    const out = lorebookFromJson(lorebookToStJson({ entries: [{ ...entry, id: 0 }] }))!.entries[0]
    expect(out).toMatchObject(entry)
  })
})
