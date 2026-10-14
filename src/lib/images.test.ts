import { describe, expect, it } from 'vitest'
import { fitWithin } from './images'

describe('fitWithin', () => {
  it('scales the longest edge down and keeps the aspect ratio', () => {
    expect(fitWithin(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 })
    expect(fitWithin(600, 1800, 900)).toEqual({ width: 300, height: 900 })
  })

  it('never enlarges, and never returns zero', () => {
    expect(fitWithin(300, 200, 1024)).toEqual({ width: 300, height: 200 })
    expect(fitWithin(1, 5000, 100)).toEqual({ width: 1, height: 100 })
  })
})
