import { describe, expect, it } from 'vitest'
import { buildSteerDirective } from './steer'

describe('buildSteerDirective', () => {
  it('names the character and includes the trimmed correction verbatim', () => {
    const line = buildSteerDirective('  stop escalating, she should pull back and change the subject  ', 'Sumire')
    expect(line).toContain('Sumire')
    expect(line).toContain('stop escalating, she should pull back and change the subject')
    expect(line).not.toMatch(/^\s|\s$/)
  })

  it('frames it as overriding the previous attempt, not adding to it', () => {
    const line = buildSteerDirective('be more hesitant', 'Sumire')
    expect(line).toMatch(/previous attempt went the wrong way/i)
    expect(line).toMatch(/overrides any instinct to continue/i)
  })
})
