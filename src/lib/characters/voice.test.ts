import { describe, expect, it } from 'vitest'
import {
  countProseWords,
  deriveCardReplyBand,
  extractExampleCharTurns,
  replyMaxTokens,
  resolveReplyLength,
} from './voice'

const TERSE_EXAMPLES = [
  '<START>',
  '{{user}}: How was your day?',
  '{{char}}: Fine.',
  '<START>',
  '{{user}}: Want to get lunch?',
  '{{char}}: *shrugs* If you\'re paying.',
].join('\n')

const VERBOSE_EXAMPLES = [
  '<START>',
  '{{user}}: Tell me about this place.',
  `{{char}}: *She gestures at the water, the light catching the ring on her hand.* This harbour was the first thing I ever painted, back when I still believed a horizon could be got right in a single afternoon if you only stared at it hard enough. It cannot, obviously. I have tried perhaps forty times since, in every season and every kind of weather, and each attempt is wrong in a slightly different and slightly more interesting way than the last. The morning ones come out too kind. The winter ones lie about the cold. *A pause, wry, as she tucks a loose strand of hair back.* You asked a small question and I have handed you the entire lecture, complete with footnotes. That tends to happen when someone lets me talk about the work. Consider yourself warned for next time.`,
].join('\n')

describe('countProseWords', () => {
  it('ignores wrapping asterisks and quote marks', () => {
    expect(countProseWords('*She waves.* "Hi there."')).toBe(4)
  })
})

describe('extractExampleCharTurns', () => {
  it('pulls only the {{char}} turns out of a SillyTavern example block', () => {
    const turns = extractExampleCharTurns(TERSE_EXAMPLES)
    expect(turns).toEqual(['Fine.', "*shrugs* If you're paying."])
  })

  it('returns nothing for loose prose with no speaker labels', () => {
    expect(extractExampleCharTurns('She walked in and sat down without a word.')).toEqual([])
  })
})

describe('deriveCardReplyBand', () => {
  it('bands a terse card as brief, from its examples', () => {
    const d = deriveCardReplyBand({ mes_example: TERSE_EXAMPLES, first_mes: '' })
    expect(d.band).toBe('brief')
    expect(d.source).toBe('examples')
  })

  it('bands a verbose card as detailed', () => {
    expect(deriveCardReplyBand({ mes_example: VERBOSE_EXAMPLES, first_mes: '' }).band).toBe('detailed')
  })

  it('falls back to the greeting when there is no example dialogue', () => {
    const d = deriveCardReplyBand({ mes_example: '', first_mes: 'Hey. *She looks up briefly, then back at her book.* You need something?' })
    expect(d.source).toBe('greeting')
  })

  it('defaults to moderate for a blank card', () => {
    expect(deriveCardReplyBand({ mes_example: '', first_mes: '' })).toEqual({ band: 'moderate', measuredWords: 0, source: 'default' })
  })
})

describe('resolveReplyLength', () => {
  it('an explicit override wins over the card measurement', () => {
    const r = resolveReplyLength('detailed', { mes_example: TERSE_EXAMPLES, first_mes: '' })
    expect(r.band).toBe('detailed')
    expect(r.derived).toBe(false)
  })

  it('auto / unset measures the card and points the model at its own examples', () => {
    const r = resolveReplyLength(undefined, { mes_example: TERSE_EXAMPLES, first_mes: '' })
    expect(r.band).toBe('brief')
    expect(r.derived).toBe(true)
    expect(r.instruction).toContain('example dialogue')
  })
})

describe('replyMaxTokens', () => {
  it('caps well below the user max for a brief band', () => {
    expect(replyMaxTokens('brief', 512)).toBeLessThan(160)
  })

  it('never raises the user ceiling', () => {
    expect(replyMaxTokens('detailed', 120)).toBeLessThanOrEqual(120)
  })

  it('keeps a sane floor even against an extreme user setting', () => {
    expect(replyMaxTokens('brief', 10)).toBeGreaterThanOrEqual(48)
  })
})
