/**
 * Relationship-flavor prompt guidance for non-primary participants in a group chat, who otherwise
 * read as generic bystanders even though they have their own tracked affection/stats. Classifies an
 * authored `Character.socialConnections` entry into a closed set of non-romantic archetypes (rival,
 * found family, mentor/mentee, power-imbalanced) and turns that into a model-facing guidance line;
 * falls back to a plain warmth-based baseline when nothing is authored.
 */

import type { CommitmentStatus } from '@/lib/types'

export const RELATIONSHIP_ARCHETYPES = ['rival', 'found_family', 'mentor_mentee', 'power_imbalanced'] as const
export type RelationshipArchetype = (typeof RELATIONSHIP_ARCHETYPES)[number]

/** Shape-compatible with `Character.socialConnections`'s `SocialConnection`. */
export interface NamedConnectionLike {
  name: string
  relation: string
  notes?: string
}

export interface ArchetypeMatch {
  archetype: RelationshipArchetype
  /** Verbatim authored text ("relation — notes") this was classified from. */
  sourceText: string
}

/** Keyword classification, checked in priority order; the first bucket that matches wins. */
const ARCHETYPE_KEYWORDS: { archetype: RelationshipArchetype; pattern: RegExp }[] = [
  { archetype: 'rival', pattern: /\b(rival|nemesis|competitor|arch-rival|frenemy)\b/i },
  { archetype: 'found_family', pattern: /\b(sister|brother|sibling|aunt|uncle|cousin|like family|found family|chosen family|adopted)\b/i },
  { archetype: 'mentor_mentee', pattern: /\b(mentor|mentee|teacher|student|senpai|kohai|instructor|coach|apprentice|prot[ée]g[ée]e?)\b/i },
  { archetype: 'power_imbalanced', pattern: /\b(boss|manager|supervisor|employer|employee|subordinate|superior officer|commanding officer|landlord|client)\b/i },
]

/** Classifies free-typed connection text into a known archetype bucket, or undefined (e.g. a plain "old friend"). */
export function classifyArchetype(text: string): RelationshipArchetype | undefined {
  return ARCHETYPE_KEYWORDS.find((k) => k.pattern.test(text))?.archetype
}

/** Searches authored `socialConnections` lists for an entry naming one of `targetNames`, classifying the first match. Checked in the order `sources` is given — put the more authoritative direction first. */
export function findArchetypeMatch(targetNames: string[], sources: { connections: NamedConnectionLike[] | undefined }[]): ArchetypeMatch | undefined {
  const targets = new Set(targetNames.map((n) => n.trim().toLowerCase()).filter(Boolean))
  if (!targets.size) return undefined
  for (const source of sources) {
    for (const entry of source.connections ?? []) {
      if (!targets.has(entry.name.trim().toLowerCase())) continue
      const sourceText = `${entry.relation}${entry.notes ? ` — ${entry.notes}` : ''}`.trim()
      const archetype = classifyArchetype(sourceText)
      if (archetype) return { archetype, sourceText }
    }
  }
  return undefined
}

const ARCHETYPE_LINES: Record<RelationshipArchetype, (speaker: string, other: string, quote: string) => string> = {
  rival: (speaker, other, quote) =>
    `${speaker} and ${other} have a real, specific rivalry (authored: "${quote}"). Let that competitive edge, quick to needle or one-up, guarded about admitting respect, color ${speaker}'s tone here. This is its own dynamic, not a stand-in for romantic interest in {{user}}.`,
  found_family: (speaker, other, quote) =>
    `${speaker} treats ${other} like family (authored: "${quote}") — protective, unconditionally warm, comfortable enough to tease or worry aloud. Familial closeness, not romantic framing.`,
  mentor_mentee: (speaker, other, quote) =>
    `There's a real teacher/student dynamic between ${speaker} and ${other} (authored: "${quote}"). Let whichever direction that actually runs show through: guidance and genuine expectations on one side, some deference (with room to push back) on the other.`,
  power_imbalanced: (speaker, other, quote) =>
    `${speaker} and ${other} have a genuine professional power gap between them (authored: "${quote}"). Let that imbalance shape the tone: formality, caution, authority, or deference, whichever side of it ${speaker} is actually on, rather than the easy equality of peers.`,
}

/** Turns a resolved match into the model-facing guidance line, with real names interpolated directly. */
export function archetypeGuidance(match: ArchetypeMatch, speakerName: string, otherName: string): string {
  return ARCHETYPE_LINES[match.archetype](speakerName, otherName, match.sourceText)
}

/** Coarse, non-romantic warmth framing for a participant with no authored archetype at all. */
function warmthRegister(warmth: number): string {
  if (warmth >= 70) return 'a real, comfortable closeness has built up'
  if (warmth >= 35) return 'a friendly, still-developing familiarity'
  return 'a fairly early, still-forming acquaintance'
}

/**
 * A rival who reads identically whether the primary and {{user}} are near strangers or already
 * married isn't a real rivalry *arc* — it's a static tone label. This is the deepening: the rival's
 * own line now genuinely responds to how far the PRIMARY relationship has actually progressed,
 * using the same `COMMITMENT_ORDER` ladder (`dating/stage.ts`) everything else in the app reads off
 * of. Deliberately scoped to `rival` alone — found-family/mentor-mentee/power-imbalanced aren't
 * reframed by the primary's romance status the same way a rivalry over that exact relationship is.
 * Returns `''` for `'none'` (or no status at all): with nothing yet between the primary and
 * {{user}}, the base rival line already covers it and there's nothing more specific to say.
 */
