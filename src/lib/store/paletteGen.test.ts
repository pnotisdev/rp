import { describe, expect, it } from 'vitest'
import { contrast, paletteFromHue } from './paletteGen'

describe('contrast', () => {
  it('is 21 for black on white and 1 for identical colours', () => {
    expect.soft(contrast('0 0 0', '255 255 255')).toBeCloseTo(21, 0)
    expect.soft(contrast('120 40 40', '120 40 40')).toBeCloseTo(1, 5)
  })
})

describe('paletteFromHue', () => {
  const hues = Array.from({ length: 24 }, (_, i) => i * 15)
  const vivids = [0, 0.5, 1]

  it('keeps text, muted text and accent readable for every hue and colourfulness', () => {
    for (const h of hues) {
      for (const v of vivids) {
        const { light, dark } = paletteFromHue(h, v)
        for (const [mode, t] of [['light', light], ['dark', dark]] as const) {
          const at = `${mode} hue ${h} vivid ${v}`
          expect.soft(contrast(t['--c-text'], t['--c-bg']), `text on bg, ${at}`).toBeGreaterThanOrEqual(7)
          expect.soft(contrast(t['--c-text'], t['--c-bg-elevated']), `text on panel, ${at}`).toBeGreaterThanOrEqual(7)
          expect.soft(contrast(t['--c-text-muted'], t['--c-bg']), `muted on bg, ${at}`).toBeGreaterThanOrEqual(4)
          expect.soft(contrast(t['--c-accent-text'], t['--c-accent']), `text on accent, ${at}`).toBeGreaterThanOrEqual(4.5)
          expect.soft(contrast(t['--c-accent'], t['--c-bg']), `accent on bg, ${at}`).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })

  it('wraps hues and clamps colourfulness instead of producing junk', () => {
    expect(paletteFromHue(375, 0.5)).toEqual(paletteFromHue(15, 0.5))
    expect(paletteFromHue(-345, 2)).toEqual(paletteFromHue(15, 1))
  })

  it('writes only "R G B" triplets', () => {
    for (const t of Object.values({ ...paletteFromHue(200).light, ...paletteFromHue(200).dark })) expect(t).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/)
  })
})
