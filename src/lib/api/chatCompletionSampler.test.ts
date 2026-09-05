import { describe, expect, it } from 'vitest'
import { chatCompletionSamplerToRequest } from './chatCompletionSampler'
import { DEFAULT_CHAT_COMPLETION_SAMPLER } from './types'

describe('chatCompletionSamplerToRequest', () => {
  it('maps temperature/top_p/presence_penalty/frequency_penalty straight through', () => {
    const req = chatCompletionSamplerToRequest({
      ...DEFAULT_CHAT_COMPLETION_SAMPLER,
      temperature: 0.8,
      top_p: 0.9,
      presence_penalty: 0.5,
      frequency_penalty: -0.5,
    })
    expect(req.temperature).toBe(0.8)
    expect(req.top_p).toBe(0.9)
    expect(req.presence_penalty).toBe(0.5)
    expect(req.frequency_penalty).toBe(-0.5)
  })

  it("omits reasoning_effort and verbosity entirely when left at 'auto'", () => {
    const req = chatCompletionSamplerToRequest(DEFAULT_CHAT_COMPLETION_SAMPLER)
    expect(req.reasoning_effort).toBeUndefined()
    expect(req.verbosity).toBeUndefined()
    expect('reasoning_effort' in JSON.parse(JSON.stringify(req))).toBe(false)
    expect('verbosity' in JSON.parse(JSON.stringify(req))).toBe(false)
  })

  it('passes reasoning_effort and verbosity through when set to a real value', () => {
    const req = chatCompletionSamplerToRequest({
      ...DEFAULT_CHAT_COMPLETION_SAMPLER,
      reasoningEffort: 'high',
      verbosity: 'low',
    })
    expect(req.reasoning_effort).toBe('high')
    expect(req.verbosity).toBe('low')
  })
})