export function rivalCommitmentFraming(
  primaryCommitmentStatus: CommitmentStatus | undefined,
  primaryName: string,
  personaName: string,
): string {
  switch (primaryCommitmentStatus ?? 'none') {
    case 'dating':
      return `Nothing is locked in yet between ${primaryName} and ${personaName}, so a live, still-competing rivalry, genuinely hoping this could still go a different way, is fair to play.`
    case 'exclusive':
      return `${primaryName} and ${personaName} are exclusive now, which changes what this rivalry can honestly mean: real jealousy or an old torch still carried is fair, but acting like the field is still open would read as delusional or a real boundary problem.`
    case 'living_together':
    case 'married':
      return `${primaryName} and ${personaName} have a serious, settled commitment by now (${primaryCommitmentStatus === 'married' ? 'married' : 'living together'}) — this rivalry has to read as history, a private old feeling, or begrudging respect, not anything still actively contesting that commitment.`
    case 'none':
    default:
      return ''
  }
}

/**
 * A rival's actual, in-scene PRESENCE is supposed to make a live jealousy beat cut harder than the
 * same tension read about secondhand (that secondhand case is exactly what `ambientEvents.ts`'s own
 * `social_reaction` already covers) — today a jealousy `SceneFlag` (`stage.ts`'s `SCENE_FLAGS`) reads
 * identically whether the rival is standing right there or a thousand miles away. Returns `''` when
 * the flag isn't currently active, so this only ever adds weight to a jealousy beat that's genuinely
 * already live, never invents one.
 */
export function rivalJealousyIntensifier(rivalName: string, jealousyFlagActive: boolean | undefined): string {
  if (!jealousyFlagActive) return ''
  return `This is playing out with ${rivalName} genuinely standing right here, not just mentioned or heard about secondhand — let that presence sharpen the jealousy beat: less patience, sharper edges, higher stakes than the same tension would read at a distance.`
}

export interface ParticipantGuidanceParams {
  speakerName: string
  personaName: string
  /** The scene's primary character's name, for the "don't just borrow their romantic warmth" framing — omitted (a plain group chat with no primary) falls back to generic wording. */
  primaryName?: string
  /** This participant's own tracked warmth toward {{user}} (`computeWarmth` over their own `RelationshipTrack`) — independent of the primary's, per `getRelationshipTrack`. */
  warmth: number
  archetype?: ArchetypeMatch
  /** Who the archetype line should name as the "other" party — the primary's name for a primary-vs-participant pairing, or the persona name for a participant-vs-player one. Defaults to `personaName`. */
  archetypeOtherName?: string
  /**
   * The PRIMARY's own commitment tier with {{user}} (`Chat`/`RelationshipTrack.commitmentStatus`,
   * via `dating/stage.ts`'s `COMMITMENT_ORDER`) — only used to deepen a `rival` archetype match (see
   * `rivalCommitmentFraming`). Omit when unavailable or when the archetype isn't `rival`; nothing
   * breaks, the rivalry just reads at its base tone with no commitment-aware framing layered on.
   */
  primaryCommitmentStatus?: CommitmentStatus
  /**
   * Whether a jealousy `SceneFlag` (`stage.ts`'s `SCENE_FLAGS`) is currently active in this chat —
   * only used to deepen a `rival` archetype match (see `rivalJealousyIntensifier`). Omit when
   * unavailable; the jealousy beat, if any, simply isn't intensified by this participant's presence.
   */
  jealousyFlagActive?: boolean
}

/**
 * The per-participant equivalent of `dating/relationshipDescription.ts`'s `buildRelationshipDescription`
 * — deliberately NOT that function reused as-is: no stage/commitment-ladder/gift-taste framing, since
 * a rival or a mentor sharing a scene isn't on the romance track just because they're present. Fills
 * the confirmed "zero guidance today" gap for every non-primary speaker; layers archetype-specific
 * tone on top when one is authored, and — for a `rival` specifically — layers on how the PRIMARY
 * relationship's own progress and any live jealousy beat should shape that rival's tone (see
 * `rivalCommitmentFraming`/`rivalJealousyIntensifier`). See this module's own top comment for the
 * suggested `useChatSession.ts` call site (a reserved file this pass, so it isn't wired in directly
 * here) — including the two new optional fields above, which need threading through from state that
 * call site already computes.
 */
export function participantRelationshipGuidance(params: ParticipantGuidanceParams): string {
  const other = params.primaryName ?? 'the rest of the group'
  const baseline = `${params.speakerName} has their own independent footing with ${params.personaName || 'you'} here, separate from ${other}'s — right now that reads as ${warmthRegister(params.warmth)}. Don't default to the same romantic warmth ${other} gets; play ${params.speakerName}'s own footing honestly.`
  const archetypeLine = params.archetype ? archetypeGuidance(params.archetype, params.speakerName, params.archetypeOtherName ?? params.personaName ?? 'you') : ''
  const isRival = params.archetype?.archetype === 'rival'
  const commitmentLine = isRival
    ? rivalCommitmentFraming(params.primaryCommitmentStatus, params.primaryName ?? params.archetypeOtherName ?? 'them', params.personaName ?? 'you')
    : ''
  const jealousyLine = isRival ? rivalJealousyIntensifier(params.speakerName, params.jealousyFlagActive) : ''
  return [baseline, archetypeLine, commitmentLine, jealousyLine].filter(Boolean).join(' ')
}
