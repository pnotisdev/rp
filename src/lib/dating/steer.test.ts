import { describe, expect, it } from 'vitest'
import { buildSteerDirective, hardFailCorrectionDirective } from './steer'

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

describe('hardFailCorrectionDirective', () => {
  it('is undefined when neither a boundary cross nor an agency violation fired', () => {
    expect(hardFailCorrectionDirective('Sumire', 'Kai', undefined, undefined)).toBeUndefined()
  })

  it('names the boundary phrase that was crossed', () => {
    const line = hardFailCorrectionDirective('Sumire', 'Kai', 'no knife play', undefined)!
    expect(line).toContain('crossed a stated limit')
    expect(line).toContain('no knife play')
    expect(line).toContain('Sumire')
  })

  it("names the agency violation, quoting Kai's name as the userName", () => {
    const line = hardFailCorrectionDirective('Sumire', 'Kai', undefined, 'Kai felt a rush of relief.')!
    expect(line).toContain("narrated Kai's own action, feeling, or thought for them")
    expect(line).toContain('Kai felt a rush of relief.')
  })

  it('names both when both fired, joined naturally', () => {
    const line = hardFailCorrectionDirective('Sumire', 'Kai', 'no knife play', 'Kai felt a rush of relief.')!
    expect(line).toContain('no knife play')
    expect(line).toContain('Kai felt a rush of relief.')
    expect(line).toMatch(/crossed a stated limit.*and it narrated/)
  })

  it('reuses buildSteerDirective\'s own "override the previous attempt" framing', () => {
    const line = hardFailCorrectionDirective('Sumire', 'Kai', 'no knife play', undefined)!
    expect(line).toMatch(/previous attempt went the wrong way/i)
  })
})
