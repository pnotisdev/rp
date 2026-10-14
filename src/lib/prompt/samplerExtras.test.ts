import { describe, expect, it } from 'vitest'
import { formatLogitBias, parseBreakers, parseList, parseLogitBias, parseSamplerOrder, stSamplerToParams } from './samplerExtras'

describe('text fields', () => {
  it('reads a list split by lines or commas', () => {
    expect(parseList('delve, tapestry\n  shiver\n\n')).toEqual(['delve', 'tapestry', 'shiver'])
    expect(parseList('')).toEqual([])
  })

  it('reads token biases, clamps them, and drops what is not a bias', () => {
    expect(parseLogitBias('1234: -100\n55 = 2.5\n9, 300\nnot a line\n7: -300')).toEqual({ '1234': -100, '55': 2.5, '9': 100, '7': -100 })
    expect(parseLogitBias('')).toEqual({})
  })

  it('writes token biases back as lines', () => {
    expect(formatLogitBias({ '12': -5, '9': 3 })).toBe('9: 3\n12: -5')
    expect(formatLogitBias(undefined)).toBe('')
    expect(parseLogitBias(formatLogitBias({ '5': 1.5 }))).toEqual({ '5': 1.5 })
  })

  it('reads a sampler order only when every id is a whole number', () => {
    expect(parseSamplerOrder('6, 0, 1, 3, 4, 2, 5')).toEqual([6, 0, 1, 3, 4, 2, 5])
    expect(parseSamplerOrder('6, x')).toBeUndefined()
    expect(parseSamplerOrder('1.5')).toBeUndefined()
    expect(parseSamplerOrder('')).toBeUndefined()
  })

  it('reads DRY breakers as JSON or as a plain list', () => {
    expect(parseBreakers('["\\n", ":", "*"]')).toEqual(['\n', ':', '*'])
    expect(parseBreakers('a, b')).toEqual(['a', 'b'])
    expect(parseBreakers('  ')).toBeUndefined()
  })
})

describe('SillyTavern sampler presets', () => {
  it('maps a KoboldAI preset', () => {
    const out = stSamplerToParams({
      temp: 1.5, rep_pen: 1, rep_pen_range: 0, top_p: 1, min_p: 0.1, top_a: 0, top_k: 0, typical: 1, tfs: 1, rep_pen_slope: 0,
      sampler_order: [5, 6, 0, 1, 2, 3, 4], mirostat: 0, mirostat_tau: 5, mirostat_eta: 0.1, use_default_badwordsids: false, grammar: '',
    })
    expect(out).toMatchObject({ temperature: 1.5, min_p: 0.1, typical: 1, sampler_order: [5, 6, 0, 1, 2, 3, 4], mirostat_tau: 5 })
    expect(out).not.toHaveProperty('grammar')
    expect(out).not.toHaveProperty('use_default_badwordsids')
  })

  it('maps a text-completion preset, including its names for the same settings', () => {
    const out = stSamplerToParams({
      temp: 1.2, typical_p: 0.9, presence_pen: 0.3, xtc_threshold: 0.1, xtc_probability: 0.5, smoothing_factor: 0.25, nsigma: 1.5,
      dry_multiplier: 0.8, dry_sequence_breakers: '["\\n", ":"]', grammar_string: 'root ::= "a"', banned_tokens: 'foo\nbar',
    })
    expect(out).toMatchObject({
      temperature: 1.2, typical: 0.9, presence_penalty: 0.3, xtc_threshold: 0.1, xtc_probability: 0.5, smoothing_factor: 0.25, nsigma: 1.5,
      dry_multiplier: 0.8, dry_sequence_breakers: ['\n', ':'], grammar: 'root ::= "a"', banned_tokens: ['foo', 'bar'],
    })
  })

  it('turns an on/off dynamic temperature with a min and max into a range', () => {
    expect(stSamplerToParams({ temp: 1, dynatemp: true, min_temp: 0.5, max_temp: 2, dynatemp_exponent: 1.5 })).toMatchObject({ dynatemp_range: 0.75, dynatemp_exponent: 1.5 })
    expect(stSamplerToParams({ temp: 1, dynatemp: false })).toMatchObject({ dynatemp_range: 0 })
  })

  it('keeps numeric logit biases only', () => {
    expect(stSamplerToParams({ temp: 1, logit_bias: { '5': -10, '6': 'x' } })).toMatchObject({ logit_bias: { '5': -10 } })
  })

  it('does not take other kinds of JSON for a sampler preset', () => {
    expect(stSamplerToParams({ name: 'ChatML', input_sequence: '<|im_start|>' })).toBeNull()
    expect(stSamplerToParams(null)).toBeNull()
    expect(stSamplerToParams([1])).toBeNull()
  })
})
