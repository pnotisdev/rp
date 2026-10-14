// A stable, soft tint per name, so art-less characters and worlds are told apart at a glance.

/** A hue in degrees derived from `name`; the same name always gives the same hue. */
export function nameHue(name: string): number {
  let sum = 0
  for (const ch of name) sum = (sum * 31 + ch.charCodeAt(0)) % 360
  return sum
}

/** Inline style for a muted tinted tile that reads in both light and dark themes. */
export function tintStyle(name: string): { backgroundColor: string; color: string } {
  const hue = nameHue(name)
  return { backgroundColor: `hsl(${hue} 22% 50% / 0.14)`, color: `hsl(${hue} 30% 62%)` }
}
