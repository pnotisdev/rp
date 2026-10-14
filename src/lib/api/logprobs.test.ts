import { describe, expect, it } from 'vitest'
import { displayToken, parseKoboldLogprobs, probabilityOf, tokenProbStore } from './logprobs'

describe('parseKoboldLogprobs', () => {
  it('reads OpenAI-shaped content entries', () => {
    const out = parseKoboldLogprobs({
      logprobs: { content: [{ token: 'Hello', logprob: -0.1, top_logprobs: [{ token: 'Hello', logprob: -0.1 }, { token: 'Hi', logprob: -2.5 }] }, { token: ' there', logprob: -0.7 }] },
    })
    expect(out).toHaveLength(2)
    expect(out[0].top.map((c) => c.token)).toEqual(['Hello', 'Hi'])
    expect(out[1].top).toEqual([{ token: ' there', logprob: -0.7 }])
  })

  it('reads parallel arrays with candidate lists or token maps, best first', () => {
    const out = parseKoboldLogprobs({
      logprobs: { tokens: ['A', 'B'], logprobs: [-0.2, -1], top_logprobs: [[{ token: 'X', logprob: -3 }, { token: 'A', logprob: -0.2 }], { A: -2, B: -1 }] },
    })
    expect(out[0].top.map((c) => c.token)).toEqual(['A', 'X'])
    expect(out[1].top.map((c) => c.token)).toEqual(['B', 'A'])
  })

  it('accepts the arrays without the logprobs wrapper', () => {
    expect(parseKoboldLogprobs({ tokens: ['A'], logprobs: [-0.5] })).toEqual([{ token: 'A', logprob: -0.5, top: [{ token: 'A', logprob: -0.5 }] }])
  })

  it('skips entries that are not usable and gives nothing for other shapes', () => {
    expect(parseKoboldLogprobs({ logprobs: { content: [{ token: 5 }, { token: 'ok', logprob: -1 }] } })).toHaveLength(1)
    expect(parseKoboldLogprobs(null)).toEqual([])
    expect(parseKoboldLogprobs({ logprobs: null })).toEqual([])
    expect(parseKoboldLogprobs({ tokens: ['A'], logprobs: 'x' })).toEqual([])
  })
})

describe('token helpers', () => {
  it('turns a log probability into a probability', () => {
    expect(probabilityOf(0)).toBe(1)
    expect(probabilityOf(Math.log(0.25))).toBeCloseTo(0.25)
  })

  it('shows space and newline markers as the characters they stand for', () => {
    expect(displayToken('▁the')).toBe(' the')
    expect(displayToken('Ġthe')).toBe(' the')
    expect(displayToken('aĊ')).toBe('a\n')
    expect(displayToken('plain')).toBe('plain')
  })

  it('keeps the latest probabilities by message id and drops the oldest past the limit', () => {
    tokenProbStore.clear()
    for (let i = 0; i < 45; i += 1) tokenProbStore.set(`m${i}`, [])
    expect(tokenProbStore.get('m0')).toBeUndefined()
    expect(tokenProbStore.get('m44')).toEqual([])
    tokenProbStore.clear()
  })
})
