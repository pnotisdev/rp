/**
 * Built-in color-palette presets a user can pick without hand-editing every swatch — a starting
 * point, not a locked-in look (applying one just calls the same setThemeToken() the color picker
 * uses, so every value stays editable afterward same as any hand-tuned theme). Deliberately only
 * touches color tokens, not chatStyle/avatarShape/layout/customCss — a palette shouldn't silently
 * reach into unrelated settings the way a full saved-theme "Apply" does.
 */
export interface ThemePreset {
  id: string
  name: string
  light: Record<string, string>
  dark: Record<string, string>
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'sakura',
    name: 'Sakura',
    light: {
      '--c-bg': '253 245 247',
      '--c-bg-elevated': '255 255 255',
      '--c-bg-sunken': '250 232 236',
      '--c-border': '240 210 218',
      '--c-text': '58 34 42',
      '--c-text-muted': '168 128 138',
      '--c-accent': '219 112 147',
      '--c-accent-text': '255 255 255',
      '--c-msg-user': '219 112 147',
      '--c-msg-char': '255 255 255',
      '--c-danger': '197 48 78',
    },
    dark: {
      '--c-bg': '26 15 20',
      '--c-bg-elevated': '38 22 29',
      '--c-bg-sunken': '18 10 14',
      '--c-border': '58 34 42',
      '--c-text': '245 230 234',
      '--c-text-muted': '168 138 148',
      '--c-accent': '244 158 186',
      '--c-accent-text': '26 15 20',
      '--c-msg-user': '244 158 186',
      '--c-msg-char': '38 22 29',
      '--c-danger': '240 120 140',
    },
  },
  {
    id: 'neon-night',
    name: 'Neon Night',
    light: {
      '--c-bg': '250 250 252',
      '--c-bg-elevated': '255 255 255',
      '--c-bg-sunken': '240 240 245',
      '--c-border': '224 224 232',
      '--c-text': '20 20 28',
      '--c-text-muted': '120 120 135',
      '--c-accent': '217 70 239',
      '--c-accent-text': '255 255 255',
      '--c-msg-user': '217 70 239',
      '--c-msg-char': '255 255 255',
      '--c-danger': '225 29 72',
    },
    dark: {
      '--c-bg': '8 8 16',
      '--c-bg-elevated': '15 15 26',
      '--c-bg-sunken': '5 5 11',
      '--c-border': '35 35 55',
      '--c-text': '230 230 245',
      '--c-text-muted': '140 140 165',
      '--c-accent': '224 64 251',
      '--c-accent-text': '8 8 16',
      '--c-msg-user': '224 64 251',
      '--c-msg-char': '15 15 26',
      '--c-danger': '255 61 87',
    },
  },
  {
    // Tuned for contrast, not mood — near-black-on-white / near-white-on-black text (~19:1,
    // well past WCAG's 7:1 "AAA" bar), an actually-visible border instead of the default's subtle
    // near-invisible divider (WCAG 1.4.11 non-text contrast), and a bright, punchy accent picked
    // for legibility over brand consistency between the two modes — blue-on-white in light mode,
    // gold-on-black in dark, since a single hue that reads well against both isn't the same color.
    id: 'high-contrast',
    name: 'High Contrast',
    light: {
      '--c-bg': '255 255 255',
      '--c-bg-elevated': '255 255 255',
      '--c-bg-sunken': '225 225 225',
      '--c-border': '0 0 0',
      '--c-text': '0 0 0',
      '--c-text-muted': '60 60 60',
      '--c-accent': '0 60 200',
      '--c-accent-text': '255 255 255',
      '--c-msg-user': '0 60 200',
      '--c-msg-char': '225 225 225',
      '--c-danger': '180 0 0',
    },
    dark: {
      '--c-bg': '0 0 0',
      '--c-bg-elevated': '26 26 26',
      '--c-bg-sunken': '0 0 0',
      '--c-border': '255 255 255',
      '--c-text': '255 255 255',
      '--c-text-muted': '200 200 200',
      '--c-accent': '255 210 0',
      '--c-accent-text': '0 0 0',
      '--c-msg-user': '255 210 0',
      '--c-msg-char': '26 26 26',
      '--c-danger': '255 100 100',
    },
  },
]
