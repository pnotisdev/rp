/**
 * 10b's "intent chips" — an optional tag the player attaches to a message to say how a line is
 * *meant*, distinct from what it literally says. "You look nice tonight" reads very differently as
 * a flirt versus gentle teasing versus an olive branch after an argument.
 *
 * An intent never moves a stat by itself. It's handed to the relationship judge
 * (`assessRelationshipMoment` / `assessDateOutcome`) as context for interpreting the exchange — and
 * it can backfire: a flirt that's mistimed, or an apology that reads as insincere given how things
 * have actually been going, lands worse than an untagged line would have.
 */

import type { MessageIntent, RelationshipDimension } from '@/lib/types'

export type { MessageIntent }

export interface IntentSpec {
  id: MessageIntent
  /** Chip label. */
  label: string
  /** Tooltip / one-liner on what the tag signals. */
  hint: string
  /** How the judge is told to read a line carrying this tag. Phrased so a good read helps and a bad one costs. */
  judgeLine: string
  /**
   * Only offered once this dimension is elevated — reassure and apologize don't make sense to
   * surface until there's friction to address. `null` = always available.
   */
  gatedBy: { dimension: RelationshipDimension; atLeast: number } | null
}

export const MESSAGE_INTENTS: IntentSpec[] = [
  {
    id: 'flirt',
    label: 'Flirt',
    hint: 'Meant as an advance — charm, a compliment with weight behind it.',
    judgeLine:
      'a flirt: read whether it landed. Welcome and well-timed, it builds chemistry; unwanted, clumsy, or too fast for where things stand, it adds tension or costs comfort.',
    gatedBy: null,
  },
  {
    id: 'tease',
    label: 'Tease',
    hint: 'Playful needling, not serious.',
    judgeLine:
      'playful teasing, not a real jab. If {{char}} enjoys the banter it warms things; if it hits a sore spot or reads as mocking, it stings.',
    gatedBy: null,
  },
  {
    id: 'open_up',
    label: 'Open up',
    hint: 'Sharing something real or vulnerable.',
    judgeLine:
      'the player opening up — sharing something real or vulnerable. Met with warmth it builds trust and closeness; brushed off or overshared too early, it can feel exposing.',
    gatedBy: null,
  },
  {
    id: 'reassure',
    label: 'Reassure',
    hint: 'Meant to steady or comfort them.',
    judgeLine:
      'an attempt to reassure or comfort {{char}}. If it addresses what is actually wrong it eases tension and builds trust; if it feels generic or dismissive of their feelings, it does little or lands badly.',
    gatedBy: { dimension: 'tension', atLeast: 12 },
  },
  {
    id: 'apologize',
    label: 'Apologize',
    hint: 'Meant as a genuine apology.',
    judgeLine:
      'a genuine apology. A real one that names the wrong can clear tension and rebuild respect; a hollow or defensive one ("sorry you feel that way") can make things worse.',
    gatedBy: { dimension: 'tension', atLeast: 12 },
  },
]

const BY_ID = new Map(MESSAGE_INTENTS.map((i) => [i.id, i]))

export function intentSpec(id: string | undefined): IntentSpec | undefined {
  return id ? BY_ID.get(id as MessageIntent) : undefined
}

export function isMessageIntent(v: unknown): v is MessageIntent {
  return typeof v === 'string' && BY_ID.has(v as MessageIntent)
}

/** The chips to offer given the current relationship stats — the two friction-repair ones only once there's friction. */
export function availableIntents(stats: Partial<Record<RelationshipDimension, number>>): IntentSpec[] {
  return MESSAGE_INTENTS.filter(
    (i) => !i.gatedBy || (stats[i.gatedBy.dimension] ?? 0) >= i.gatedBy.atLeast,
  )
}

/** One prompt line naming how the player's most recent line was meant — undefined when untagged. */
export function describeIntentForJudge(id: string | undefined): string | undefined {
  const spec = intentSpec(id)
  if (!spec) return undefined
  return `The player tagged their latest line as ${spec.judgeLine} Weigh {{char}}'s honest reaction to that; do not just reward the attempt.`
}

/** Summary line for the end-of-date judge — which intents the player leaned on across the scene. */
export function describeIntentsForDate(ids: string[]): string | undefined {
  const counts = new Map<string, number>()
  for (const id of ids) {
    const spec = intentSpec(id)
    if (spec) counts.set(spec.label, (counts.get(spec.label) ?? 0) + 1)
  }
  if (counts.size === 0) return undefined
  const parts = [...counts.entries()].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label))
  return `Across the date the player deliberately played these beats: ${parts.join(', ')}. Judge how well each was read and timed, not merely that it was tried.`
}
