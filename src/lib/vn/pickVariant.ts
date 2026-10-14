/** Deterministic pick from a small pool of art variants (a sprite expression, a gallery CG) via a seed string */
export function pickVariant<T>(candidates: readonly T[], seed: string): T {
  if (candidates.length <= 1) return candidates[0]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return candidates[Math.abs(h) % candidates.length]
}
