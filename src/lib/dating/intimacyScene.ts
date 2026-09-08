import type { IntimacyCategory } from '@/lib/dating/intimacyCatalog'
import type { CharacterMood } from '@/lib/prompt/mindGuidance'

// Persisted state machine for where an active intimate scene stands (building/peak) and what's
// physically happening, so the model is told rather than left to infer it from scrollback. Sits
// before `aftercare.ts`'s Afterglow in a scene's lifecycle — once a scene resolves here, the
// already-open aftercare window carries the emotional aftermath.

export type IntimacyPhase = 'building' | 'peak'

/** Stored per relationship (`RelationshipTrack.intimacyScene`). `undefined`/`null` = no active scene. */
export interface IntimacyScene {
  phase: IntimacyPhase
  /** Model-facing description of what's currently happening physically, from the clicked catalog entry's resolved prompt note. */
  activityLabel: string
  /** Catalog category of the current activity. */
  category: IntimacyCategory
  /** `countCharReplies` value when the scene last started or changed; used to detect staleness (rewind/fork). */
  updatedAtTurn: number
  /** Turn `phase` last actually changed, distinct from `updatedAtTurn` (which moves on every eval). */
  phaseSinceTurn?: number
  /** Ordered catalog categories this scene has moved through so far, e.g. `['kissing_spot', 'position', 'toy']`. */
  categoryHistory?: IntimacyCategory[]
}

/** True when the scene's turn marker is ahead of the conversation — a rewind/fork artifact. */
export function isIntimacySceneStale(scene: IntimacyScene | undefined | null, charReplyCount: number): boolean {
  return !!scene && scene.updatedAtTurn > charReplyCount
}

/** Whether a scene is currently live and worth telling the model about. */
export function isIntimacySceneActive(scene: IntimacyScene | undefined | null, charReplyCount: number): boolean {
  return !!scene && !isIntimacySceneStale(scene, charReplyCount)
}

/**
 * Starts or re-centers a scene at `building` — a click mid-scene is the consent/renegotiation
 * checkpoint, so a new activity doesn't inherit the old one's intensity. `priorScene` (pass only
 * when live) extends its `categoryHistory` instead of resetting it.
 */
export function startOrShiftIntimacyScene(
  activityLabel: string,
  category: IntimacyCategory,
  charReplyCount: number,
  priorScene?: IntimacyScene | null,
): IntimacyScene {
  const categoryHistory = priorScene ? [...(priorScene.categoryHistory ?? [priorScene.category]), category] : [category]
  return { phase: 'building', activityLabel, category, updatedAtTurn: charReplyCount, phaseSinceTurn: charReplyCount, categoryHistory }
}

/** Whether a character should escalate faster/slower than the generic curve, derived from mood/plans/boundaries. */
export type IntimacyPace = 'reserved' | 'eager' | 'neutral'

const RESERVED_MOODS: readonly CharacterMood[] = ['anxious', 'guarded', 'embarrassed', 'tense', 'exhausted']
const EAGER_MOODS: readonly CharacterMood[] = ['playful', 'excited', 'confident', 'affectionate']

/** Boundary count needed before that alone reads as "reserved by nature". */
const RESERVED_BOUNDARY_FLOOR = 2

export function intimacyPaceFor(mood: CharacterMood | undefined, isHoldingBackByPlan: boolean, boundaryCount: number): IntimacyPace {
  const reserved = isHoldingBackByPlan || boundaryCount >= RESERVED_BOUNDARY_FLOOR || (!!mood && RESERVED_MOODS.includes(mood))
  if (reserved) return 'reserved'
  if (mood && EAGER_MOODS.includes(mood)) return 'eager'
  return 'neutral'
}

/** Turns a `reserved` pace holds the scene at `building` past a same-turn judge jump to `peak`. */
const RESERVED_MIN_BUILDING_TURNS = 2

/** Applies the judge's per-turn phase read. `null` once the judge reads the scene as resolved (aftercare takes over). `undefined`/hold keeps the current phase. */
export function advanceIntimacyScene(
  scene: IntimacyScene,
  judged: IntimacyPhase | 'resolved' | undefined,
  charReplyCount: number,
  pace: IntimacyPace = 'neutral',
): IntimacyScene | null {
  if (judged === 'resolved') return null
  const phaseSinceTurn = scene.phaseSinceTurn ?? scene.updatedAtTurn
  if (!judged || judged === scene.phase) return { ...scene, updatedAtTurn: charReplyCount, phaseSinceTurn }
  // A reserved character holds at `building` one extra beat before honoring a same-turn jump to `peak`.
  if (pace === 'reserved' && judged === 'peak' && scene.phase === 'building' && charReplyCount - phaseSinceTurn < RESERVED_MIN_BUILDING_TURNS) {
    return { ...scene, updatedAtTurn: charReplyCount, phaseSinceTurn }
  }
  return { ...scene, phase: judged, updatedAtTurn: charReplyCount, phaseSinceTurn: charReplyCount }
}

