/**
 * Independent trait axes (archetype/occupation/quirk/relationship starter) for "combinatorial"
 * character creation. Picking one option per axis composes a short brief that feeds the same
 * `draftCharacterFromBrief`/`draftFullCharacter` pipeline the free-text path uses. Options per axis
 * come from `generateTraitOptions` (aiAssist.ts) at runtime; this module only holds axis metadata
 * and the pure functions for picking from and composing a returned pool.
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

/** Every axis is optional except `archetype`, which reads naturally alone ("A tsundere."). */
export const TRAIT_AXIS_META: TraitAxisMeta[] = [
  { id: 'archetype', label: 'Archetype', hint: 'Who they are underneath', required: true },
  { id: 'occupation', label: 'Occupation', hint: 'What fills their days' },
  { id: 'quirk', label: 'Quirk', hint: 'One detail that makes them specific' },
  { id: 'relationshipStarter', label: 'Relationship starter', hint: 'How they and the player already know each other' },
]

/** Raw option text per axis, as returned by `generateTraitOptions` — the model's answer, unshaped. */
export type TraitOptionSet = Record<TraitAxisId, string[]>

/**
 * Positional fallback for a trait-options response too malformed to parse as JSON (e.g. missing
 * array brackets around one or more keys). Finds where each known axis key occurs in the raw text
 * and takes every quoted string between it and the next key as that axis's option list.
 */
export function extractTraitOptionsPositionally(text: string): TraitOptionSet {
  const positions = TRAIT_AXIS_META.map((axis) => ({ id: axis.id, index: text.indexOf(`"${axis.id}"`) }))
    .filter((p) => p.index !== -1)
    .sort((a, b) => a.index - b.index)
  const result = Object.fromEntries(TRAIT_AXIS_META.map((a) => [a.id, [] as string[]])) as TraitOptionSet
  for (let i = 0; i < positions.length; i++) {
    const { id, index } = positions[i]
    const start = index + id.length + 2 // past the quotes around the key name
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

/** Folds the current picks into a short natural-language brief, the same shape as the "from a brief" textarea. */
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
