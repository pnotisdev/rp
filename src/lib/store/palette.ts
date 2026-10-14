// Palette migration: a saved theme that still equals the old defaults is upgraded; a customized one is left alone.

// Past default palettes; a saved palette that still equals one of them is upgraded, a customized one is left alone.
export const LEGACY_THEME_TOKENS: Record<string, string> = {
  '--c-bg': '251 251 250',
  '--c-bg-elevated': '255 255 255',
  '--c-bg-sunken': '244 244 242',
  '--c-border': '231 229 225',
  '--c-text': '30 32 30',
  '--c-text-muted': '133 129 123',
  '--c-accent': '13 121 105',
  '--c-accent-text': '255 255 255',
  '--c-msg-user': '13 121 105',
  '--c-msg-char': '255 255 255',
  '--c-danger': '197 48 48',
  '--c-success': '22 130 74',
  '--c-warning': '180 108 8',
  '--c-romance': '201 63 122',
  '--c-romance-text': '255 255 255',
}

export const LEGACY_THEME_TOKENS_DARK: Record<string, string> = {
  '--c-bg': '17 18 18',
  '--c-bg-elevated': '26 27 27',
  '--c-bg-sunken': '12 13 13',
  '--c-border': '42 44 43',
  '--c-text': '235 235 232',
  '--c-text-muted': '148 148 143',
  '--c-accent': '94 224 197',
  '--c-accent-text': '12 13 13',
  '--c-msg-user': '94 224 197',
  '--c-msg-char': '26 27 27',
  '--c-danger': '240 120 120',
  '--c-success': '94 220 150',
  '--c-warning': '240 190 90',
  '--c-romance': '236 108 184',
  '--c-romance-text': '12 13 13',
}

const LEGACY_TEAL: Record<string, string> = {
  '--c-bg': '250 249 247',
  '--c-bg-elevated': '255 255 255',
  '--c-bg-sunken': '243 241 237',
  '--c-border': '230 227 221',
  '--c-text': '32 31 29',
  '--c-text-muted': '117 113 105',
  '--c-accent': '20 115 100',
  '--c-accent-text': '255 255 255',
  '--c-msg-user': '20 115 100',
  '--c-msg-char': '255 255 255',
  '--c-danger': '190 62 55',
  '--c-success': '40 128 84',
  '--c-warning': '168 108 20',
  '--c-romance': '190 76 128',
  '--c-romance-text': '255 255 255',
}

const LEGACY_TEAL_DARK: Record<string, string> = {
  '--c-bg': '19 19 18',
  '--c-bg-elevated': '28 28 27',
  '--c-bg-sunken': '14 14 13',
  '--c-border': '47 47 44',
  '--c-text': '236 234 229',
  '--c-text-muted': '152 149 142',
  '--c-accent': '127 189 168',
  '--c-accent-text': '16 22 20',
  '--c-msg-user': '127 189 168',
  '--c-msg-char': '28 28 27',
  '--c-danger': '232 122 114',
  '--c-success': '122 192 150',
  '--c-warning': '222 180 100',
  '--c-romance': '222 132 172',
  '--c-romance-text': '20 14 17',
}

export const LEGACY_LIGHT_PALETTES = [LEGACY_THEME_TOKENS, LEGACY_TEAL]
export const LEGACY_DARK_PALETTES = [LEGACY_THEME_TOKENS_DARK, LEGACY_TEAL_DARK]

type Legacy = Record<string, string> | Record<string, string>[]

/** True when every saved token still holds a past default (so the palette was never customized). */
export function isUntouchedPalette(saved: Record<string, string> | undefined, legacy: Legacy): boolean {
  const sets = Array.isArray(legacy) ? legacy : [legacy]
  return !saved || Object.entries(saved).every(([key, value]) => sets.every((l) => l[key] === undefined) || sets.some((l) => l[key] === value))
}

/** Picks the palette to start from: new defaults for an untouched saved palette, otherwise the saved one over the defaults. */
export function mergePalette(current: Record<string, string>, saved: Record<string, string> | undefined, legacy: Legacy): Record<string, string> {
  return isUntouchedPalette(saved, legacy) ? { ...current } : { ...current, ...saved }
}
