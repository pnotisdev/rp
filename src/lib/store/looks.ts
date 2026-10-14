// Looks: whole-interface designs (palette, type, shape, atmosphere and chat style) a user can pick in one click.

import type { FontId } from './fonts'
import type { AvatarShape, ChatStyle, ColorMode } from './useSettingsStore'

export type Backdrop = 'none' | 'aurora' | 'grid' | 'grain' | 'scanlines'

export const BACKDROPS: { id: Backdrop; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'grid', label: 'Grid' },
  { id: 'grain', label: 'Grain' },
  { id: 'scanlines', label: 'Scanlines' },
]

export interface Look {
  id: string
  name: string
  blurb: string
  /** The mode it was designed for; picking the look switches to it. */
  mode: ColorMode
  /** Palette overrides on top of the built-in tokens. */
  light: Record<string, string>
  dark: Record<string, string>
  uiFont: FontId
  readFont: FontId
  displayFont: FontId
  radiusPx: number
  backdrop: Backdrop
  glass: boolean
  chatStyle: ChatStyle
  avatarShape: AvatarShape
}

export const LOOKS: Look[] = [
  {
    id: 'ember',
    name: 'Ember',
    blurb: 'The default. Warm dark, one orange flame.',
    mode: 'dark',
    light: {},
    dark: {},
    uiFont: 'inter',
    readFont: 'inter',
    displayFont: 'rounded',
    radiusPx: 6,
    backdrop: 'none',
    glass: false,
    chatStyle: 'flat',
    avatarShape: 'rounded',
  },
  {
    id: 'hanami',
    name: 'Hanami',
    blurb: 'Cherry-blossom light, soft and rounded.',
    mode: 'light',
    light: {
      '--c-bg': '254 246 247',
      '--c-bg-elevated': '255 253 253',
      '--c-bg-sunken': '250 233 237',
      '--c-border': '241 214 221',
      '--c-text': '70 38 50',
      '--c-text-muted': '150 108 122',
      '--c-accent': '196 60 106',
      '--c-accent-text': '255 255 255',
      '--c-msg-user': '196 60 106',
      '--c-msg-char': '255 253 253',
      '--c-danger': '192 48 70',
      '--c-romance': '170 66 150',
      '--c-romance-text': '255 255 255',
    },
    dark: {
      '--c-bg': '27 17 23',
      '--c-bg-elevated': '37 24 32',
      '--c-bg-sunken': '20 12 17',
      '--c-border': '62 40 52',
      '--c-text': '248 232 238',
      '--c-text-muted': '176 140 154',
      '--c-accent': '245 150 184',
      '--c-accent-text': '35 14 24',
      '--c-msg-user': '245 150 184',
      '--c-msg-char': '37 24 32',
      '--c-danger': '244 118 140',
      '--c-romance': '214 160 240',
      '--c-romance-text': '28 16 34',
    },
    uiFont: 'rounded',
    readFont: 'rounded',
    displayFont: 'rounded',
    radiusPx: 14,
    backdrop: 'aurora',
    glass: false,
    chatStyle: 'bubbles',
    avatarShape: 'circle',
  },
  {
    id: 'shibuya-night',
    name: 'Shibuya Night',
    blurb: 'Neon on midnight, sharp edges, a faint grid.',
    mode: 'dark',
    light: {
      '--c-bg': '246 244 252',
      '--c-bg-elevated': '255 255 255',
      '--c-bg-sunken': '236 232 248',
      '--c-border': '218 212 238',
      '--c-text': '26 20 48',
      '--c-text-muted': '112 102 152',
      '--c-accent': '196 20 150',
      '--c-accent-text': '255 255 255',
      '--c-msg-user': '196 20 150',
      '--c-msg-char': '255 255 255',
      '--c-danger': '210 30 60',
      '--c-romance': '10 118 156',
      '--c-romance-text': '255 255 255',
    },
    dark: {
      '--c-bg': '9 9 20',
      '--c-bg-elevated': '16 16 32',
      '--c-bg-sunken': '5 5 13',
      '--c-border': '44 44 76',
      '--c-text': '232 232 250',
      '--c-text-muted': '134 134 176',
      '--c-accent': '255 62 200',
      '--c-accent-text': '12 6 18',
      '--c-msg-user': '255 62 200',
      '--c-msg-char': '16 16 32',
      '--c-danger': '255 92 108',
      '--c-success': '70 240 190',
      '--c-warning': '255 214 80',
      '--c-romance': '60 220 255',
      '--c-romance-text': '5 12 20',
    },
    uiFont: 'inter',
    readFont: 'inter',
    displayFont: 'mono',
    radiusPx: 3,
    backdrop: 'grid',
    glass: false,
    chatStyle: 'flat',
    avatarShape: 'square',
  },
  {
    id: 'phosphor',
    name: 'Phosphor',
    blurb: 'A green-screen terminal for a late-night story.',
    mode: 'dark',
    light: {
      '--c-bg': '232 240 228',
      '--c-bg-elevated': '240 247 236',
      '--c-bg-sunken': '221 232 216',
      '--c-border': '176 200 170',
      '--c-text': '22 48 28',
      '--c-text-muted': '70 102 76',
      '--c-accent': '24 110 46',
      '--c-accent-text': '240 250 240',
      '--c-msg-user': '24 110 46',
      '--c-msg-char': '240 247 236',
      '--c-danger': '170 44 30',
      '--c-romance': '140 92 10',
      '--c-romance-text': '255 255 255',
    },
    dark: {
      '--c-bg': '4 12 6',
      '--c-bg-elevated': '8 20 11',
      '--c-bg-sunken': '2 8 4',
      '--c-border': '24 70 36',
      '--c-text': '150 240 165',
      '--c-text-muted': '78 160 100',
      '--c-accent': '102 255 128',
      '--c-accent-text': '3 10 5',
      '--c-msg-user': '102 255 128',
      '--c-msg-char': '8 20 11',
      '--c-danger': '255 110 90',
      '--c-success': '102 255 128',
      '--c-warning': '255 200 70',
      '--c-romance': '255 190 60',
      '--c-romance-text': '10 8 2',
    },
    uiFont: 'mono',
    readFont: 'mono',
    displayFont: 'mono',
    radiusPx: 0,
    backdrop: 'scanlines',
    glass: false,
    chatStyle: 'flat',
    avatarShape: 'square',
  },
  {
    id: 'scriptorium',
    name: 'Scriptorium',
    blurb: 'Parchment and ink. Reads like a book.',
    mode: 'light',
    light: {
      '--c-bg': '244 238 224',
      '--c-bg-elevated': '250 246 236',
      '--c-bg-sunken': '234 226 207',
      '--c-border': '216 204 178',
      '--c-text': '44 36 28',
      '--c-text-muted': '120 104 86',
      '--c-accent': '38 76 140',
      '--c-accent-text': '250 246 236',
      '--c-msg-user': '38 76 140',
      '--c-msg-char': '250 246 236',
      '--c-danger': '168 40 30',
      '--c-success': '48 110 70',
      '--c-warning': '160 104 20',
      '--c-romance': '150 52 84',
      '--c-romance-text': '255 255 255',
    },
    dark: {
      '--c-bg': '28 23 18',
      '--c-bg-elevated': '38 31 24',
      '--c-bg-sunken': '21 17 13',
      '--c-border': '66 55 42',
      '--c-text': '236 224 202',
      '--c-text-muted': '164 148 122',
      '--c-accent': '224 168 82',
      '--c-accent-text': '28 20 8',
      '--c-msg-user': '224 168 82',
      '--c-msg-char': '38 31 24',
      '--c-danger': '230 120 100',
      '--c-romance': '214 130 150',
      '--c-romance-text': '30 14 18',
    },
    uiFont: 'system',
    readFont: 'serif',
    displayFont: 'serif',
    radiusPx: 3,
    backdrop: 'grain',
    glass: false,
    chatStyle: 'document',
    avatarShape: 'square',
  },
  {
    id: 'aurora-glass',
    name: 'Aurora Glass',
    blurb: 'Frosted panels floating over a polar sky.',
    mode: 'dark',
    light: {
      '--c-bg': '238 245 252',
      '--c-bg-elevated': '255 255 255',
      '--c-bg-sunken': '224 236 248',
      '--c-border': '200 218 238',
      '--c-text': '20 34 56',
      '--c-text-muted': '88 112 144',
      '--c-accent': '14 126 158',
      '--c-accent-text': '255 255 255',
      '--c-msg-user': '14 126 158',
      '--c-msg-char': '255 255 255',
      '--c-danger': '200 44 60',
      '--c-romance': '110 90 220',
      '--c-romance-text': '255 255 255',
    },
    dark: {
      '--c-bg': '10 16 28',
      '--c-bg-elevated': '18 28 46',
      '--c-bg-sunken': '7 12 22',
      '--c-border': '40 58 90',
      '--c-text': '226 238 252',
      '--c-text-muted': '128 152 184',
      '--c-accent': '94 214 230',
      '--c-accent-text': '6 16 24',
      '--c-msg-user': '94 214 230',
      '--c-msg-char': '18 28 46',
      '--c-danger': '248 112 120',
      '--c-success': '110 226 170',
      '--c-warning': '240 200 100',
      '--c-romance': '170 150 255',
      '--c-romance-text': '12 10 30',
    },
    uiFont: 'inter',
    readFont: 'inter',
    displayFont: 'rounded',
    radiusPx: 14,
    backdrop: 'aurora',
    glass: true,
    chatStyle: 'bubbles',
    avatarShape: 'circle',
  },
  {
    id: 'velvet',
    name: 'Velvet Curtain',
    blurb: 'Burgundy and gold, house lights down.',
    mode: 'dark',
    light: {
      '--c-bg': '250 242 238',
      '--c-bg-elevated': '255 250 247',
      '--c-bg-sunken': '242 228 222',
      '--c-border': '226 204 198',
      '--c-text': '50 22 28',
      '--c-text-muted': '136 100 102',
      '--c-accent': '140 28 52',
      '--c-accent-text': '255 255 255',
      '--c-msg-user': '140 28 52',
      '--c-msg-char': '255 250 247',
      '--c-danger': '190 40 40',
      '--c-romance': '196 60 100',
      '--c-romance-text': '255 255 255',
    },
    dark: {
      '--c-bg': '22 9 13',
      '--c-bg-elevated': '32 14 20',
      '--c-bg-sunken': '15 6 9',
      '--c-border': '70 32 42',
      '--c-text': '244 230 222',
      '--c-text-muted': '172 142 138',
      '--c-accent': '222 178 90',
      '--c-accent-text': '30 14 6',
      '--c-msg-user': '222 178 90',
      '--c-msg-char': '32 14 20',
      '--c-danger': '255 120 110',
      '--c-romance': '240 120 150',
      '--c-romance-text': '30 8 14',
    },
    uiFont: 'inter',
    readFont: 'elegant',
    displayFont: 'elegant',
    radiusPx: 4,
    backdrop: 'grain',
    glass: false,
    chatStyle: 'flat',
    avatarShape: 'rounded',
  },
  {
    id: 'moss-garden',
    name: 'Moss Garden',
    blurb: 'Quiet greens. The box garden itself.',
    mode: 'dark',
    light: {
      '--c-bg': '240 244 236',
      '--c-bg-elevated': '248 250 244',
      '--c-bg-sunken': '229 236 224',
      '--c-border': '204 216 198',
      '--c-text': '30 44 32',
      '--c-text-muted': '92 114 92',
      '--c-accent': '58 112 62',
      '--c-accent-text': '255 255 255',
      '--c-msg-user': '58 112 62',
      '--c-msg-char': '248 250 244',
      '--c-danger': '176 52 40',
      '--c-romance': '176 80 110',
      '--c-romance-text': '255 255 255',
    },
    dark: {
      '--c-bg': '14 20 16',
      '--c-bg-elevated': '21 29 23',
      '--c-bg-sunken': '10 15 12',
      '--c-border': '42 58 46',
      '--c-text': '226 236 224',
      '--c-text-muted': '134 156 134',
      '--c-accent': '152 204 132',
      '--c-accent-text': '10 20 10',
      '--c-msg-user': '152 204 132',
      '--c-msg-char': '21 29 23',
      '--c-danger': '236 122 108',
      '--c-success': '152 204 132',
      '--c-warning': '226 190 100',
      '--c-romance': '224 160 170',
      '--c-romance-text': '30 14 18',
    },
    uiFont: 'rounded',
    readFont: 'system',
    displayFont: 'rounded',
    radiusPx: 10,
    backdrop: 'grain',
    glass: false,
    chatStyle: 'flat',
    avatarShape: 'rounded',
  },
]

