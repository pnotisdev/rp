import type { RelationshipDeltas } from '@/lib/dating/relationshipAssist'
import type { CharacterNeed } from '@/lib/prompt/mindGuidance'

// Aftercare: the window right after an intimate scene. An explicit intimacy action (or the "first
// time together" milestone) opens a few-turn window during which the character is written as being
// in the immediate aftermath. When it closes, the same per-turn judge that already runs on every
// reply is asked one extra question about how those turns went, riding along at no extra model cost
// (same trick as objective-task detection).

/** How many of the character's own replies the window covers. Long enough to require sustaining something, short enough to still read as "after". */
export const AFTERGLOW_TURNS = 4

/** Closed vocabulary, same reasoning as `MOOD_VOCAB`. */
export const AFTERCARE_VERDICTS = ['tender', 'awkward', 'cold'] as const
export type AftercareVerdict = (typeof AFTERCARE_VERDICTS)[number]

/** State stored on a `RelationshipTrack` while the window is open. Cleared once its outcome is applied. */
export interface Afterglow {
  /** Character's own reply count when the scene was initiated — measured in their turns, not raw messages or world-clock time. */
  startedAtTurn: number
  /** Short label of what opened it, for prompt flavour only. */
  sourceLabel?: string
  /** Snapshot of `RelationshipTrack.momentum` at the moment the window opened (not recomputed at close, when momentum has already moved on). See `aftercarePaceContext`. */
  momentumAtStart?: number
}

/** Turns into the window, or `null` for no live window — including a stale one whose start is now ahead of the conversation (a rewind/fork). */
export function afterglowTurnsSince(afterglow: Afterglow | undefined, charReplyCount: number): number | null {
  if (!afterglow) return null
  const since = charReplyCount - afterglow.startedAtTurn
  if (since < 0) return null
  return since
}

/** The unit the window is counted in — the character's own replies. */
export function countCharReplies(messages: readonly { role: string }[]): number {
  return messages.reduce((n, m) => (m.role === 'char' ? n + 1 : n), 0)
}

/** Whether the window has run its course and its outcome is now due. */
export function isAfterglowComplete(afterglow: Afterglow | undefined, charReplyCount: number): boolean {
  const since = afterglowTurnsSince(afterglow, charReplyCount)
  return since !== null && since >= AFTERGLOW_TURNS
}

/** Whether the character should currently be written as being in the aftermath. */
export function isAfterglowActive(afterglow: Afterglow | undefined, charReplyCount: number): boolean {
  const since = afterglowTurnsSince(afterglow, charReplyCount)
  return since !== null && since < AFTERGLOW_TURNS
}

const ZERO: RelationshipDeltas = { affection: 0, trust: 0, chemistry: 0, comfort: 0, respect: 0, curiosity: 0, tension: 0 }

// `cold` is the sharpest of the three and the only one moving `tension` — a specific, memorable
// hurt. `awkward` is close to nothing on purpose — fumbling the moment isn't a betrayal.
const VERDICT_DELTAS: Record<AftercareVerdict, Partial<RelationshipDeltas>> = {
  tender: { affection: 2, trust: 3, comfort: 3, chemistry: 1 },
  awkward: { comfort: 1 },
  cold: { affection: -1, trust: -4, comfort: -4, tension: 3 },
}

export function aftercareDeltas(verdict: AftercareVerdict): RelationshipDeltas {
  return { ...ZERO, ...VERDICT_DELTAS[verdict] }
}

/** One-line reason logged to the relationship history. */
export function aftercareReason(verdict: AftercareVerdict): string {
  switch (verdict) {
    case 'tender':
      return 'Stayed close and warm in the hours after'
    case 'cold':
      return 'Pulled away in the hours after'
    case 'awkward':
    default:
      return 'The hours after landed awkwardly'
  }
}

/** Player-facing toast when a window resolves. `awkward` returns null — not every outcome deserves an interruption. */
export function aftercareToast(charName: string, verdict: AftercareVerdict): string | null {
  switch (verdict) {
    case 'tender':
      return `${charName} felt looked after in the hours that followed.`
    case 'cold':
      return `${charName} was left alone with it afterwards.`
    default:
      return null
  }
}

/** The underlying need a verdict leaves behind, routed through `currentNeed` so a `cold` aftermath keeps colouring the character afterward. Only `cold` leaves one — `tender` has no need to invent. */
export function aftercareNeed(verdict: AftercareVerdict): CharacterNeed | undefined {
  return verdict === 'cold' ? 'reassurance' : undefined
}

export function isAftercareVerdict(value: unknown): value is AftercareVerdict {
  return typeof value === 'string' && (AFTERCARE_VERDICTS as readonly string[]).includes(value)
}

/** Whether the warmth driving toward this milestone built up gradually or spiked right beforehand — reuses `momentum.ts`'s own "deepening fast" bar. `undefined` when there's no snapshot to read (never treated as a silent "earned"). Extra context for the judge only, not part of `AftercareVerdict`'s vocabulary. */
export type AftercarePace = 'earned' | 'rushed'

const RUSHED_MOMENTUM_THRESHOLD = 2

export function aftercarePaceContext(momentumAtStart: number | undefined): AftercarePace | undefined {
  if (momentumAtStart === undefined) return undefined
  return momentumAtStart >= RUSHED_MOMENTUM_THRESHOLD ? 'rushed' : 'earned'
}
