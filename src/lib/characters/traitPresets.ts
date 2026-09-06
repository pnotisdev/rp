/**
 * Independent trait axes for "combinatorial" character creation — a middle ground between the fixed
 * cards in `starterTemplates.ts` (zero variance) and a blank "from a brief" textarea (infinite variance,
 * blank-page problem). Picking one option per axis composes a short brief that feeds the exact same
 * `draftCharacterFromBrief`/`draftFullCharacter` pipeline the free-text path uses — this only changes
 * where the brief text comes from, not how it's turned into a card.
 *
 * The axis *categories* below (archetype/occupation/quirk/relationship starter) are the fixed part of
 * the feature — that's the actual pitch, four independent slots to combine. The *options* inside each
 * axis are never hardcoded: `generateTraitOptions` (aiAssist.ts) asks the connected model for a fresh
 * batch every time, so the menu itself has no ceiling and isn't the same twice. This module only holds
 * the axis metadata and the pure functions for picking from and composing whatever pool the model
 * returned — no static option lists live here.
 */

export type TraitAxisId = 'archetype' | 'occupation' | 'quirk' | 'relationshipStarter'

export interface TraitOption {
  id: string
  label: string
  /** How this option is phrased when folded into the composed brief. */
  text: string
}

export interface TraitAxisMeta {
  id: TraitAxisId
  label: string
  hint: string
  required?: boolean
}

/** Every axis is optional except `archetype`: `composeTraitBrief` needs at least one non-empty clause
 *  to produce a usable brief, and archetype is the one that always reads naturally alone ("A tsundere."). */
export const TRAIT_AXIS_META: TraitAxisMeta[] = [
  { id: 'archetype', label: 'Archetype', hint: 'Who they are underneath', required: true },
  { id: 'occupation', label: 'Occupation', hint: 'What fills their days' },
  { id: 'quirk', label: 'Quirk', hint: 'One detail that makes them specific' },
  { id: 'relationshipStarter', label: 'Relationship starter', hint: 'How they and the player already know each other' },
]

/** Raw option text per axis, as returned by `generateTraitOptions` — the model's answer, unshaped. */
export type TraitOptionSet = Record<TraitAxisId, string[]>

/**
 * Positional fallback for a trait-options response too malformed to parse as JSON at all —
 * seen in practice when the model drops the array brackets for one or more keys entirely,
 * e.g. `"quirk":"a","b","c","relationshipStarter":"d","e"` instead of proper `["a","b","c"]`
 * arrays. That single missing bracket pair breaks `JSON.parse` for the *whole* object, even
 * though the other keys were perfectly well-formed — not something `jsonRepair.ts`'s generic
 * passes can safely recover (a bare string next to another bare string is genuinely ambiguous
 * in general JSON), but trivial to recover here because this function only needs trait-
 * options' own known shape: find where each of the four known keys occurs in the raw text,
 * then take every quoted string between that key and the next one (or the end of the text) as
 * its option list. Never touches brackets, colons, or commas, so it works whichever of those
 * the model happened to drop.
 */
export function extractTraitOptionsPositionally(text: string): TraitOptionSet {
  const positions = TRAIT_AXIS_META.map((axis) => ({ id: axis.id, index: text.indexOf(`"${axis.id}"`) }))
    .filter((p) => p.index !== -1)
    .sort((a, b) => a.index - b.index)
  const result = Object.fromEntries(TRAIT_AXIS_META.map((a) => [a.id, [] as string[]])) as TraitOptionSet
  for (let i = 0; i < positions.length; i++) {
    const { id, index } = positions[i]
    const start = index + id.length + 2 // past the opening/closing quotes around the key name itself
    const end = i + 1 < positions.length ? positions[i + 1].index : text.length
    const segment = text.slice(start, end)
    const strings: string[] = []
    const stringPattern = /"((?:[^"\\]|\\.)*)"/g
    let match: RegExpExecArray | null
    while ((match = stringPattern.exec(segment))) strings.push(match[1])
    result[id] = strings
  }
  return result
}

/** The same set turned into `TraitOption`s the picker UI can key and compare by id. */
export type TraitOptionPool = Record<TraitAxisId, TraitOption[]>

export function toTraitOptionPool(raw: TraitOptionSet): TraitOptionPool {
  const pool = {} as TraitOptionPool
  for (const axis of TRAIT_AXIS_META) {
    pool[axis.id] = (raw[axis.id] ?? []).map((text, i) => ({ id: `${axis.id}-${i}`, label: text, text }))
  }
  return pool
}

export type TraitPicks = Partial<Record<TraitAxisId, TraitOption | null>>

export function randomTraitOption(options: TraitOption[]): TraitOption | undefined {
  if (options.length === 0) return undefined
  return options[Math.floor(Math.random() * options.length)]
}

/** Picks one random option per axis from the given pool — the "shuffle all" action. */
export function randomTraitPicks(pool: TraitOptionPool): TraitPicks {
  const picks: TraitPicks = {}
  for (const axis of TRAIT_AXIS_META) picks[axis.id] = randomTraitOption(pool[axis.id] ?? [])
  return picks
}

/**
 * Folds the current picks into a short natural-language brief, the same shape a user would otherwise
 * type by hand into the "from a brief" textarea. Plain English throughout — no `{{user}}`/`{{char}}`
 * macros, since this is drafting guidance the model reads, not a card field it writes.
 */
export function composeTraitBrief(picks: TraitPicks): string {
  const archetype = picks.archetype?.text
  const occupation = picks.occupation?.text
  const quirk = picks.quirk?.text
  const relationshipStarter = picks.relationshipStarter?.text

  const lead = archetype ? `A ${archetype}` : 'A person'
  const withJob = occupation ? `${lead} who works as a ${occupation}.` : `${lead}.`
  const parts = [withJob]
  if (quirk) parts.push(`Quirk: ${quirk}.`)
  if (relationshipStarter) parts.push(`Relationship to the player: ${relationshipStarter}.`)
  return parts.join(' ')
}