/** The settings that make up a look, as the store holds them. */
export interface LookState {
  themeTokensLight: Record<string, string>
  themeTokensDark: Record<string, string>
  uiFont: FontId
  readFont: FontId
  displayFont: FontId
  radiusPx: number
  backdrop: Backdrop
  glass: boolean
  chatStyle: ChatStyle
  avatarShape: AvatarShape
}

/** Which look the current settings still equal (palette over `defaults`), or null once any part was changed. */
export function matchingLookId(state: LookState, defaults: { light: Record<string, string>; dark: Record<string, string> }): string | null {
  const sameTokens = (saved: Record<string, string>, base: Record<string, string>, over: Record<string, string>) => Object.entries({ ...base, ...over }).every(([k, v]) => saved[k] === v)
  const hit = LOOKS.find(
    (l) =>
      state.uiFont === l.uiFont &&
      state.readFont === l.readFont &&
      state.displayFont === l.displayFont &&
      state.radiusPx === l.radiusPx &&
      state.backdrop === l.backdrop &&
      state.glass === l.glass &&
      state.chatStyle === l.chatStyle &&
      state.avatarShape === l.avatarShape &&
      sameTokens(state.themeTokensLight, defaults.light, l.light) &&
      sameTokens(state.themeTokensDark, defaults.dark, l.dark),
  )
  return hit?.id ?? null
}
