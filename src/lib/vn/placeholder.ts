/** Deterministic placeholder gradient for a background tag that has no uploaded art yet. */
export function placeholderGradient(tag?: string): string {
  const hue = tag ? Math.abs(hashCode(tag)) % 360 : 250
  return `linear-gradient(160deg, hsl(${hue} 45% 22%), hsl(${(hue + 40) % 360} 35% 10%))`
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}