/** `pace`-specific addition to the phase's own pacing line — empty for `neutral`. */
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

/** How many turns the peak phase needs to hold before nudging for variety. */
const PROLONGED_PHASE_TURNS = 3

function prolongedPhaseClause(scene: IntimacyScene): string {
  if (scene.phase !== 'peak') return ''
  const turnsSincePhaseChange = scene.updatedAtTurn - (scene.phaseSinceTurn ?? scene.updatedAtTurn)
  if (turnsSincePhaseChange < PROLONGED_PHASE_TURNS) return ''
  return ` This has held at its peak for a few turns running now — let something actually shift (pace, depth, a brief pause, a change of angle) rather than repeating the same beat over again.`
}

/** Physical continuity + phase-scaled pacing for the active scene. */
export function intimacySceneGuidance(charName: string, scene: IntimacyScene, pace: IntimacyPace = 'neutral'): string {
  const continuity = `Right now, physically, ${charName} is in the middle of: ${scene.activityLabel}. Stay continuous with this until something in the scene actually changes it — don't quietly drift to a different position or act, and don't re-describe getting into it as if it just started.`
  const pacing =
    scene.phase === 'building'
      ? "This is still building, not at its peak yet. Let anticipation, teasing, and the slow accumulation of touch and reaction carry the scene rather than jumping straight to full intensity."
      : "This has built to its peak. Let the intensity actually read as that — more urgency, less restraint, reactions less composed than a moment ago."
  return `${continuity} ${pacing}${paceClauseFor(pace, scene.phase)}${prolongedPhaseClause(scene)}`
}

const CONSENT_TENSION_GAP = 20
const CONSENT_TENSION_COMFORT_FLOOR = 45

/** Nudges toward hesitation/checking-in when comfort trails well behind chemistry mid-scene. */
export function intimacyConsentTensionGuidance(charName: string, comfort: number, chemistry: number): string | undefined {
  if (comfort >= CONSENT_TENSION_COMFORT_FLOOR) return undefined
  if (chemistry - comfort < CONSENT_TENSION_GAP) return undefined
  return `Right now ${charName}'s comfort is trailing well behind the physical chemistry in this scene — the spark is real, but ease and readiness aren't fully there yet. That's worth letting show: a beat of hesitation, an unprompted check-in, or ${charName} naming the mismatch out loud is the right call here, not something to override just because the moment has its own momentum.`
}

const ANTICIPATION_FLOOR = 55

/** Pre-scene anticipation nudge once chemistry and comfort are both already high and nothing physical has started. */
export function intimacyAnticipationGuidance(charName: string, userName: string, chemistry: number, comfort: number): string | undefined {
  if (chemistry < ANTICIPATION_FLOOR || comfort < ANTICIPATION_FLOOR) return undefined
  return `Nothing physical has started yet, but the chemistry and ease between ${charName} and ${userName} are both genuinely high right now — this reads like a scene heading toward an intimate turn on its own momentum. If it naturally moves that way, let the anticipation build honestly (lingering attention, small charged pauses, a held breath) rather than forcing the escalation early or flattening the charge that's already there.`
}

// Explicit-tier-only prose tells — kept separate from `mindGuidance.ts`'s pre-sex STOCK_ROMANCE_PHRASES.
export const EXPLICIT_ANTI_PATTERNS = [
  'waves of pleasure',
  'lost in the sensation',
  'lost in the feeling',
  'their bodies moved as one',
  'their bodies became one',
  'she felt so full',
  'ecstasy',
  'rapture',
  'bliss',
  'ministrations',
  'he entered her',
  'she took him in',
  'he filled her',
  'buried himself',
  'moaned in pleasure',
] as const

/** Whether a peak-phase reply actually used one of the stock phrases it was told to avoid. */
export function detectExplicitAntiPatternUsed(replyText: string, phase: IntimacyPhase): string | undefined {
  if (phase !== 'peak' || !replyText.trim()) return undefined
  const lower = replyText.toLowerCase()
  return EXPLICIT_ANTI_PATTERNS.find((phrase) => lower.includes(phrase))
}

