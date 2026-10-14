import { describe, expect, it } from 'vitest'
import { DECK_LIB, languageLab } from './languageLab'
import { loadLib, runScript } from './harness'

const DAY = 86_400_000

describe('language lab prompt', () => {
  it('asks for immersion at the chosen level with glosses and corrections by default', async () => {
    const s = await runScript(languageLab, { settings: { language: 'Spanish', level: 'Intermediate' } })
    const { label, text } = await s.context()
    expect(label).toBe('Spanish')
    expect(text).toContain('learning Spanish at a intermediate level')
    expect(text).toContain('entirely in Spanish')
    expect(text).toContain('short English translation')
    expect(text).toContain('starting with "Tip:"')
  })

  it('follows the other modes and switches', async () => {
    const s = await runScript(languageLab, { settings: { mode: 'dialogue', glossing: 'none', corrections: false, language: 'Japanese' } })
    const { text } = await s.context()
    expect(text).toContain('narration in English')
    expect(text).toContain('Do not add translations')
    expect(text).not.toContain('Tip:')
    expect(await (await runScript(languageLab, { settings: { enabled: false } })).context()).toBeNull()
  })
})

describe('deck scheduling', () => {
  const Deck = loadLib<any>(DECK_LIB, 'Deck')

  it('creates trimmed cards that are due immediately', () => {
    const c = Deck.make('  猫 ', 'neko', 'cat', '猫がいる', 1000)
    expect(c).toMatchObject({ word: '猫', box: 0, due: 1000 })
    expect(Deck.due([c], 1000)).toHaveLength(1)
  })

  it('moves cards up the boxes and back down on a miss', () => {
    const c = Deck.make('a', '', 'x', '', 0)
    Deck.grade(c, 'good', 0)
    expect(c).toMatchObject({ box: 1, due: DAY })
    Deck.grade(c, 'easy', 0)
    expect(c).toMatchObject({ box: 3, due: 7 * DAY })
    Deck.grade(c, 'easy', 0)
    Deck.grade(c, 'easy', 0)
    expect(c.box).toBe(5) // capped at the last box
    Deck.grade(c, 'again', 0)
    expect(c).toMatchObject({ box: 0, due: 10 * 60_000 })
  })

  it('lists due cards oldest first, detects duplicates and exports TSV', () => {
    const a = { ...Deck.make('a', '', '1', '', 0), due: 500 }
    const b = { ...Deck.make('b', 'r', '2', 'e', 0), due: 100 }
    const later = { ...Deck.make('c', '', '3', '', 0), due: 9999 }
    expect(Deck.due([a, b, later], 1000).map((c: { word: string }) => c.word)).toEqual(['b', 'a'])
    expect(Deck.has([a], ' A ')).toBe(true)
    expect(Deck.tsv([b])).toBe('b\tr\t2\te')
  })
})
