import type { IntimacyCategory } from '@/lib/dating/intimacyCatalog'
import type { CharacterMood } from '@/lib/prompt/mindGuidance'

/**
 * A real, persisted state machine for *where an intimate scene currently stands* — building,
 * or at its peak — plus continuity for what's physically happening right now, so the model is
 * told rather than left to infer a position/activity from scrollback. This is deliberately narrow
 * and sits *before* `dating/aftercare.ts`'s `Afterglow` in a scene's lifecycle, not instead of it:
 * `Afterglow` already opens the instant an explicit intimacy action starts (see
 * `useChatSession.ts`'s `sendUserMessage`) and judges how the hours *after* went — a completely
 * different question from "is this scene still building or has it peaked". `'afterglow'` is
 * deliberately not a value of `IntimacyPhase` below: once this state machine reads the scene as
 * having resolved, it clears back to nothing and the already-open aftercare window carries the
 * emotional aftermath the rest of the way, with nothing here duplicated.
 */
export type IntimacyPhase = 'building' | 'peak'

/**
 * Stored per relationship (`RelationshipTrack.intimacyScene`). `undefined`/`null` means no scene is
 * currently active — same null-clears convention `Afterglow`/`RelationshipWarning` already use,
 * since `JSON.stringify` drops `undefined`-valued keys and a bare `undefined` here would silently
 * fail to close out a finished scene.
 */
export interface IntimacyScene {
  phase: IntimacyPhase
  /**
   * A model-facing description of what's currently happening physically — "spooning: you at
   * {char}'s back, both on your sides", "using a vibrator on {char}, teasing before giving them
   * what they want", etc. Taken verbatim from the clicked catalog entry's own resolved prompt note
   * (`intimacyCatalog.ts`'s `resolveIntimacyPromptNote`), `{char}` already substituted, so it reads
   * exactly the way the character's own reply-turn directive already does — no separate authoring.
   */
  activityLabel: string
  /** The catalog category the current activity came from — `kissing_spot` never reaches this (see `isExplicitCategory`; only explicit-tier actions open a scene at all). */
  category: IntimacyCategory
  /**
   * `countCharReplies` value when this scene most recently started or changed. Same staleness
   * convention as `Afterglow.startedAtTurn`: a value now *ahead* of the conversation (a rewind or a
   * fork-from-earlier) means this is stale, not currently live — see `isIntimacySceneStale`.
   */
  updatedAtTurn: number
  /**
   * The turn `phase` most recently actually *changed* to its current value — distinct from
   * `updatedAtTurn` above, which is "last touched" and moves on every single evaluation, including
   * one that held the phase steady. `advanceIntimacyScene` needs to tell "how long has this scene
   * actually been building" apart from "when was this scene last looked at", to gate a reserved
   * character's building phase against a premature same-turn jump to peak (item 1's
   * character-specific pacing). Optional so a scene persisted before this field existed still reads
   * fine — `advanceIntimacyScene` falls back to `updatedAtTurn` for it.
   */
  phaseSinceTurn?: number
}

/** True when the stored scene's own turn marker is now ahead of the conversation — a rewind/fork artifact, not a currently-live scene. */
export function isIntimacySceneStale(scene: IntimacyScene | undefined | null, charReplyCount: number): boolean {
  return !!scene && scene.updatedAtTurn > charReplyCount
}

/** Whether a scene should currently be treated as live and worth telling the model about. */
export function isIntimacySceneActive(scene: IntimacyScene | undefined | null, charReplyCount: number): boolean {
  return !!scene && !isIntimacySceneStale(scene, charReplyCount)
}

/**
 * Starts (or re-centers) the state machine — called from the exact site that already opens the
 * aftercare window (`useChatSession.ts`'s `sendUserMessage`) whenever the player clicks an
 * explicit-category intimacy action. A click while a scene is *already* active is itself the
 * consent-checkpoint/renegotiation signal item 1 asks for: a new position/toy/activity goes through
 * the same warmth/commitment-gated catalog click every intimacy action already requires (nothing
 * free-form), and re-centering here steps the phase back to `'building'` rather than assuming the
 * new thing instantly continues at `'peak'` — a changed trajectory earns its own build, it doesn't
 * inherit the old one's intensity.
 */
