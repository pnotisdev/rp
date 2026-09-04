import { describe, expect, it } from 'vitest'
import {
  creativityToParams,
  focusToParams,
  paramsToCreativity,
  paramsToFocus,
  paramsToRepetition,
  repetitionToParams,
} from './samplerSimpleMode'

describe('samplerSimpleMode', () => {
  it('maps creativity 0/50/100 to the documented temperature range', () => {
    expect(creativityToParams(0).temperature).toBe(0.2)
    expect(creativityToParams(100).temperature).toBe(1.8)
    expect(creativityToParams(50).temperature).toBeCloseTo(1.0, 5)
  })

  it('maps focus 0/100 to the documented top_p range (inverted — higher focus = lower top_p)', () => {
    expect(focusToParams(0).top_p).toBe(1)
    expect(focusToParams(100).top_p).toBe(0.5)
  })

  it('maps repetition 0/100 to the documented rep_pen range', () => {
    expect(repetitionToParams(0).rep_pen).toBe(1.0)
    expect(repetitionToParams(100).rep_pen).toBeCloseTo(1.3, 5)
  })

  it('round-trips params -> slider -> params to within 1 (storage rounds to 2-3 decimals, so an exact round-trip is not guaranteed at every slider value)', () => {
    for (const v of [0, 25, 50, 75, 100]) {
      expect(Math.abs(paramsToCreativity(creativityToParams(v).temperature) - v)).toBeLessThanOrEqual(1)
      expect(Math.abs(paramsToFocus(focusToParams(v).top_p) - v)).toBeLessThanOrEqual(1)
      expect(Math.abs(paramsToRepetition(repetitionToParams(v).rep_pen) - v)).toBeLessThanOrEqual(1)
    }
  })
})
