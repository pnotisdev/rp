/**
 * Deterministic pick from a small pool of art variants (a sprite expression, a gallery CG) via a
 * seed string — the same seed always lands on the same index, so a variant doesn't flicker to a
 * different one on every unrelated re-render of the same turn. A different seed (a new message, a
 * new trigger) can land on a different variant, which is the actual point of having several.
 */
export function pickVariant<T>(candidates: readonly T[], seed: string): T {
  if (candidates.length <= 1) return candidates[0]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return candidates[Math.abs(h) % candidates.length]
}