export function startOrShiftIntimacyScene(activityLabel: string, category: IntimacyCategory, charReplyCount: number): IntimacyScene {
  return { phase: 'building', activityLabel, category, updatedAtTurn: charReplyCount, phaseSinceTurn: charReplyCount }
}

/**
 * Item 1's character-specificity signal: whether this particular character should escalate faster
 * or slower than the generic curve, read from state the app already tracks rather than a new
 * authored field. `reserved` wins whenever there's a real reason to expect more caution — the
 * character is deliberately holding back (a `distance`-kind plan), currently in a mood that already
 * pulls against romantic momentum (reusing the same instinct `mindGuidance.ts`'s
 * `authoredStatePriorityNote` fires on), or has authored enough hard boundaries that caution is
 * plausibly just who they are. `eager` only applies once none of that is true and the mood itself
 * reads as open/confident. Everything else — the common case — reads as `neutral`, the original
 * one-curve behavior.
 */
export type IntimacyPace = 'reserved' | 'eager' | 'neutral'

const RESERVED_MOODS: readonly CharacterMood[] = ['anxious', 'guarded', 'embarrassed', 'tense', 'exhausted']
const EAGER_MOODS: readonly CharacterMood[] = ['playful', 'excited', 'confident', 'affectionate']

/** A character needs at least this many authored boundaries before that alone reads as "reserved by nature" — one or two ordinary limits shouldn't flip the whole pacing read. */
const RESERVED_BOUNDARY_FLOOR = 2

export function intimacyPaceFor(mood: CharacterMood | undefined, isHoldingBackByPlan: boolean, boundaryCount: number): IntimacyPace {
  const reserved = isHoldingBackByPlan || boundaryCount >= RESERVED_BOUNDARY_FLOOR || (!!mood && RESERVED_MOODS.includes(mood))
  if (reserved) return 'reserved'
  if (mood && EAGER_MOODS.includes(mood)) return 'eager'
  return 'neutral'
}

/** How many of the character's own replies a `reserved` pace holds the scene at `building` even after the judge reads a same-turn jump to `peak` — one extra beat, not a hard multi-turn block. */
const RESERVED_MIN_BUILDING_TURNS = 2

/**
 * Applies the judge's per-turn phase read (`relationshipAssist.ts`'s `intimacyPhase` field, asked
 * for only while a scene is active — the same ride-along trick `aftercareVerdict`/`completedTaskIndices`
 * already use, so this costs no extra model call). Returns the next scene, or `null` once the judge
 * reads the scene as having wound down or concluded — which hands off entirely to the aftercare
 * window that's already open; nothing here needs to re-derive when the aftermath itself ends.
 * A `hold`/unreadable turn (`undefined`) keeps the current phase rather than resetting it, the same
 * "omit means no change" contract `mood`/`currentNeed` already have.
 */
export function advanceIntimacyScene(
  scene: IntimacyScene,
  judged: IntimacyPhase | 'resolved' | undefined,
  charReplyCount: number,
  pace: IntimacyPace = 'neutral',
): IntimacyScene | null {
  if (judged === 'resolved') return null
  const phaseSinceTurn = scene.phaseSinceTurn ?? scene.updatedAtTurn
  if (!judged || judged === scene.phase) return { ...scene, updatedAtTurn: charReplyCount, phaseSinceTurn }
  // Item 1's character-specific gating: a `reserved` character earns a same-turn jump from
  // `building` fresh into `peak` more slowly than the generic curve — held at `building` for one
  // more beat rather than honored instantly, the same way a real person who needs more time would
  // read. Not a hard block: once `RESERVED_MIN_BUILDING_TURNS` have actually passed, the judge's
  // read is trusted same as any other pace.
  if (pace === 'reserved' && judged === 'peak' && scene.phase === 'building' && charReplyCount - phaseSinceTurn < RESERVED_MIN_BUILDING_TURNS) {
    return { ...scene, updatedAtTurn: charReplyCount, phaseSinceTurn }
  }
  return { ...scene, phase: judged, updatedAtTurn: charReplyCount, phaseSinceTurn: charReplyCount }
}

/**
 * Sensory-layering `styleGuidance`, scaled to phase, plus the physical-continuity line that's the
 * whole point of persisting this: telling the model what's currently happening instead of leaving
 * it to infer a position from scrollback (or worse, quietly drift to a different one). Never names
 * anything beyond what `scene.activityLabel` already says — that string is itself gated by warmth/
 * commitment/the explicit-content rating upstream, at the moment the action was clicked — so this
 * only ever governs pacing and register, never unlocks content. Real names, no `{{macros}}`
 * (`styleGuidance` strings are never macro-substituted; see `mindGuidance.ts`'s own note).
 */
