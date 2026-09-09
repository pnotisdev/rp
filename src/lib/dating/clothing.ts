// Who is still wearing what, tracked by the engine rather than remembered by the model. The cheapest
// continuity win in this genre: re-describing the removal of something already removed is the single
// most common break, and it's pure bookkeeping — a set of removed layers per side, updated by the
// clicked action and by one bounded observation field, rendered into the scene state block, and
// checked against the reply afterwards by `continuityGuard.ts`.
//
// Two sides only for now (the speaking character and the player), matching `IntimacyScene`'s own
// per-relationship scope; the review's multi-character step promotes this to one entry per participant.

export const CLOTHING_LAYERS = ['outerwear', 'top', 'bottoms', 'underwear', 'shoes'] as const

export type ClothingLayer = (typeof CLOTHING_LAYERS)[number]

export type ClothingSide = 'char' | 'user'

/** Layers removed so far this scene, per side. Absent side = nothing removed yet. */
export interface ClothingState {
  char?: ClothingLayer[]
  user?: ClothingLayer[]
}

export interface ClothingRemoval {
  who: ClothingSide
  layer: ClothingLayer
}

/** Words that name each layer in prose — the lexicon both the judge's read and the continuity check work from. */
export const LAYER_WORDS: Record<ClothingLayer, string[]> = {
  outerwear: ['jacket', 'coat', 'cardigan', 'blazer', 'hoodie'],
  top: ['shirt', 'blouse', 'sweater', 't-shirt', 'tank top', 'top', 'dress', 'uniform'],
  bottoms: ['pants', 'trousers', 'jeans', 'skirt', 'shorts', 'leggings'],
  underwear: ['bra', 'panties', 'underwear', 'boxers', 'briefs', 'lingerie', 'knickers'],
  shoes: ['shoes', 'boots', 'sneakers', 'socks', 'stockings', 'tights'],
}

function isLayer(value: unknown): value is ClothingLayer {
  return typeof value === 'string' && (CLOTHING_LAYERS as readonly string[]).includes(value)
}

/** Validates the judge's raw clothing read. Anything unrecognised is dropped rather than guessed at. */
export function parseClothingRemovals(raw: unknown): ClothingRemoval[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const removals: ClothingRemoval[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { who, layer } = entry as Record<string, unknown>
    if ((who !== 'char' && who !== 'user') || !isLayer(layer)) continue
    const key = `${who}:${layer}`
    if (seen.has(key)) continue
    seen.add(key)
    removals.push({ who, layer })
  }
  return removals
}

export function removedLayers(state: ClothingState | undefined, who: ClothingSide): ClothingLayer[] {
  return state?.[who] ?? []
}

export function isRemoved(state: ClothingState | undefined, who: ClothingSide, layer: ClothingLayer): boolean {
  return removedLayers(state, who).includes(layer)
}

/** Folds this turn's removals into the state. Removing something already off is a no-op here — the reply that did it is what `continuityGuard.ts` flags. */
export function applyClothingRemovals(state: ClothingState | undefined, removals: ClothingRemoval[]): ClothingState {
  if (!removals.length) return state ?? {}
  const next: ClothingState = { char: [...removedLayers(state, 'char')], user: [...removedLayers(state, 'user')] }
  for (const { who, layer } of removals) {
    if (!next[who]!.includes(layer)) next[who]!.push(layer)
  }
  return { ...(next.char!.length ? { char: next.char } : {}), ...(next.user!.length ? { user: next.user } : {}) }
}

/** Whether every layer that can be taken off has been. `shoes` counts — it's the odd one out only in that nobody narrates it. */
function isFullyUndressed(removed: ClothingLayer[]): boolean {
  return CLOTHING_LAYERS.every((layer) => layer === 'shoes' || removed.includes(layer))
}

/** One side's state as a short phrase for the state block: "dressed", "undressed", "underwear only", or what's off. */
export function describeClothingSide(state: ClothingState | undefined, who: ClothingSide): string {
  const removed = removedLayers(state, who)
  if (!removed.length) return 'dressed'
  if (isFullyUndressed(removed)) return 'undressed'
  const stillOn = CLOTHING_LAYERS.filter((layer) => !removed.includes(layer) && layer !== 'shoes')
  if (stillOn.length === 1 && stillOn[0] === 'underwear') return 'underwear only'
  return `${removed.join(', ')} off`
}
