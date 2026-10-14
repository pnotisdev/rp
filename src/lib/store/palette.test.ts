import { describe, expect, it } from 'vitest'
import { LEGACY_DARK_PALETTES, LEGACY_THEME_TOKENS, LEGACY_THEME_TOKENS_DARK, isUntouchedPalette, mergePalette } from './palette'

const fresh = { '--c-bg': '19 19 18', '--c-accent': '127 189 168', '--c-text': '236 234 229', '--c-border': '47 47 44' }

describe('isUntouchedPalette', () => {
  it('is true for nothing saved, an exact legacy palette, or a partial one', () => {
    expect(isUntouchedPalette(undefined, LEGACY_THEME_TOKENS_DARK)).toBe(true)
    expect(isUntouchedPalette({ ...LEGACY_THEME_TOKENS_DARK }, LEGACY_THEME_TOKENS_DARK)).toBe(true)
    expect(isUntouchedPalette({ '--c-accent': '94 224 197' }, LEGACY_THEME_TOKENS_DARK)).toBe(true)
  })

  it('is false once any token differs from its old default', () => {
    expect(isUntouchedPalette({ ...LEGACY_THEME_TOKENS_DARK, '--c-accent': '255 0 0' }, LEGACY_THEME_TOKENS_DARK)).toBe(false)
  })

  it('accepts any of several past palettes, per token', () => {
    const [oldest, teal] = LEGACY_DARK_PALETTES
    expect(isUntouchedPalette({ '--c-bg': oldest['--c-bg'], '--c-accent': teal['--c-accent'] }, LEGACY_DARK_PALETTES)).toBe(true)
    expect(isUntouchedPalette({ '--c-accent': '255 0 0' }, LEGACY_DARK_PALETTES)).toBe(false)
  })

  it('ignores keys the legacy palette never had', () => {
    expect(isUntouchedPalette({ '--c-custom': '1 2 3', '--c-bg': '17 18 18' }, LEGACY_THEME_TOKENS_DARK)).toBe(true)
  })
})

describe('mergePalette', () => {
  it('upgrades an untouched saved palette to the new defaults', () => {
    expect(mergePalette(fresh, { ...LEGACY_THEME_TOKENS_DARK }, LEGACY_THEME_TOKENS_DARK)).toEqual(fresh)
  })

  it('keeps a customized palette, backfilling missing tokens from the new defaults', () => {
    const saved = { '--c-accent': '255 80 80', '--c-bg': '17 18 18' }
    expect(mergePalette(fresh, saved, LEGACY_THEME_TOKENS_DARK)).toEqual({ ...fresh, ...saved })
  })

  it('leaves an already-migrated palette as it is', () => {
    expect(mergePalette(fresh, { ...fresh }, LEGACY_THEME_TOKENS)).toEqual(fresh)
  })
})