/** The `pace`-specific addition to the phase's own pacing line — empty for `neutral`, the original one-curve text. */
function paceClauseFor(pace: IntimacyPace, phase: IntimacyPhase): string {
  if (pace === 'reserved') {
    return phase === 'building'
      ? " Given who they are right now, this is taking longer to build than it might for someone more at ease — small hesitations, needing a moment, or checking in first are the natural, in-character read here, not a flaw in the scene."
      : " Even here at the peak, some of that same carefulness can still show through — reaching this point took more for them than it would for someone less guarded, and that can still color how they experience it."
  }
  if (pace === 'eager') {
    return phase === 'building'
      ? " Given who they are right now, they lean into this more readily than someone more guarded would — quicker to let go of hesitation, without skipping real consent or care."
      : ''
  }
  return ''
}

export function intimacySceneGuidance(charName: string, scene: IntimacyScene, pace: IntimacyPace = 'neutral'): string {
  const continuity = `Right now, physically, ${charName} is in the middle of: ${scene.activityLabel}. Stay continuous with this until something in the scene actually changes it — don't quietly drift to a different position or act, and don't re-describe getting into it as if it just started.`
  const pacing =
    scene.phase === 'building'
      ? "This is still building, not at its peak yet. Let anticipation, teasing, and the slow accumulation of touch and reaction carry the scene rather than jumping straight to full intensity."
      : "This has built to its peak. Let the intensity actually read as that — more urgency, less restraint, reactions less composed than a moment ago."
  return `${continuity} ${pacing}${paceClauseFor(pace, scene.phase)}`
}

/**
 * Item 1's mid-scene consent/comfort-vs-chemistry tension signal: the existing phase pacing above is
 * driven entirely by chemistry/momentum, with nothing checking whether *comfort* has actually kept
 * up. When it hasn't, that's worth the model hearing explicitly rather than only ever escalating on
 * the chemistry read — hesitation and checking in are the right call here, not a generic romance
 * "of course she wants this" override. Fires only once the gap is real (`CONSENT_TENSION_GAP`) *and*
 * comfort itself is still short of comfortable (`CONSENT_TENSION_COMFORT_FLOOR`) — two people who are
 * both already very at ease just have a wide spark/ease gap for no concerning reason.
 */
const CONSENT_TENSION_GAP = 20
const CONSENT_TENSION_COMFORT_FLOOR = 45

export function intimacyConsentTensionGuidance(charName: string, comfort: number, chemistry: number): string | undefined {
  if (comfort >= CONSENT_TENSION_COMFORT_FLOOR) return undefined
  if (chemistry - comfort < CONSENT_TENSION_GAP) return undefined
  return `Right now ${charName}'s comfort is trailing well behind the physical chemistry in this scene — the spark is real, but ease and readiness aren't fully there yet. That's worth letting show: a beat of hesitation, an unprompted check-in, or ${charName} naming the mismatch out loud is the right call here, not something to override just because the moment has its own momentum.`
}

/**
 * Item 1's deterministic pre-scene buildup: `sceneProgressionNudge`/`ambientEventGuidance` already
 * prime the model toward other developments before they happen; nothing did the same for an intimate
 * scene specifically, so the turn it actually starts could land with no anticipation at all. Fires
 * only while chemistry AND comfort are both already high (`ANTICIPATION_FLOOR`) and — per the
 * caller's own gate — no scene is active yet, so this never overlaps with `intimacySceneGuidance`.
 */
const ANTICIPATION_FLOOR = 55

export function intimacyAnticipationGuidance(charName: string, userName: string, chemistry: number, comfort: number): string | undefined {
  if (chemistry < ANTICIPATION_FLOOR || comfort < ANTICIPATION_FLOOR) return undefined
  return `Nothing physical has started yet, but the chemistry and ease between ${charName} and ${userName} are both genuinely high right now — this reads like a scene heading toward an intimate turn on its own momentum. If it naturally moves that way, let the anticipation build honestly (lingering attention, small charged pauses, a held breath) rather than forcing the escalation early or flattening the charge that's already there.`
}
