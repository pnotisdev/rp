import { describe, expect, it } from 'vitest'
import { FONT_STACKS, isFontId } from './fonts'
import { BACKDROPS, LOOKS, matchingLookId, type LookState } from './looks'
import { contrast } from './paletteGen'
import { DEFAULT_THEME_TOKENS, DEFAULT_THEME_TOKENS_DARK, useSettingsStore } from './useSettingsStore'

const defaults = { light: DEFAULT_THEME_TOKENS, dark: DEFAULT_THEME_TOKENS_DARK }

const stateOf = (look: (typeof LOOKS)[number]): LookState => ({
  themeTokensLight: { ...DEFAULT_THEME_TOKENS, ...look.light },
  themeTokensDark: { ...DEFAULT_THEME_TOKENS_DARK, ...look.dark },
  uiFont: look.uiFont,
  readFont: look.readFont,
  displayFont: look.displayFont,
  radiusPx: look.radiusPx,
  backdrop: look.backdrop,
  glass: look.glass,
  chatStyle: look.chatStyle,
  avatarShape: look.avatarShape,
})

describe('looks', () => {
  it('have unique ids and names, and only valid fonts, backdrops and radii', () => {
    expect(new Set(LOOKS.map((l) => l.id)).size).toBe(LOOKS.length)
    expect(new Set(LOOKS.map((l) => l.name)).size).toBe(LOOKS.length)
    for (const l of LOOKS) {
      for (const f of [l.uiFont, l.readFont, l.displayFont]) expect(isFontId(f) && FONT_STACKS[f], l.id).toBeTruthy()
      expect(BACKDROPS.some((b) => b.id === l.backdrop), l.id).toBe(true)
      expect(l.radiusPx).toBeGreaterThanOrEqual(0)
      expect(l.radiusPx).toBeLessThanOrEqual(20)
    }
  })

  it('keep every palette readable in both modes', () => {
    for (const l of LOOKS) {
      for (const [mode, tokens] of [['light', { ...DEFAULT_THEME_TOKENS, ...l.light }], ['dark', { ...DEFAULT_THEME_TOKENS_DARK, ...l.dark }]] as const) {
        const at = `${l.id} ${mode}`
        expect.soft(contrast(tokens['--c-text'], tokens['--c-bg']), `text on bg, ${at}`).toBeGreaterThanOrEqual(7)
        expect.soft(contrast(tokens['--c-text'], tokens['--c-bg-elevated']), `text on panel, ${at}`).toBeGreaterThanOrEqual(7)
        expect.soft(contrast(tokens['--c-text'], tokens['--c-bg-sunken']), `text on well, ${at}`).toBeGreaterThanOrEqual(7)
        expect.soft(contrast(tokens['--c-text-muted'], tokens['--c-bg']), `muted on bg, ${at}`).toBeGreaterThanOrEqual(4)
        expect.soft(contrast(tokens['--c-text-muted'], tokens['--c-bg-elevated']), `muted on panel, ${at}`).toBeGreaterThanOrEqual(3.8)
        expect.soft(contrast(tokens['--c-accent-text'], tokens['--c-accent']), `text on accent, ${at}`).toBeGreaterThanOrEqual(4.5)
        expect.soft(contrast(tokens['--c-accent'], tokens['--c-bg']), `accent on bg, ${at}`).toBeGreaterThanOrEqual(3)
        expect.soft(contrast(tokens['--c-text'], tokens['--c-msg-char']), `text in their message, ${at}`).toBeGreaterThanOrEqual(7)
        expect.soft(contrast(tokens['--c-accent-text'], tokens['--c-msg-user']), `text in your message, ${at}`).toBeGreaterThanOrEqual(4.5)
        expect.soft(contrast(tokens['--c-romance-text'], tokens['--c-romance']), `text on romance, ${at}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('are recognised once applied, and not once anything is tweaked', () => {
    for (const l of LOOKS) expect(matchingLookId(stateOf(l), defaults), l.id).toBe(l.id)
    const tweaked = { ...stateOf(LOOKS[1]), radiusPx: LOOKS[1].radiusPx + 1 }
    expect(matchingLookId(tweaked, defaults)).toBeNull()
    const recoloured = stateOf(LOOKS[2])
    recoloured.themeTokensDark = { ...recoloured.themeTokensDark, '--c-accent': '1 2 3' }
    expect(matchingLookId(recoloured, defaults)).toBeNull()
  })

  it('applyLook in the store switches everything, including the colour mode', () => {
    const hanami = LOOKS.find((l) => l.id === 'hanami')!
    useSettingsStore.getState().applyLook(hanami)
    const st = useSettingsStore.getState()
    expect(st.colorMode).toBe('light')
    expect(matchingLookId(st, defaults)).toBe('hanami')
    useSettingsStore.getState().applyLook(LOOKS[0])
    expect(matchingLookId(useSettingsStore.getState(), defaults)).toBe('ember')
  })
})
