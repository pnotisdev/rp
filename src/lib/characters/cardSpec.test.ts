import { describe, expect, it } from 'vitest'
import { blankCharacterData, normalizeCardJson, wrapCardV2 } from './cardSpec'

describe('normalizeCardJson', () => {
  it('normalizes a V2-wrapped card ({spec, data})', () => {
    const card = normalizeCardJson({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name: 'Mika', description: 'A barista.', personality: 'Warm', scenario: '', first_mes: 'Hi!', mes_example: '' },
    })
    expect(card.name).toBe('Mika')
    expect(card.description).toBe('A barista.')
  })

  it('normalizes a legacy flat V1 card (fields at top level, no data wrapper)', () => {
    const card = normalizeCardJson({ name: 'Rex', description: 'A blacksmith.', personality: 'Gruff' })
    expect(card.name).toBe('Rex')
    expect(card.description).toBe('A blacksmith.')
    expect(card.personality).toBe('Gruff')
  })

  it('falls back to "Imported Character" when name is missing or not a string', () => {
    expect(normalizeCardJson({ description: 'no name here' }).name).toBe('Imported Character')
    expect(normalizeCardJson({ name: 42, description: 'x' }).name).toBe('Imported Character')
  })

  it('joins an array mistakenly returned for a string field (strLenient)', () => {
    const card = normalizeCardJson({
      name: 'Elias',
      mes_example: ['First line.', 'Second line.'],
    })
    expect(card.mes_example).toBe('First line.\n\nSecond line.')
  })

  it('drops non-string entries from a lenient array field', () => {
    const card = normalizeCardJson({ name: 'Elias', description: ['ok', 42, 'also ok', null] })
    expect(card.description).toBe('ok\n\nalso ok')
  })

  it('defaults every optional string field to an empty string, never undefined', () => {
    const card = normalizeCardJson({ name: 'Bare' })
    expect(card.description).toBe('')
    expect(card.personality).toBe('')
    expect(card.scenario).toBe('')
    expect(card.first_mes).toBe('')
    expect(card.mes_example).toBe('')
  })

  it('defaults alternate_greetings and tags to empty arrays when missing or malformed', () => {
    const card = normalizeCardJson({ name: 'Bare', alternate_greetings: 'not an array', tags: null })
    expect(card.alternate_greetings).toEqual([])
    expect(card.tags).toEqual([])
  })

  it('preserves extensions as an object, defaulting to {} when absent', () => {
    expect(normalizeCardJson({ name: 'X' }).extensions).toEqual({})
    expect(normalizeCardJson({ name: 'X', extensions: { foo: 'bar' } }).extensions).toEqual({ foo: 'bar' })
  })

  it('throws on non-object input', () => {
    expect(() => normalizeCardJson(null)).toThrow()
    expect(() => normalizeCardJson('just a string')).toThrow()
    expect(() => normalizeCardJson(42)).toThrow()
  })

  describe('character_book normalization', () => {
    it('normalizes lorebook entries given as an array', () => {
      const card = normalizeCardJson({
        name: 'X',
        character_book: {
          name: 'X Lore',
          entries: [{ keys: ['home'], content: 'Lives in a cottage.', constant: false }],
        },
      })
      expect(card.character_book?.entries).toHaveLength(1)
      expect(card.character_book?.entries[0].keys).toEqual(['home'])
      expect(card.character_book?.entries[0].content).toBe('Lives in a cottage.')
      // Falls back to 'keyword' mode when constant is false and activationMode is unset.
      expect(card.character_book?.entries[0].activationMode).toBe('keyword')
    })

    it('normalizes lorebook entries given as an id-keyed object map (some ST exports do this)', () => {
      const card = normalizeCardJson({
        name: 'X',
        character_book: {
          entries: {
            '0': { keys: ['a'], content: 'A' },
            '1': { keys: ['b'], content: 'B' },
          },
        },
      })
      expect(card.character_book?.entries).toHaveLength(2)
      expect(card.character_book?.entries.map((e) => e.content).sort()).toEqual(['A', 'B'])
    })

    it('treats constant:true entries as "always" activation mode by default', () => {
      const card = normalizeCardJson({
        name: 'X',
        character_book: { entries: [{ keys: [], content: 'Always here', constant: true }] },
      })
      expect(card.character_book?.entries[0].activationMode).toBe('always')
    })

    it('respects an explicit activationMode over the constant-derived default', () => {
      const card = normalizeCardJson({
        name: 'X',
        character_book: { entries: [{ keys: [], content: 'X', constant: false, activationMode: 'manual' }] },
      })
      expect(card.character_book?.entries[0].activationMode).toBe('manual')
    })

    it('reads a legacy "key" field when "keys" is absent', () => {
      const card = normalizeCardJson({
        name: 'X',
        character_book: { entries: [{ key: ['legacy'], content: 'X' }] },
      })
      expect(card.character_book?.entries[0].keys).toEqual(['legacy'])
    })

    it('honors an explicit "disable: true" flag as enabled:false when "enabled" is absent', () => {
      const card = normalizeCardJson({
        name: 'X',
        character_book: { entries: [{ keys: [], content: 'X', disable: true }] },
      })
      expect(card.character_book?.entries[0].enabled).toBe(false)
    })

    it('preserves probability (when useProbability is not false) and group on import', () => {
      const card = normalizeCardJson({
        name: 'X',
        character_book: {
          entries: [
            { keys: ['a'], content: 'A', probability: 40, useProbability: true, group: 'reaction' },
            { keys: ['b'], content: 'B', probability: 90 },
          ],
        },
      })
      const [a, b] = card.character_book!.entries
      expect(a.probability).toBe(40)
      expect(a.group).toBe('reaction')
      expect(b.probability).toBe(90)
    })

    it('drops probability when useProbability is explicitly false', () => {
      const card = normalizeCardJson({
        name: 'X',
        character_book: { entries: [{ keys: ['a'], content: 'A', probability: 40, useProbability: false }] },
      })
      expect(card.character_book?.entries[0].probability).toBeUndefined()
    })

    it('is undefined when character_book is absent or not an object', () => {
      expect(normalizeCardJson({ name: 'X' }).character_book).toBeUndefined()
      expect(normalizeCardJson({ name: 'X', character_book: 'nope' }).character_book).toBeUndefined()
    })
  })
})

describe('blankCharacterData / wrapCardV2', () => {
  it('blankCharacterData produces a fully-formed, empty card', () => {
    const card = blankCharacterData()
    expect(card.name).toBe('New Character')
    expect(card.description).toBe('')
    expect(card.alternate_greetings).toEqual([])
  })

  it('wrapCardV2 wraps card data in the chara_card_v2 envelope', () => {
    const data = blankCharacterData('Test')
    expect(wrapCardV2(data)).toEqual({ spec: 'chara_card_v2', spec_version: '2.0', data })
  })

  it('round-trips through wrapCardV2 -> normalizeCardJson without loss', () => {
    const original = { ...blankCharacterData('Round Trip'), description: 'A test.' }
    const normalized = normalizeCardJson(wrapCardV2(original))
    expect(normalized.name).toBe('Round Trip')
    expect(normalized.description).toBe('A test.')
  })
})
