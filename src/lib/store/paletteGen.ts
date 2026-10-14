// Builds a whole light and dark palette from one hue, so "pick a colour" gives a coherent theme instead of one stray accent.

type Rgb = [number, number, number]

/** HSL (h in degrees, s and l in 0..1) to 0..255 RGB. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

const triplet = ([r, g, b]: Rgb) => `${r} ${g} ${b}`

/** WCAG relative luminance of an "R G B" token. */
export function luminance(token: string): number {
  const [r, g, b] = token.split(' ').map((v) => {
    const c = Number(v) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two "R G B" tokens (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Nudges an accent's lightness until its label text and the page background both contrast enough with it. */
function fitAccent(h: number, sat: number, start: number, bg: string, dark: boolean): { accent: Rgb; text: string } {
  const text = dark ? triplet(hslToRgb(h, 0.4, 0.07)) : '255 255 255'
  let l = start
  for (let i = 0; i < 40; i++) {
    const rgb = hslToRgb(h, sat, l)
    if ((contrast(text, triplet(rgb)) >= 4.6 && contrast(triplet(rgb), bg) >= 3.2) || l <= 0.05 || l >= 0.95) return { accent: rgb, text }
    l += dark ? 0.02 : -0.02
  }
  return { accent: hslToRgb(h, sat, l), text }
}

/** `vivid` runs 0 (nearly grey, a hint of tint) to 1 (strongly coloured surfaces and accent). */
export function paletteFromHue(hue: number, vivid = 0.6): { light: Record<string, string>; dark: Record<string, string> } {
  const h = ((hue % 360) + 360) % 360
  const v = Math.max(0, Math.min(1, vivid))
  const tint = 0.06 + 0.3 * v

  const darkBg = hslToRgb(h, tint, 0.075)
  const { accent: darkAccent, text: darkAccentText } = fitAccent(h, 0.55 + 0.4 * v, 0.66, triplet(darkBg), true)
  const dark = {
    '--c-bg': triplet(darkBg),
    '--c-bg-elevated': triplet(hslToRgb(h, tint, 0.105)),
    '--c-bg-sunken': triplet(hslToRgb(h, tint, 0.05)),
    '--c-border': triplet(hslToRgb(h, tint * 0.9, 0.18)),
    '--c-text': triplet(hslToRgb(h, 0.25, 0.92)),
    '--c-text-muted': triplet(hslToRgb(h, 0.12 + 0.1 * v, 0.64)),
    '--c-accent': triplet(darkAccent),
    '--c-accent-text': darkAccentText,
    '--c-msg-user': triplet(darkAccent),
    '--c-msg-char': triplet(hslToRgb(h, tint, 0.105)),
  }

  const lightBg = hslToRgb(h, 0.15 + 0.5 * v, 0.965)
  const { accent: lightAccent, text: lightAccentText } = fitAccent(h, 0.5 + 0.35 * v, 0.4, triplet(lightBg), false)
  const light = {
    '--c-bg': triplet(lightBg),
    '--c-bg-elevated': triplet(hslToRgb(h, 0.2 + 0.4 * v, 0.99)),
    '--c-bg-sunken': triplet(hslToRgb(h, 0.15 + 0.5 * v, 0.93)),
    '--c-border': triplet(hslToRgb(h, 0.12 + 0.35 * v, 0.86)),
    '--c-text': triplet(hslToRgb(h, 0.3, 0.14)),
    '--c-text-muted': triplet(hslToRgb(h, 0.1 + 0.1 * v, 0.4)),
    '--c-accent': triplet(lightAccent),
    '--c-accent-text': lightAccentText,
    '--c-msg-user': triplet(lightAccent),
    '--c-msg-char': triplet(hslToRgb(h, 0.2 + 0.4 * v, 0.99)),
  }
  return { light, dark }
}
