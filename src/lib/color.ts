/** Our theme tokens are stored as "R G B" space-separated (Tailwind <alpha-value> convention). */
export function tripletToHex(triplet: string): string {
  const [r, g, b] = triplet.trim().split(/\s+/).map(Number)
  const toHex = (n: number) => Math.max(0, Math.min(255, n || 0)).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function hexToTriplet(hex: string): string {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `${r} ${g} ${b}`
}