/** Sequenced physical mechanics, anti-pattern list, voice/POV guard for an active explicit-tier scene. `voiceNote` is the character's own authored explicit-voice hint, if any. */
export function explicitSceneGuidance(
  charName: string,
  userName: string,
  phase: IntimacyPhase,
  pace: IntimacyPace = 'neutral',
  voiceNote?: string,
): string {
  const mechanics =
    phase === 'peak'
      ? [
          `Follow the physical sequence in order rather than skipping stages: resistance, then it gives, the first inches, then real depth — and once actually deep, movement itself changes (shorter strokes, grinding, a beat where nothing moves at all) rather than continuing exactly as it started. Give ${charName}'s hips, thighs, hands, and breath something concrete to be doing at each stage, not just once at the end.`,
          `The edge has its own order too, and none of it gets skipped: rhythm that keeps breaking, involuntary clenching, breath that won't stay even, control over voice or movement starting to slip — all of that has to actually appear before anything is named as climax. Don't jump straight from "still building" to climax language.`,
          `When it actually hits, write what ${charName}'s body does — clamping down, pulsing, a sound that isn't a word, pulling ${userName} deeper or needing them to go completely still — instead of a metaphor for the feeling. Right after, the body doesn't just reset: oversensitive, still twitching, unsteady, a few seconds where talking normally isn't quite possible yet.`,
          `Once at peak, intensity doesn't have to sit at maximum in every single sentence — it can ease off for a few beats (slower, deeper, a full stop) and build again, the way it actually would, rather than reading as one flat wall of "as hard as possible" start to finish.`,
          `The same specificity applies to any other touch in the scene, not only penetration — a hand or mouth on breasts, nipples, or anywhere else should register as pressure, a twist, a pull, with a direct physical answer (arching in, a flinch, an involuntary clench), never a vague "played with her" summary.`,
        ].join(' ')
      : `Let the buildup show in the body, not just the mood — resistance easing, first reactions to touch, breath changing, small adjustments — rather than skipping ahead to full intensity before it's actually been earned this scene.`
  const antiPatterns = `Avoid stock explicit-writing tells here regardless of whether they've come up before in this chat — things like "${EXPLICIT_ANTI_PATTERNS.join('", "')}". Reach for one specific physical sensation instead (stretch, resistance, heat, pressure, friction, a pulse) rather than an emotion word or a metaphor standing in for one.`
  const voiceNoteClause = voiceNote?.trim() ? ` For ${charName} specifically: ${voiceNote.trim()}` : ''
  const voice = `${charName}'s established voice doesn't reset here — if they're normally clipped, sarcastic, or formal, that stays true under strain too; their sounds and word choice should still read as them, not a generic register swap into stock scene-narrator voice. The same goes for anything said out loud in the moment — dirty talk, begging, wordless sounds — keep it in ${charName}'s own register (short and broken, silent, or formal cracking under strain, whichever actually fits them) rather than switching to fluent, generic porn dialogue just because the scene turned explicit.${voiceNoteClause}`
  const reservedClause =
    pace === 'reserved'
      ? ` Given who ${charName} is right now, this still shows through even here: more checking in, smaller and less certain reactions, a real chance they need a moment or a full pause rather than just riding the momentum — dirty talk or a confident running commentary would read false for them unless that's genuinely who they are underneath it.`
      : ''
  // The POV guard is carried once, canonically, by `mindGuidance.ts`'s `agencyGuardNote`, which
  // fires on every romantic/intimate moment (this scene included) — not repeated here.
  return [mechanics, antiPatterns, voice + reservedClause].join(' ')
}

/** Immediate post-climax physical beat, fired alongside (not instead of) the content-agnostic `afterglowGuidance` when explicit content is on. */
export function explicitAftercareGuidance(charName: string): string {
  return `${charName}'s body doesn't reset the instant it's over — oversensitive, still twitching or pulsing faintly, legs or hands not quite steady, a few seconds where talking in full, composed sentences isn't really possible yet. Don't let ${charName} snap back to normal and conversational faster than a body actually would.`
}

/** Recent resolved-scene category-sequences to remember, e.g. `['kissing_spot', 'position', 'toy']` per scene. */
export const SCENE_SHAPE_LOG_CAP = 3

/** Appends a resolved scene's category sequence, capped at `SCENE_SHAPE_LOG_CAP`, keeping the most recent. */
export function appendSceneShapeLog(log: string[][] | undefined, shape: string[]): string[][] {
  const next = [...(log ?? []), shape]
  return next.length > SCENE_SHAPE_LOG_CAP ? next.slice(next.length - SCENE_SHAPE_LOG_CAP) : next
}

/** The last two logged shapes, only if identical and long enough (2+ steps) to count as a real curve. */
function lastTwoShapesRepeated(log: string[][] | undefined): string[] | undefined {
  if (!log || log.length < 2) return undefined
  const [a, b] = log.slice(-2)
  if (a.length < 2 || a.length !== b.length) return undefined
  return a.every((cat, i) => cat === b[i]) ? a : undefined
}

/** Nudges variety for the whole duration of a new scene when the two scenes before it traced the identical category sequence. */
export function repeatedEscalationShapeGuidance(charName: string, shapeLog: string[][] | undefined): string | undefined {
  const repeated = lastTwoShapesRepeated(shapeLog)
  if (!repeated) return undefined
  return `The last two intimate scenes with ${charName} both moved through the exact same sequence (${repeated.join(' → ')}), start to finish. Let this one actually diverge somewhere — a different opening, a skipped or reordered step, something new — rather than tracing the identical curve a third time running.`
}
