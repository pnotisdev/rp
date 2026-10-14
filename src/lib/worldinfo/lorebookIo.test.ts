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
