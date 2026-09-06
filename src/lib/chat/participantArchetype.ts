/**
 * Group-chat gap this closes: a non-primary participant gets ZERO relationship-flavor prompt
 * guidance today. `useChatSession.ts`'s `buildCurrentPrompt` only ever builds
 * `relationshipDescription` (via `dating/relationshipDescription.ts`'s `buildRelationshipDescription`)
 * when `speaker.id === character.id` — confirmed by reading that call site directly. A rival, a
 * found-family member, a mentor sharing the scene reads exactly like a generic bystander, even
 * though multi-character relationship tracking (`Chat.participantRelationships`,
 * `getRelationshipTrack`/`stage.ts`) already gives every participant their own independently
 * tracked affection/stats.
 *
 * This is deliberately NOT "give every side character the whole romance/intimacy ladder" — that's
 * real scope creep for a rival or a mentor. It's the narrower, real thing the roadmap actually asks
 * for: a closed set of non-romantic relationship archetypes that shape *tone*, plus a baseline so
 * "zero guidance" becomes "at least something honest about their own, separate footing" even with
 * no archetype authored at all.
 *
 * Authoring surface: deliberately NOT a new field on `Character`/`Chat` (both reserved for this
 * pass, and adding one would need a schema migration + editor UI for a scoped feature). Instead
 * this reads data the card format ALREADY has — `Character.socialConnections`, a free-typed roster
 * of named people a character already authors, whose own doc comment already gives "rival from the
 * debate club" as a first-class example. A participant character showing up in another present
 * character's own `socialConnections` (or vice versa, describing the primary/persona) IS the
 * authored pairing this reads — no new editor UI, no new schema, no migration, and it composes with
 * `world/ambientEvents.ts`'s `selectSocialReaction` reusing the exact same field for a different
 * purpose (a connection who ISN'T present reacting secondhand, vs. one who IS present and has an
 * archetype toward the player).
 *
 * Same split as everything else in this app's prompt-guidance layer (`ambientEventGuidance`,
 * `sceneProgressionNudge`): plain, deterministic code decides whether an authored pairing exists and
 * which closed bucket it falls into; the model gets the real, quoted authored text and writes the
 * actual prose around it, rather than code trying to guess fine-grained direction/nuance itself.
 */

export const RELATIONSHIP_ARCHETYPES = ['rival', 'found_family', 'mentor_mentee', 'power_imbalanced'] as const
export type RelationshipArchetype = (typeof RELATIONSHIP_ARCHETYPES)[number]

/** Shape-compatible with `Character.socialConnections`'s `SocialConnection`, without importing from the reserved `characters/` module — every field this reads is already public on that type. */
export interface NamedConnectionLike {
  name: string
  relation: string
  notes?: string
}

export interface ArchetypeMatch {
  archetype: RelationshipArchetype
  /** Verbatim authored text ("relation — notes") this was classified from, quoted back into the guidance line so the model gets the real specifics rather than just a bucket label. */
  sourceText: string
}

/**
 * Keyword classification, checked in this priority order. A connection's free text could plausibly
 * brush more than one bucket ("my mentor, practically family at this point") — the first bucket
 * that matches wins, an arbitrary but deterministic and documented tie-break, same shape as
 * `ambientEvents.ts`'s own "holiday beats everything else" priority rule.
 */
const ARCHETYPE_KEYWORDS: { archetype: RelationshipArchetype; pattern: RegExp }[] = [
  { archetype: 'rival', pattern: /\b(rival|nemesis|competitor|arch-rival|frenemy)\b/i },
  { archetype: 'found_family', pattern: /\b(sister|brother|sibling|aunt|uncle|cousin|like family|found family|chosen family|adopted)\b/i },
  { archetype: 'mentor_mentee', pattern: /\b(mentor|mentee|teacher|student|senpai|kohai|instructor|coach|apprentice|prot[ée]g[ée]e?)\b/i },
  { archetype: 'power_imbalanced', pattern: /\b(boss|manager|supervisor|employer|employee|subordinate|superior officer|commanding officer|landlord|client)\b/i },
]

/** Classifies one piece of free-typed connection text into a known archetype bucket, or undefined if it doesn't clearly read as any of them (an ordinary "old friend"/"neighbor" stays no-archetype, on purpose — not everything authored needs a tone override). */
export function classifyArchetype(text: string): RelationshipArchetype | undefined {
  return ARCHETYPE_KEYWORDS.find((k) => k.pattern.test(text))?.archetype
}

/**
 * Searches a set of already-authored `socialConnections` lists (whoever's actually present in the
 * scene) for an entry naming one of `targetNames` (case-insensitive, exact-name match against the
 * connection's own `name` field), classifying the first one whose text resolves to a known
 * archetype. Checked in the order `sources` is given — put the more authoritative direction first
 * (conventionally: the scene's primary describing the participant, before the participant's own
 * list describing the primary/persona), since only the first classifiable hit wins.
 */
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

/** Turns a resolved match into the model-facing guidance line — real names interpolated directly, matching `ambientEvents.ts`'s own note that `styleGuidance`-shaped lines are never macro-substituted. */
export function archetypeGuidance(match: ArchetypeMatch, speakerName: string, otherName: string): string {
  return ARCHETYPE_LINES[match.archetype](speakerName, otherName, match.sourceText)
}

/** Coarse, deliberately non-romantic warmth framing for a participant with no authored archetype at all — the plain "not zero" baseline every non-primary participant should get instead of silence. */
function warmthRegister(warmth: number): string {
  if (warmth >= 70) return 'a real, comfortable closeness has built up'
  if (warmth >= 35) return 'a friendly, still-developing familiarity'
  return 'a fairly early, still-forming acquaintance'
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
}

/**
 * The per-participant equivalent of `dating/relationshipDescription.ts`'s `buildRelationshipDescription`
 * — deliberately NOT that function reused as-is: no stage/commitment-ladder/gift-taste framing, since
 * a rival or a mentor sharing a scene isn't on the romance track just because they're present. Fills
 * the confirmed "zero guidance today" gap for every non-primary speaker; layers archetype-specific
 * tone on top when one is authored. See this module's own top comment for the suggested
 * `useChatSession.ts` call site (a reserved file this pass, so it isn't wired in directly here).
 */
export function participantRelationshipGuidance(params: ParticipantGuidanceParams): string {
  const other = params.primaryName ?? 'the rest of the group'
  const baseline = `${params.speakerName} has their own independent footing with ${params.personaName || 'you'} here, separate from ${other}'s — right now that reads as ${warmthRegister(params.warmth)}. Don't default to the same romantic warmth ${other} gets; play ${params.speakerName}'s own footing honestly.`
  const archetypeLine = params.archetype ? archetypeGuidance(params.archetype, params.speakerName, params.archetypeOtherName ?? params.personaName ?? 'you') : ''
  return [baseline, archetypeLine].filter(Boolean).join(' ')
}
