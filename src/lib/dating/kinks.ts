// Kinks as structured data rather than free text. `Character.boundaries` and `likes` are authored
// prose and reach the model as prose, which means they get ignored exactly often enough to matter —
// the same reason `EXPLICIT_ANTI_PATTERNS` exists as a detector and not only as an instruction.
//
// Enforcement here is never an instruction. A hard limit means the catalog entry is never rendered,
// its stage edges are never traversable, and its `promptNote` never enters the context: a model
// cannot write toward content it was never shown, and cannot reach a stage the graph won't route to.

/** Built-in vocabulary. A world extends it the same way it extends the catalog — see `KinkId`. */
export const BUILT_IN_KINKS = [
  'bondage',
  'sensory_play',
  'toys',
  'edging',
  'praise',
  'dirty_talk',
  'roleplay',
  'exhibitionism',
  'oral',
  'rough',
  'gentle',
  // A catalog entry can only ever be ruled out by a kink an author can actually name, and the
  // editor offers exactly this list — so a content class with no id here ships ungateable however
  // carefully the entry itself is written.
  'anal',
  'marking',
  'overstimulation',
  'bodily_fluids',
  'recording',
  'voyeurism',
  'degradation',
] as const

/** Deliberately open: a world's own entries can name kinks the built-in list never anticipated. */
export type KinkId = (typeof BUILT_IN_KINKS)[number] | (string & {})

/** -2 = hard limit, -1 = dislikes, 0 = neutral, 1 = enjoys, 2 = eager. */
export type KinkValence = -2 | -1 | 0 | 1 | 2

export interface KinkProfile {
  valence?: Partial<Record<KinkId, KinkValence>>
  /** Absolute. Kept separate from a `-2` valence so an author can state a limit without scoring anything. */
  hardLimits?: KinkId[]
}

/** Where this character stands on a kink. Nothing on record is neutral, not permission and not refusal. */
export function kinkValence(profile: KinkProfile | undefined, kink: KinkId): KinkValence {
  if (profile?.hardLimits?.includes(kink)) return -2
  return profile?.valence?.[kink] ?? 0
}

export function isHardLimit(profile: KinkProfile | undefined, kink: KinkId): boolean {
  return kinkValence(profile, kink) === -2
}

/** Whether anything about this content is off the table. One hard limit rules out the whole entry. */
export function isAnyHardLimit(profile: KinkProfile | undefined, kinks: readonly KinkId[] | undefined): boolean {
  return !!kinks?.some((kink) => isHardLimit(profile, kink))
}

/**
 * One valence for a piece of content that may involve several kinks. A dislike dominates enthusiasm —
 * a scene combining something they love with something they don't is governed by the part they don't,
 * which is both the safer read and the more human one.
 */
export function combinedValence(profile: KinkProfile | undefined, kinks: readonly KinkId[] | undefined): KinkValence {
  if (!kinks?.length) return 0
  const valences = kinks.map((kink) => kinkValence(profile, kink))
  const worst = Math.min(...valences)
  return (worst < 0 ? worst : Math.max(...valences)) as KinkValence
}

/** Multiplier on arousal gain from how this character feels about what's happening. */
export function kinkResponsiveness(valence: KinkValence): number {
  switch (valence) {
    case 2:
      return 1.35
    case 1:
      return 1.15
    case -1:
      return 0.7
    case -2:
      // Should never be reached — a hard limit is filtered out of the action set long before here.
      return 0.4
    default:
      return 1
  }
}

/** The map `intimacyStages.ts`'s `kink_*` conditions read, flattened from the profile. */
export function kinkValenceMap(profile: KinkProfile | undefined): Record<string, number> | undefined {
  if (!profile) return undefined
  const map: Record<string, number> = {}
  for (const [kink, valence] of Object.entries(profile.valence ?? {})) {
    if (typeof valence === 'number') map[kink] = valence
  }
  for (const kink of profile.hardLimits ?? []) map[kink] = -2
  return map
}
