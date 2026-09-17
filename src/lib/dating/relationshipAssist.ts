import type { ChatBackend } from '@/lib/api/chatBackend'
import type { GenerateRequest } from '@/lib/api/types'
import { parseLenientJson } from '@/lib/jsonRepair'
import type { Character } from '@/lib/characters/cardSpec'
import type { CommitmentStatus, CustomSceneFlag, DateEventCard, RelationshipDimension, SceneFlag } from '@/lib/types'
import type { ChatMessage } from '@/lib/prompt/builder'
import { formatCommitmentStatus, RELATIONSHIP_DIMENSIONS, SCENE_FLAGS } from '@/lib/dating/stage'
import { describeIntentForJudge, describeIntentsForDate } from '@/lib/dating/intent'
import { substituteMacros } from '@/lib/characters/macros'
import { AFTERCARE_VERDICTS, isAftercareVerdict, type AftercareVerdict } from '@/lib/dating/aftercare'
import { MOOD_VOCAB, NEED_VOCAB, type CharacterMood, type CharacterNeed } from '@/lib/prompt/mindGuidance'
import type { AftercarePace } from '@/lib/dating/aftercare'
import { parsePlanUpdates, type PlanUpdate } from '@/lib/dating/plans'
import { CLOTHING_LAYERS } from '@/lib/dating/clothing'
import { BODY_REGIONS, parseIntimacyObservation } from '@/lib/dating/intimacyScene'
import { SCENE_PLAYER } from '@/lib/dating/sceneParticipants'
import type { IntimacyPhase, IntimacyTurnObservation } from '@/lib/dating/intimacyScene'
import { parseBeliefUpdates, type BeliefUpdate } from '@/lib/dating/beliefs'
import { parseExpectationUpdates, type ExpectationUpdate } from '@/lib/dating/expectations'

// Builds the relationship-judge prompts/schemas: per-turn deltas, scene flags, durable facts,
// date/hangout outcomes, and the commitment/intimacy-milestone asks. Each exported function
// assembles a prompt, calls the model with a timeout, and parses+validates the JSON reply.

// max_context_length omitted — callers fetch the server's actual context via `client.getEffectiveMaxContext()`.
const REL_PARAMS = {
  max_length: 220,
  temperature: 0.35,
  top_p: 1,
  top_k: 0,
  min_p: 0,
  typical: 1,
  tfs: 1,
  rep_pen: 1.1,
  rep_pen_range: 1024,
  rep_pen_slope: 0.7,
  stop_sequence: ['\n\n\n', '```'],
  trim_stop: true,
}

const EVENT_PARAMS = {
  ...REL_PARAMS,
  max_length: 360,
  temperature: 0.7,
  min_p: 0.05,
}

// Aborts a hung `generate` call instead of leaving the caller stuck forever (e.g. a rate-limited
// provider that never resolves). Every assist call below shares this shape.
export const ASSIST_TIMEOUT_MS = 45_000

/** Races `client.generate` against `ASSIST_TIMEOUT_MS`, rejecting with a caller-surfaceable message on timeout. */
export async function generateWithTimeout(client: ChatBackend, params: GenerateRequest, label: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ASSIST_TIMEOUT_MS)
  try {
    return await client.generate(params, controller.signal)
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${Math.round(ASSIST_TIMEOUT_MS / 1000)}s — the model backend didn't respond in time.`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function recentText(history: ChatMessage[], charName: string, userName: string, depth = 6): string {
  return history
    .slice(-depth)
    .filter((m) => m.text.trim())
    .map((m) => `${m.role === 'user' ? userName : charName}: ${m.text}`)
    .join('\n')
}

export type RelationshipDeltaKey = 'affection' | RelationshipDimension
export type RelationshipDeltas = Record<RelationshipDeltaKey, number>

const DELTA_KEYS: RelationshipDeltaKey[] = ['affection', ...RELATIONSHIP_DIMENSIONS]

const DIMENSION_GLOSSARY: Record<RelationshipDeltaKey, string> = {
  affection: 'overall fondness',
  trust: 'reliability and emotional safety',
  chemistry: 'romantic/physical spark',
  comfort: 'ease being around each other',
  respect: 'how much they respect the other person',
  curiosity: 'interest in learning more about them',
  tension: 'friction or unresolved conflict. A positive delta here means MORE tension, which is not automatically a bad thing dramatically',
}

/** One-line definition per flag, so the classifier has an actual bar to clear instead of guessing from the name. */
const FLAG_GLOSSARY: Record<SceneFlag, string> = {
  first_date: 'an explicit, mutually understood date has now happened, not just a friendly hangout, chance encounter, or a gift given in passing',
  confession: 'one of them stated real romantic feelings out loud, not just flirted or hinted',
  jealousy: 'clear jealousy or possessiveness was shown over a rival or another relationship',
  promise: 'a specific, meaningful promise was made that the story should remember later',
  first_kiss: 'they actually kissed — lips meeting mouth, forehead, cheek, hand, or anywhere else — not just closeness, a lingering look, or an almost-kiss that did not quite happen',
}

/** Flags a hangout can never establish — withheld from its classifier menu and stripped if the model sets one anyway. Built-ins only. */
const DATE_ONLY_FLAGS: ReadonlySet<SceneFlag> = new Set<SceneFlag>(['first_date'])

const NO_EXCLUSIONS: ReadonlySet<SceneFlag> = new Set<SceneFlag>()

/** Flags allowed for this scene kind; only a hangout narrows the set. */
function excludedFlagsFor(sceneKind?: 'date' | 'hangout'): ReadonlySet<SceneFlag> {
  return sceneKind === 'hangout' ? DATE_ONLY_FLAGS : NO_EXCLUSIONS
}

/** Formats built-in + world-authored flags with their glossary/description text for the prompt. */
function describeFlags(customFlags?: CustomSceneFlag[], exclude: ReadonlySet<SceneFlag> = NO_EXCLUSIONS): string {
  const builtIn = SCENE_FLAGS.filter((f) => !exclude.has(f)).map((f) => `${f} (${FLAG_GLOSSARY[f]})`)
  const custom = (customFlags ?? []).map((f) => `${f.id} (${f.description})`)
  return [...builtIn, ...custom].join('; ')
}

function allowedFlagIds(customFlags?: CustomSceneFlag[], exclude: ReadonlySet<SceneFlag> = NO_EXCLUSIONS): Set<string> {
  return new Set([...SCENE_FLAGS.filter((f) => !exclude.has(f)), ...(customFlags ?? []).map((f) => f.id)])
}

const ZERO_DELTAS: RelationshipDeltas = Object.fromEntries(DELTA_KEYS.map((k) => [k, 0])) as RelationshipDeltas

/** Global scale on how far relationship consequences swing — never what a character says or how a scene opens. */
export type RelationshipDifficulty = 'gentle' | 'normal' | 'harsh'

const DIFFICULTY_MULTIPLIERS: Record<RelationshipDifficulty, number> = {
  gentle: 0.6,
  normal: 1,
  harsh: 1.6,
}

/** Scales judge-returned deltas by difficulty before adding to running totals; prompts stay difficulty-agnostic. */
export function scaleDeltasForDifficulty(deltas: RelationshipDeltas, difficulty: RelationshipDifficulty): RelationshipDeltas {
  const factor = DIFFICULTY_MULTIPLIERS[difficulty]
  if (factor === 1) return deltas
  return Object.fromEntries(DELTA_KEYS.map((k) => [k, Math.round(deltas[k] * factor)])) as RelationshipDeltas
}

/** Diminishing returns for repeating the same move: scales down positive warmth deltas, leaves negative deltas, tension, and curiosity untouched. */
export function dampenRepeatedDeltas(deltas: RelationshipDeltas): RelationshipDeltas {
  const out = { ...deltas }
  for (const k of ['affection', 'trust', 'chemistry', 'comfort', 'respect'] as const) {
    if (out[k] > 0) out[k] = Math.round(out[k] * 0.4)
  }
  return out
}

/** A durable memory plus its emotional colouring, so a later callback can key off feel, not just prose. */
export interface RememberedFact {
  text: string
  /** 0-1: long-term weight. */
  importance: number
  /** -1..1: how it landed for the character. */
  valence: number
  /** An open thread the story hasn't closed. */
  unresolved: boolean
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0)

/** Parses `newFacts` in either the plain-string or richer object form; a bare string gets neutral defaults. */
export function parseRememberedFacts(raw: unknown): RememberedFact[] {
  if (!Array.isArray(raw)) return []
  const out: RememberedFact[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const text = entry.trim().slice(0, 200)
      if (text) out.push({ text, importance: 0.5, valence: 0, unresolved: false })
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    const text = typeof o.text === 'string' ? o.text.trim().slice(0, 200) : ''
    if (!text) continue
    out.push({
      text,
      importance: clamp(Number(o.importance ?? 0.5), 0, 1),
      valence: clamp(Number(o.valence ?? 0), -1, 1),
      unresolved: o.unresolved === true,
    })
  }
  return out
}

export interface RelationshipMoment {
  deltas: RelationshipDeltas
  newFlags: SceneFlag[]
  /** Short one-line reason for whatever moved, e.g. "Complimented her cooking unprompted" — undefined when nothing moved. */
  reason?: string
  /** New durable facts, each with its emotional colouring — `[]` most turns. */
  newFacts: RememberedFact[]
  /** Indices into `params.unresolvedFacts` this exchange clearly closed (an apology landed, a promise was kept). `[]` when none were passed or none closed. */
  resolvedFactIndices: number[]
  /** Indices into `pendingTasks` this exchange clearly completed. `[]` when `pendingTasks` wasn't passed. */
  completedTaskIndices: number[]
  /** Post-intimacy window verdict (`dating/aftercare.ts`), only present when the caller passed `aftercareTurns`. */
  aftercareVerdict?: AftercareVerdict
  /** "Character Mind" scoped slice — see `prompt/mindGuidance.ts`. Undefined means no clear shift this turn, not "neutral". */
  mood?: CharacterMood
  currentNeed?: CharacterNeed
  characterIntent?: string
  /** Changes to the character's persistent agency layer (`dating/plans.ts`). `[]` on most turns. `note`/`resolve` indices point into `activePlans`. */
  planUpdates: PlanUpdate[]
  /** Bounded per-turn read of an active intimacy scene (`dating/intimacyScene.ts`), only present when the caller passed `currentIntimacyPhase`. The engine, not this, decides what the scene does with it; `undefined` = nothing usable came back. */
  intimacyObservation?: IntimacyTurnObservation
  /** Changes to standing impressions of {{user}} (`dating/beliefs.ts`). `[]` on most turns. `revise`/`drop` indices point into `activeBeliefs`. */
  beliefUpdates: BeliefUpdate[]
  /** Changes to standing expectations of {{user}} (`dating/expectations.ts`). `[]` on most turns. `note`/`resolve` indices point into `activeExpectations`. */
  expectationUpdates: ExpectationUpdate[]
  /** See `prompt/mindGuidance.ts`'s `fearGuidance` — sticky like `mood`/`currentNeed`/`characterIntent`; undefined means no change this turn. */
  currentFear?: string
  /** See `prompt/mindGuidance.ts`'s `desireGuidance` — the want-axis counterpart to `currentNeed`, sticky the same way; undefined means no change this turn. */
  currentDesire?: string
}

/**
 * Conservative classifier estimating whether the latest exchange moved relationship tone (seven
 * dimensions), established any romance-route flags, and surfaced any durable fact — combined into
 * one call, since every background classifier call is serialized behind the model on a local
 * server and this one fires every turn. Most dimensions/flags/facts stay unchanged on most turns.
 * `pendingTasks`, when passed, folds `objectiveAssist.ts`'s task-completion check in too.
 */
export async function assessRelationshipMoment(
  client: ChatBackend,
  params: {
    history: ChatMessage[]
    latestReply: string
    charName: string
    userName: string
    current: RelationshipDeltas
    /** Facts already known, so the model doesn't re-extract the same thing every turn. */
    knownFacts?: string[]
    /** Currently-unresolved facts, in index order — the judge can mark one closed via `resolvedFactIndices`. */
    unresolvedFacts?: string[]
    /** Persistent plans (`dating/plans.ts`), pre-formatted one per line, in index order — the judge annotates/closes one by index, and can always add new ones. */
    activePlans?: string[]
    /** World-authored flags beyond the 4 built-in defaults — glossaried and validated like the built-ins. */
    customFlags?: CustomSceneFlag[]
    /** How the player tagged their most recent line — interpretation context, not a direct stat move. */
    intent?: string
    /** Pending objective task descriptions, in index order — only passed when task-detection is also due this turn. */
    pendingTasks?: string[]
    /** Transcript of the post-intimacy window, passed only on the turn it closes — rides along at no extra model cost. */
    aftercareTurns?: ChatMessage[]
    /** Mood/need/intention going into this exchange, so the classifier judges whether anything genuinely shifted. See `prompt/mindGuidance.ts`. */
    currentMood?: CharacterMood
    currentNeed?: CharacterNeed
    currentIntent?: string
    /** Intimacy scene state (`dating/intimacyScene.ts`), passed only while a scene is active — context for the turn observation the judge is asked for, never a value it gets to set. */
    currentIntimacyPhase?: IntimacyPhase
    /** How the character feels about the active content (`dating/kinks.ts`), passed alongside the scene. Context for the hesitation read only — the engine never sets that field itself. */
    intimacyStance?: 'reluctant' | 'eager'
    /** Standing impressions of {{user}} (`dating/beliefs.ts`), pre-formatted one per line, in index order — the judge revises/drops one by index, and can add new ones. */
    activeBeliefs?: string[]
    /** Standing expectations of {{user}} (`dating/expectations.ts`), pre-formatted one per line, in index order — the judge annotates/resolves one by index. */
    activeExpectations?: string[]
    /** Current private fear, if read — see `prompt/mindGuidance.ts`'s `fearGuidance`. */
    currentFear?: string
    /** Current underlying desire, if read — see `prompt/mindGuidance.ts`'s `desireGuidance`. */
    currentDesire?: string
    /** "Earned vs. rushed" read (`aftercarePaceContext`), passed only alongside `aftercareTurns` — extra context, never a replacement for the judge's own read. */
    aftercarePaceContext?: AftercarePace
    /** Names of anyone else present and speaking in this scene, so the jealousy flag classifier can weigh a rival's live presence. Omit for an ordinary single-character chat. */
    presentParticipants?: string[]
    /**
     * Everyone in the *intimate scene*, when more than one character is (`sceneParticipants.ts`) —
     * distinct from `presentParticipants`, which is merely who else is in the room. Only when this
     * is set does the two-party `regionsTouched`/`clothingRemoved` read become ambiguous, so only
     * then is the contact graph asked for.
     */
    sceneParticipants?: { id: string; name: string }[]
  },
): Promise<RelationshipMoment> {
  const hasTasks = !!params.pendingTasks?.length
  const hasAftercare = !!params.aftercareTurns?.length
  const hasOpenThreads = !!params.unresolvedFacts?.length
  const hasPlans = !!params.activePlans?.length
  const hasIntimacyScene = !!params.currentIntimacyPhase
  const hasBeliefs = !!params.activeBeliefs?.length
  const hasExpectations = !!params.activeExpectations?.length
  const hasOthersPresent = !!params.presentParticipants?.length
  const hasSharedScene = hasIntimacyScene && (params.sceneParticipants?.length ?? 0) > 1
  /** How the judge names each side of a contact edge — character ids, plus the reserved player token. */
  const contactActors = hasSharedScene
    ? [...params.sceneParticipants!.map((p) => `"${p.id}" for ${p.name}`), `"${SCENE_PLAYER}" for ${params.userName}`].join(', ')
    : ''
  const prompt = [
    'You are scoring relationship momentum, tracking high-level romance route flags, noting durable facts worth remembering long-term, AND (separately) reading the character\'s own current emotional state, an underlying need, and private intentions, in an in-character roleplay.',
    `Current scores (0-100 each): ${DELTA_KEYS.map((k) => `${k}=${params.current[k]}`).join(', ')}.`,
    `Recent context:\n${recentText(params.history, params.charName, params.userName, 8)}`,
    `Latest reply from ${params.charName}:\n${params.latestReply}`,
    `Dimension meanings: ${DELTA_KEYS.map((k) => `${k} = ${DIMENSION_GLOSSARY[k]}`).join('; ')}.`,
    `Known route flags: ${describeFlags(params.customFlags)}.`,
    hasOthersPresent
      ? `Also actually present and speaking in this scene right now: ${params.presentParticipants!.join(', ')}. If jealousy is genuinely building, someone else being physically here for it to happen in front of is a stronger, more concrete signal than the same feeling from a conversation or a memory alone — weigh that when deciding whether "jealousy" is established this exchange.`
      : '',
    substituteMacros(describeIntentForJudge(params.intent) ?? '', { charName: params.charName, userName: params.userName }),
    params.knownFacts?.length ? `Facts already remembered (don't repeat these): ${params.knownFacts.join('; ')}.` : '',
    hasOpenThreads
      ? `Open threads still unresolved (something between them the story hasn't closed):\n${params.unresolvedFacts!.map((f, i) => `${i}: ${f}`).join('\n')}`
      : '',
    hasTasks ? `Pending objective tasks:\n${params.pendingTasks!.map((t, i) => `${i}: ${t}`).join('\n')}` : '',
    hasAftercare
      ? `Separately: ${params.charName} and ${params.userName} were intimate a few turns ago, and you are also judging how the time SINCE went for ${params.charName} — the aftermath, not the act. Everything said since:\n${recentText(params.aftercareTurns!, params.charName, params.userName, 24)}`
      : '',
    hasAftercare && params.aftercarePaceContext
      ? params.aftercarePaceContext === 'rushed'
        ? `Context for the aftercare verdict only: this arrived fast — either the scene itself was over almost as soon as it started, or the warmth that led there spiked right beforehand rather than accumulating over many turns. A milestone that arrived this fast is more plausibly followed by second-guessing, self-consciousness, or a colder reaction than one that was clearly earned — weigh that honestly, though the actual behaviour in the turns since should still be what decides the verdict.`
        : `Context for the aftercare verdict only: this was earned — the scene took its time, and the warmth that led there built up over many small moments rather than spiking. That's the more solid foundation for a genuinely tender aftermath, though it's still the actual behaviour in the turns since that should decide the verdict.`
      : '',
    hasIntimacyScene
      ? `Separately: an explicit intimate scene is currently in progress (the app currently has it at "${params.currentIntimacyPhase}"). Report what the latest reply actually did, in the "intimacyObservation" fields below — you are describing the turn, not deciding where the scene goes next.${
          params.intimacyStance === 'reluctant'
            ? ` Worth knowing while you read it: this is something ${params.charName} is not actually into, so a hesitation, a pause, or going along with it rather than wanting it is likely to be genuinely present in the reply — look for it rather than assuming enthusiasm.`
            : params.intimacyStance === 'eager'
              ? ` Worth knowing while you read it: this is something ${params.charName} is genuinely eager for, so hesitation is less likely to be what's actually on the page — read what's there rather than assuming reluctance.`
              : ''
        }`
      : '',
    `${params.charName}'s mood going into this exchange: ${params.currentMood ?? 'not yet read'}. Their underlying need lately: ${params.currentNeed ?? 'not yet read'}. Their private intention going in: ${params.currentIntent ?? 'none noted'}. Their deeper underlying desire going in: ${params.currentDesire ?? 'not yet read'}. Their private fear going in: ${params.currentFear ?? 'none noted'}.`,
    hasPlans
      ? `${params.charName}'s current standing plans — concrete intentions they're carrying between turns, not just this-turn reactions:\n${params.activePlans!.map((p, i) => `${i}: ${p}`).join('\n')}`
      : `${params.charName} has no standing plans on record yet.`,
    hasBeliefs
      ? `${params.charName}'s standing impressions of ${params.userName} as a person — not the relationship stats, an actual judgment of who ${params.userName} is:\n${params.activeBeliefs!.map((b, i) => `${i}: ${b}`).join('\n')}`
      : `${params.charName} hasn't formed any standing impressions of ${params.userName} yet.`,
    hasExpectations
      ? `${params.charName}'s standing expectations of ${params.userName} — things ${params.charName} has started counting on, whether or not ${params.userName} knows it:\n${params.activeExpectations!.map((e, i) => `${i}: ${e}`).join('\n')}`
      : `${params.charName} has no standing expectations of ${params.userName} on record yet.`,
    `Return ONLY a minified JSON object: {"deltas":{ one integer -2..2 per dimension key },"newFlags":[ any newly-established flags from the known set, or [] ],"reason":"...","newFacts":[ any new durable facts, or [] ]${hasOpenThreads ? ',"resolvedFactIndices":[ open-thread index numbers this exchange clearly closed, or [] ]' : ''}${hasTasks ? ',"completedTaskIndices":[ pending task index numbers this exchange clearly and unambiguously accomplished, or [] ]' : ''}${hasAftercare ? `,"aftercareVerdict":"exactly one of [${AFTERCARE_VERDICTS.join(', ')}]"` : ''}${hasIntimacyScene ? `,"intimacyObservation":{"engagement":"one of [engaged, stalled, drifted]","intensityDelta":-1|0|1|2,"hesitationSignalled":true/false,"stageCompleteSignalled":true/false,"regionsTouched":[ zero or more of the region names listed below ],"clothingRemoved":[ zero or more {"who":"char"|"user","layer":"one of the layer names listed below"} ]${hasSharedScene ? ',"contact":[ zero or more {"actor":"...","target":"...","region":"..."} ],"participantClothingRemoved":[ zero or more {"who":"a character id","layer":"..."} ]' : ''}}` : ''},"mood":"one of [${MOOD_VOCAB.join(', ')}], only if this exchange gives a clear enough read to state one — omit entirely otherwise","currentNeed":"one of [${NEED_VOCAB.join(', ')}], only if this stretch of the story clearly shows this need going unmet — omit entirely otherwise, and don't change it lightly","characterIntent":"a short (under 12 words) private thing ${params.charName} now wants, only if something concrete and new became clear this exchange — omit entirely otherwise","currentDesire":"a short (under 12 words) deeper, steadier underlying drive of ${params.charName}'s, only if this exchange makes one genuinely clear — omit entirely otherwise, and don't change it lightly","currentFear":"a short (under 12 words) private fear ${params.charName} has right now, only if this exchange makes one genuinely clear — omit entirely otherwise, and don't change it lightly","planUpdates":[ usually [] — see the plan rules below ],"beliefUpdates":[ usually [] — see the belief rules below ],"expectationUpdates":[ usually [] — see the expectation rules below ]}.`,
    'Only move a dimension if this specific exchange clearly affected it. Leave the rest at 0. Most turns should move only one or two dimensions and add no new flags.',
    '"reason" is a short (under 12 words) in-world one-liner naming what just happened, e.g. "Complimented their cooking unprompted". Give one only if at least one dimension moved or a flag was added, otherwise "".',
    `"newFacts" is for concrete, durable things worth recalling much later: a name, a stated preference, a piece of backstory, a promise made, a moment that landed hard. Not every line of dialogue. Most turns add none. Each fact is an object {"text": one short standalone sentence, "importance": 0-1, "valence": -1 to 1, "unresolved": true/false}. "importance": ~0.2 for a small detail, 0.8+ for something that reshapes how ${params.charName} sees ${params.userName}. "valence": how it felt to ${params.charName} — negative if it hurt or disappointed, positive if it meant a lot, 0 for neutral information. "unresolved": true only for an open wound or open question the story has NOT closed (a slight not addressed, a promise not yet kept, a question dodged) — most facts are false.`,
    hasOpenThreads
      ? '"resolvedFactIndices" lists open-thread indices from the list above that this exchange clearly closed — an apology that landed, a promise kept, a dodged question finally answered. Be conservative: [] unless it plainly happened this turn.'
      : '',
    `"mood" is ${params.charName}'s own transient emotional state right now, independent of the relationship dimensions above — a close, trusted relationship can still have an "annoyed" or "exhausted" day. Omit it on most turns; only state one when this exchange actually gave a clear signal, and don't just repeat the current mood back for no reason.`,
    `"currentNeed" is steadier than mood — a psychological undercurrent this stretch of the story hasn't been meeting (e.g. "reassurance" after being flaky, "recognition" after going unnoticed, "solitude" after being crowded). Omit it almost every turn; it shouldn't flip as readily as mood does, and should only be set or changed on a genuinely clear, sustained signal, not one line of dialogue.`,
    `"characterIntent" is a private thing ${params.charName} wants that the player hasn't necessarily been told — a small hidden agenda that can quietly color future turns (wanting reassurance, wanting space, planning a surprise, wanting an apology first). Omit it on almost every turn; once set it should usually stay omitted (meaning "no change") for a while rather than being reset every exchange.`,
    `"currentDesire" is deeper and steadier than "characterIntent" the same way "currentNeed" is deeper and steadier than "mood" — not a specific plan or agenda item, but a foundational underlying drive that doesn't change turn to turn (e.g. "wants to feel truly seen, not just liked", "wants to matter to someone again", "wants to be the one chosen, not settled for"). Omit it on almost every turn; once set it should stay omitted (meaning "no change") for a long while, longer even than "characterIntent" does.`,
    `"planUpdates" changes ${params.charName}'s standing plans — bigger and longer-lived than "characterIntent": a real intention that spans many turns and can be entirely about ${params.charName}'s own life. Each entry is one of: {"action":"add","goal":"short, in ${params.charName}'s own terms","kind":"personal"|"together"|"distance","note":"optional"} to form a new one; {"action":"note","index":N,"note":"..."} to record progress or a setback on plan N; {"action":"resolve","index":N} to close plan N (finished, abandoned, or overtaken by events). "personal" = ${params.charName}'s own life independent of ${params.userName}; "together" = something they want to do with ${params.userName}; "distance" = deliberately holding back or protecting themselves. Use [] on almost every turn. Only "add" when this exchange genuinely gave ${params.charName} a new reason to want something lasting — a plan formed on a whim and never mentioned again is noise. Resolve a plan the moment the story has clearly moved past it.`,
    `"beliefUpdates" changes ${params.charName}'s standing impressions of ${params.userName} as a person — a judgment about who ${params.userName} *is*, not a one-off event (that's "newFacts") and not a relationship stat. Each entry is one of: {"action":"add","text":"the impression in ${params.charName}'s own voice, e.g. 'They're unusually patient with me.'"} to form a new one; {"action":"revise","index":N,"text":"..."} to correct or sharpen belief N once it's proven wrong or too simple; {"action":"drop","index":N} to abandon one that's been clearly disproven. Use [] on almost every turn — only add one when this exchange gives real, repeated-pattern evidence, not from a single isolated moment.`,
    `"expectationUpdates" changes ${params.charName}'s standing expectations of ${params.userName} — something ${params.charName} has started quietly counting on, whether or not ${params.userName} has ever been told. Each entry is one of: {"action":"add","text":"the expectation, e.g. 'expects a check-in most Sundays'"}; {"action":"note","index":N,"note":"..."} to record it playing out; {"action":"resolve","index":N,"outcome":"met"|"violated"} once it's clearly been met or clearly been missed. Use [] on almost every turn. "violated" should be reserved for a real, noticeable letdown, not a trivial miss.`,
    hasAftercare
      ? `"aftercareVerdict" judges only how ${params.userName} treated ${params.charName} in the turns since they were intimate. "tender" = stayed present and warm, gave reassurance or closeness, took ${params.charName} seriously. "cold" = pulled away, went distant or dismissive, changed the subject, or acted as if it had not happened. "awkward" = anything in between, including a fumbled or self-conscious aftermath that was still well meant. Judge ${params.userName}'s behaviour, not ${params.charName}'s, and not whether the intimacy itself went well. Most aftermaths are "awkward" — reserve "cold" for a real, visible withdrawal, not merely for a quiet stretch.`
      : '',
    hasTasks
      ? 'Be conservative about "completedTaskIndices": only include a task index if this exchange plainly and unambiguously accomplished it, not if it merely became more likely. Use [] if none did.'
      : '',
    hasIntimacyScene
      ? `"intimacyObservation" describes only what this one reply did — every field is an observation about the text in front of you, never a judgement about where the scene should go. "engagement": "engaged" if the reply actually carried the current physical activity forward; "stalled" if it went nowhere (talk, hesitation, repeating the previous beat); "drifted" if it moved to something else entirely. "intensityDelta": -1 if this reply pulled back from the previous one, 0 if it held level, 1 for a normal step up, 2 only for a large, unmistakable escalation. "hesitationSignalled": true if either of them paused, checked in, or visibly held back. "stageCompleteSignalled": true only if this reply narrated the scene actually finishing — not merely nearing it. "regionsTouched": the regions this reply described contact with, drawn only from [${BODY_REGIONS.join(', ')}], or [] if none were described. "clothingRemoved": anything this reply described actually coming off, as {"who":"char" for ${params.charName} or "user" for ${params.userName}, "layer": one of [${CLOTHING_LAYERS.join(', ')}]} — only garments removed in THIS reply, not ones already off, and [] on most turns.${
          hasSharedScene
            ? ` More than one character is in this scene, so "regionsTouched" can no longer say whose body it means: leave it empty and describe every contact in "contact" instead, including ${params.charName}'s own. "contact": every contact this reply described, as {"actor","target","region"} where actor and target are each one of [${contactActors}] and region is one of the region names listed above — describe contact that is *currently happening*, not something that ended, since the app carries this forward as what is still true. Omit a contact rather than guessing at one. "participantClothingRemoved": anything coming off, as {"who":"a character id from the list above","layer":"..."} — the same THIS-reply-only rule.`
            : ''
        }`
      : '',
    `Example (nothing much happened): {"deltas":{"affection":1,"trust":0,"chemistry":0,"comfort":1,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"Stayed to help clean up without being asked","newFacts":[]${hasOpenThreads ? ',"resolvedFactIndices":[]' : ''}${hasTasks ? ',"completedTaskIndices":[]' : ''},"planUpdates":[],"beliefUpdates":[],"expectationUpdates":[]}`,
    `Example (a fact landed hard): {"deltas":{"affection":-2,"trust":-1,"chemistry":0,"comfort":-1,"respect":0,"curiosity":0,"tension":2},"newFlags":[],"reason":"Forgot their birthday entirely","newFacts":[{"text":"Forgot ${params.charName}'s birthday","importance":0.75,"valence":-0.7,"unresolved":true}]${hasOpenThreads ? ',"resolvedFactIndices":[]' : ''}${hasTasks ? ',"completedTaskIndices":[]' : ''},"planUpdates":[],"beliefUpdates":[],"expectationUpdates":[]}`,
    `Example (a plan forms — ${params.charName} decides on something lasting): {"deltas":{"affection":0,"trust":1,"chemistry":0,"comfort":0,"respect":1,"curiosity":0,"tension":0},"newFlags":[],"reason":"Opened up about the gallery showcase deadline","newFacts":[]${hasOpenThreads ? ',"resolvedFactIndices":[]' : ''}${hasTasks ? ',"completedTaskIndices":[]' : ''},"planUpdates":[{"action":"add","goal":"finish the mural before the showcase","kind":"personal","note":"three weeks out, behind on it"}],"beliefUpdates":[],"expectationUpdates":[]}`,
    `Example (a pattern becomes a real impression, and an expectation is broken): {"deltas":{"affection":-1,"trust":0,"chemistry":0,"comfort":-1,"respect":0,"curiosity":0,"tension":1},"newFlags":[],"reason":"Third Sunday in a row with no check-in","newFacts":[]${hasOpenThreads ? ',"resolvedFactIndices":[]' : ''}${hasTasks ? ',"completedTaskIndices":[]' : ''},"planUpdates":[],"beliefUpdates":[{"action":"add","text":"They mean well but tend to go quiet when things get busy for them."}],"expectationUpdates":[{"action":"resolve","index":0,"outcome":"violated"}]}`,
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await generateWithTimeout(
    client,
    { ...REL_PARAMS, ...(client.prefersJsonObject ? { jsonOutput: true } : {}), max_length: 380, max_context_length: await client.getEffectiveMaxContext(), prompt },
    'Relationship check-in',
  )
  const parsed = parseLenientJson(text)
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const deltasObj = (obj.deltas && typeof obj.deltas === 'object' ? obj.deltas : {}) as Record<string, unknown>
  const deltas = { ...ZERO_DELTAS }
  for (const key of DELTA_KEYS) {
    const v = Number(deltasObj[key])
    deltas[key] = [-2, -1, 0, 1, 2].includes(v) ? v : 0
  }
  const allowed = allowedFlagIds(params.customFlags)
  const newFlags = Array.isArray(obj.newFlags)
    ? obj.newFlags.filter((f): f is SceneFlag => typeof f === 'string' && allowed.has(f))
    : []
  const reason = typeof obj.reason === 'string' && obj.reason.trim() ? obj.reason.trim().slice(0, 160) : undefined
  const newFacts = parseRememberedFacts(obj.newFacts)
  const pendingCount = params.pendingTasks?.length ?? 0
  const completedTaskIndices =
    hasTasks && Array.isArray(obj.completedTaskIndices)
      ? obj.completedTaskIndices.filter((i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < pendingCount)
      : []
  const openThreadCount = params.unresolvedFacts?.length ?? 0
  const resolvedFactIndices =
    hasOpenThreads && Array.isArray(obj.resolvedFactIndices)
      ? [
          ...new Set(
            obj.resolvedFactIndices.filter(
              (i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < openThreadCount,
            ),
          ),
        ]
      : []
  // Only trusted when actually asked for — a volunteered value is guessing about a window that isn't open.
  const aftercareVerdict = hasAftercare && isAftercareVerdict(obj.aftercareVerdict) ? obj.aftercareVerdict : undefined
  const mood = MOOD_VOCAB.includes(obj.mood as CharacterMood) ? (obj.mood as CharacterMood) : undefined
  const currentNeed = NEED_VOCAB.includes(obj.currentNeed as CharacterNeed) ? (obj.currentNeed as CharacterNeed) : undefined
  const characterIntent =
    typeof obj.characterIntent === 'string' && obj.characterIntent.trim() ? obj.characterIntent.trim().slice(0, 160) : undefined
  const currentFear =
    typeof obj.currentFear === 'string' && obj.currentFear.trim() ? obj.currentFear.trim().slice(0, 160) : undefined
  const currentDesire =
    typeof obj.currentDesire === 'string' && obj.currentDesire.trim() ? obj.currentDesire.trim().slice(0, 160) : undefined
  // Stale indices past what was actually passed in are dropped, so a model miscount can't rewrite/delete the wrong plan.
  const planCount = params.activePlans?.length ?? 0
  const planUpdates = parsePlanUpdates(obj.planUpdates).filter(
    (u) => u.action === 'add' || u.index < planCount,
  )
  const beliefCount = params.activeBeliefs?.length ?? 0
  const beliefUpdates = parseBeliefUpdates(obj.beliefUpdates).filter((u) => u.action === 'add' || u.index < beliefCount)
  const expectationCount = params.activeExpectations?.length ?? 0
  const expectationUpdates = parseExpectationUpdates(obj.expectationUpdates).filter(
    (u) => u.action === 'add' || u.index < expectationCount,
  )
  // Same guard as `aftercareVerdict` above — a volunteered read of a scene that isn't open is guessing.
  const intimacyObservation = hasIntimacyScene ? parseIntimacyObservation(obj.intimacyObservation) : undefined
  return {
    deltas,
    newFlags,
    reason,
    newFacts,
    resolvedFactIndices,
    completedTaskIndices,
    aftercareVerdict,
    mood,
    currentNeed,
    characterIntent,
    planUpdates,
    intimacyObservation,
    beliefUpdates,
    expectationUpdates,
    currentFear,
    currentDesire,
  }
}

/** Checks whether any locked gallery entries seem to have been earned by the latest moment. */
export async function detectGalleryUnlocks(
  client: ChatBackend,
  params: {
    character: Character
    locked: { id: string; title: string; unlockAffection: number; unlockHint?: string }[]
    affection: number
    latestReply: string
  },
): Promise<string[]> {
  if (params.locked.length === 0) return []
  const candidates = params.locked
    .filter((g) => g.unlockAffection <= params.affection)
    .map((g) => `${g.id}: ${g.title}${g.unlockHint ? ` (${g.unlockHint})` : ''}`)
  if (candidates.length === 0) return []

  const prompt = [
    'You decide whether a roleplay beat unlocked gallery scenes.',
    `Character: ${params.character.card.name}`,
    `Latest reply:\n${params.latestReply}`,
    `Unlock candidates:\n${candidates.join('\n')}`,
    'Return ONLY a minified JSON array of ids that clearly match what just happened, or [] if none.',
    'JSON:',
  ].join('\n\n')

  const text = await generateWithTimeout(
    client,
    { ...REL_PARAMS, max_length: 120, max_context_length: await client.getEffectiveMaxContext(), prompt },
    'Gallery unlock check',
  )
  const parsed = parseLenientJson(text)
  if (!Array.isArray(parsed)) return []
  const valid = new Set(candidates.map((c) => c.slice(0, c.indexOf(':'))))
  return parsed.filter((id): id is string => typeof id === 'string' && valid.has(id))
}

export interface DateOutcome {
  deltas: RelationshipDeltas
  newFlags: SceneFlag[]
  /** A short (1-3 sentence) in-world recap of how the whole date went — shown to the player, unlike the terser per-turn `reason`. */
  recap: string
  newFacts: RememberedFact[]
}

/**
 * Turns an entire date's transcript into one outcome — deltas, new flags, a player-facing recap,
 * durable facts — instead of the per-turn drip-feed `assessRelationshipMoment` does for ordinary
 * chat. A live date suppresses normal per-turn tracking, so only this end-of-scene judgment counts.
 */
export async function assessDateOutcome(
  client: ChatBackend,
  params: {
    transcript: ChatMessage[]
    eventTitle: string
    charName: string
    userName: string
    current: RelationshipDeltas
    knownFacts?: string[]
    customFlags?: CustomSceneFlag[]
    /** The `MessageIntent`s the player deliberately played across the date, in order. */
    intents?: string[]
    /** What the character secretly wanted from this date (`DateEventCard.hiddenAgenda`) — never shown to the player. Never set for a hangout. */
    hiddenAgenda?: string
    /** Set when the date ended via a rapport-judge-flagged walkout, not the player choosing to end it — scored as an abrupt, negative exit. Only ever set for a date. */
    walkedOut?: boolean
    /** `'hangout'` is the lower-stakes sibling of `'date'` — same judge pass, gentler framing, modest deltas. Defaults to `'date'`. */
    sceneKind?: 'date' | 'hangout'
  },
): Promise<DateOutcome> {
  const isHangout = params.sceneKind === 'hangout'
  const sceneNoun = isHangout ? 'hangout' : 'date'
  const excludedFlags = excludedFlagsFor(params.sceneKind)
  // Cap at the last 24 turns to keep the prompt bounded; empty (still-streaming) messages dropped.
  const turns = params.transcript.filter((m) => m.text.trim()).slice(-24)
  const transcriptText = turns.map((m) => `${m.role === 'user' ? params.userName : params.charName}: ${m.text}`).join('\n')

  const prompt = [
    `You are scoring how an entire ${sceneNoun}/scene went, in an in-character roleplay: "${params.eventTitle}".`,
    isHangout
      ? `This is a low-stakes, casual hangout, not a formal date — no dramatic verdict is expected. Keep deltas modest and grounded in genuine warmth, comfort, and trust; reserve anything beyond a small movement for something that actually stood out.`
      : '',
    params.walkedOut
      ? `${params.charName} walked out and ended this early — this is NOT a normal ending. Judge it as a genuinely bad outcome: deltas should be negative on the dimensions this actually hurt, not a token positive bump just because the scene happened.`
      : '',
    `Current scores (0-100 each): ${DELTA_KEYS.map((k) => `${k}=${params.current[k]}`).join(', ')}.`,
    `Full transcript of the ${sceneNoun}:\n${transcriptText || '(nothing was said)'}`,
    `Dimension meanings: ${DELTA_KEYS.map((k) => `${k} = ${DIMENSION_GLOSSARY[k]}`).join('; ')}.`,
    `Known route flags: ${describeFlags(params.customFlags, excludedFlags)}.`,
    substituteMacros(describeIntentsForDate(params.intents ?? []) ?? '', { charName: params.charName, userName: params.userName }),
    params.hiddenAgenda
      ? `${params.charName} went into this secretly wanting: ${params.hiddenAgenda} (never told to the other person). Weigh whether the date actually met that, ignored it, or worked against it — but never name "agenda" or break the fourth wall in the recap.`
      : '',
    params.knownFacts?.length ? `Facts already remembered (don't repeat these): ${params.knownFacts.join('; ')}.` : '',
    'Return ONLY a minified JSON object: {"deltas":{ one integer -5..5 per dimension key, judged across the WHOLE scene, not per line },"newFlags":[ any newly-established flags from the known set, or [] ],"recap":"...","newFacts":[ any new durable facts, or [] ]}.',
    isHangout
      ? 'Judge it honestly but gently: an awkward or flat hangout can score near zero, but this almost never needs to go negative the way a bad date would — it takes a real, deliberate hurt to earn a negative delta here.'
      : 'Judge the date honestly: a flat, awkward, one-sided, or hurtful date should score low or even negative deltas, not a token positive bump just for happening. A genuinely warm, attentive date should score well across the relevant dimensions.',
    params.walkedOut
      ? '"recap" must read as the abrupt, in-world exit it was — a line or two on what made {{char}} leave, not a neutral summary.'
      : `"recap" is a short 1-3 sentence in-world summary of how the ${sceneNoun} felt from {{char}}'s side, written for the player to read afterward, not a mechanical report.`,
    '"newFacts" is for concrete, durable things worth recalling much later. Most scenes add one or none. Each is an object {"text": one short sentence, "importance": 0-1, "valence": -1 to 1 (how it felt to {{char}}), "unresolved": true only for an open thread the scene left hanging}.',
    isHangout
      ? 'Example: {"deltas":{"affection":1,"trust":2,"chemistry":0,"comfort":2,"respect":0,"curiosity":1,"tension":0},"newFlags":["promise"],"recap":"They talked about their old bakery for the first time, and made you swear to try their cinnamon rolls sometime.","newFacts":[{"text":"Used to run a small bakery before moving here","importance":0.6,"valence":0.3,"unresolved":false}]}'
      : 'Example: {"deltas":{"affection":3,"trust":2,"chemistry":2,"comfort":1,"respect":0,"curiosity":1,"tension":0},"newFlags":["first_date"],"recap":"They lit up talking about their old bakery and kept finding reasons to lean in closer.","newFacts":[{"text":"Used to run a small bakery before moving here","importance":0.6,"valence":0.3,"unresolved":false}]}',
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await generateWithTimeout(
    client,
    { ...REL_PARAMS, max_length: 420, max_context_length: await client.getEffectiveMaxContext(), prompt },
    'Date/hangout outcome',
  )
  const parsed = parseLenientJson(text)
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const deltasObj = (obj.deltas && typeof obj.deltas === 'object' ? obj.deltas : {}) as Record<string, unknown>
  const deltas = { ...ZERO_DELTAS }
  for (const key of DELTA_KEYS) {
    const v = Number(deltasObj[key])
    deltas[key] = Number.isInteger(v) ? Math.max(-5, Math.min(5, v)) : 0
  }
  // Re-checked here, not just omitted from the prompt — a model naming `first_date` anyway must not be able to set it.
  const allowed = allowedFlagIds(params.customFlags, excludedFlags)
  const newFlags = Array.isArray(obj.newFlags)
    ? obj.newFlags.filter((f): f is SceneFlag => typeof f === 'string' && allowed.has(f))
    : []
  const recap = typeof obj.recap === 'string' && obj.recap.trim() ? obj.recap.trim().slice(0, 400) : 'The date came to an end.'
  const newFacts = parseRememberedFacts(obj.newFacts)
  return { deltas, newFlags, recap, newFacts }
}

/** Suggests a themed event card that can be spun into an objective-driven scene. */
export async function suggestDateEvent(
  client: ChatBackend,
  params: {
    characterName: string
    characterDescription?: string
    personaName: string
    worldDescription?: string
    availableBackgrounds: string[]
    affection: number
    /** Where the two of them officially stand — without it, an established couple kept getting handed casual "hangout" cards, since affection alone can't distinguish "fond" from "actually together". */
    commitmentStatus?: CommitmentStatus
    /** Set only when drafting for one specific ladder-crossing occasion (a wedding, a moving-in day) right after `askForCommitment` sees that tier accepted. Forces the returned card's `kind` to `'date'` regardless of the model's answer, so the milestone always surfaces as a real live scene. */
    milestoneOccasion?: Extract<CommitmentStatus, 'married' | 'living_together'>
    /** Name of the most recent gift that genuinely landed (`dating/gifts.ts`), so a suggestion can plausibly build on it instead of being gift-blind. */
    recentGiftName?: string
  },
): Promise<DateEventCard | null> {
  const official = params.commitmentStatus && params.commitmentStatus !== 'none' ? params.commitmentStatus : null
  const occasionLine =
    params.milestoneOccasion === 'married'
      ? 'This card is specifically for the day they get married — draft their actual wedding (the ceremony, the vows, or the moments right around it), not a generic date or anniversary dinner. It should read as the real, once-in-a-relationship milestone it is.'
      : params.milestoneOccasion === 'living_together'
        ? 'This card is specifically for the day they move in together — draft the actual moving-in day itself (unpacking boxes, the first night in a shared home, making it feel real), not a generic date. It should read as the real, once-in-a-relationship milestone it is.'
        : ''
  const prompt = [
    'You design a lightweight dating-sim style event card for a roleplay chat.',
    `Character: ${params.characterName}${params.characterDescription ? `. ${params.characterDescription}` : ''}`,
    `User persona: ${params.personaName}`,
    params.worldDescription ? `World context: ${params.worldDescription}` : '',
    `Current affection: ${params.affection}/100`,
    occasionLine ||
      (official
        ? `They are already officially ${formatCommitmentStatus(official)}. Suggest something that fits a couple at that stage — an actual date, or something they'd plausibly do together now that it's established — rather than a tentative, getting-to-know-you outing.`
        : 'They are not officially together.'),
    params.recentGiftName
      ? `${params.characterName} was recently given something that genuinely meant something to them: ${params.recentGiftName}. If it fits naturally, the suggested event can plausibly build on or reference that (not force it) — e.g. a shared meal after a favorite-novel gift, or a place that connects to a gift's theme.`
      : '',
    `Available background ids: ${params.availableBackgrounds.join(', ')}`,
    'Return ONLY one minified JSON object:',
    '{"title":"...","description":"...","objectiveTitle":"...","objectiveDescription":"...","backgroundId":"...","kind":"date|hangout|gift|milestone"}',
    occasionLine
      ? 'This is a milestone occasion, so "kind" should be "date" — treat it as the real, live scene it is.'
      : '"date" is a real, romantically-charged date. "hangout" is a lower-stakes, casual get-together — friendly, no romantic stakes riding on it, fitting for earlier affection or a deliberately relaxed scene. Pick whichever actually fits the current relationship and mood.',
    'Make it plausible for the current affection level, with a clear scene objective.',
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await generateWithTimeout(
    client,
    { ...EVENT_PARAMS, max_context_length: await client.getEffectiveMaxContext(), prompt },
    'Event suggestion',
  )
  const parsed = parseLenientJson(text)
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  const title = typeof obj.title === 'string' ? obj.title.trim() : ''
  const objectiveTitle = typeof obj.objectiveTitle === 'string' ? obj.objectiveTitle.trim() : ''
  if (!title || !objectiveTitle) return null
  const backgroundId = typeof obj.backgroundId === 'string' ? obj.backgroundId.trim() : undefined
  return {
    id: `event-${Date.now()}`,
    title,
    description: typeof obj.description === 'string' ? obj.description.trim() : '',
    objectiveTitle,
    objectiveDescription: typeof obj.objectiveDescription === 'string' ? obj.objectiveDescription.trim() : '',
    backgroundId,
    // A milestone occasion never trusts the model's own `kind` choice — must always be a live scene.
    kind: params.milestoneOccasion ? 'date' : obj.kind === 'gift' || obj.kind === 'milestone' || obj.kind === 'hangout' ? obj.kind : 'date',
    affectionRequirement: params.affection,
  }
}

/** Drafts what a character secretly wants from a date, from their own card — never shown to the player, only fed back to `assessDateOutcome`. Returns null (not filler) if the card gives nothing to work with or the call fails. */
export async function draftHiddenAgenda(
  client: ChatBackend,
  params: {
    charName: string
    charPersonality?: string
    charGoals?: string[]
    charBoundaries?: string[]
    eventTitle: string
    warmthLabel: string
  },
): Promise<string | null> {
  const prompt = [
    `You are drafting a private, hidden motivation for ${params.charName} going into a scene: "${params.eventTitle}". This is NEVER shown to the other person — it is only used afterward to judge how the scene actually went for ${params.charName}.`,
    params.charPersonality ? `${params.charName}'s personality: ${params.charPersonality}` : '',
    params.charGoals?.length ? `${params.charName}'s goals: ${params.charGoals.join('; ')}` : '',
    params.charBoundaries?.length ? `${params.charName}'s boundaries: ${params.charBoundaries.join('; ')}` : '',
    `Where things currently stand between them: ${params.warmthLabel}.`,
    `What does ${params.charName} secretly want, need, or fear from this specific scene, given who they are? One thing, concrete and specific to their character — not a generic "wants to have a good time".`,
    'Return ONLY that one sentence, in third person, nothing else. No quotes, no preamble.',
    'Sentence:',
  ]
    .filter(Boolean)
    .join('\n\n')

  let text: string
  try {
    text = await generateWithTimeout(
      client,
      { ...REL_PARAMS, max_length: 60, max_context_length: await client.getEffectiveMaxContext(), prompt },
      'Hidden agenda draft',
    )
  } catch {
    return null
  }
  const trimmed = text.trim().replace(/^["']|["']$/g, '')
  return trimmed.length > 0 ? trimmed.slice(0, 200) : null
}

export interface CommitmentAskOutcome {
  decision: 'accept' | 'deflect' | 'backfire'
  /** One short in-character sentence explaining the reaction — shown to the player. */
  reason: string
  deltas: RelationshipDeltas
}

/** Judges a single Define-the-Relationship ask — reaching warmth only unlocks asking, never guarantees a yes. Accept, deflect (nothing damaged), or backfire (real cost), decided from the actual relationship texture. */
export async function assessCommitmentAsk(
  client: ChatBackend,
  params: {
    history: ChatMessage[]
    charName: string
    charPersonality?: string
    userName: string
    tierLabel: string
    currentStatusLabel: string
    current: RelationshipDeltas
  },
): Promise<CommitmentAskOutcome> {
  const recent = recentText(params.history, params.charName, params.userName, 10)
  const prompt = [
    `You are judging a single pivotal moment in an in-character roleplay: ${params.userName} has just asked ${params.charName} to move their relationship from "${params.currentStatusLabel}" to "${params.tierLabel}".`,
    `Current scores (0-100 each): ${DELTA_KEYS.map((k) => `${k}=${params.current[k]}`).join(', ')}.`,
    params.charPersonality ? `${params.charName}'s personality: ${params.charPersonality}` : '',
    `Recent conversation leading up to the ask:\n${recent || '(no prior conversation)'}`,
    'Decide how {{char}} genuinely reacts, in character. Never an automatic yes just because they were asked. Three possible outcomes:',
    '- "accept": they genuinely want this too, right now.',
    '- "deflect": not right now. Caught off guard, needs more time, or it feels premature, but nothing is damaged and asking again later is still possible.',
    '- "backfire": the timing or delivery was genuinely bad given how things have actually been going (asked too soon, mid-argument, or reads as presumptuous). This stings and costs something real.',
    'Return ONLY a minified JSON object: {"decision":"accept"|"deflect"|"backfire","reason":"one short in-character sentence explaining the reaction","deltas":{ one integer -3..3 per dimension key }}.',
    '"accept" should generally have positive deltas; "deflect" should stay close to neutral; "backfire" should have real negative deltas, not just zeros.',
    'Example: {"decision":"accept","reason":"They laugh and pull you into a hug. Of course they want that too.","deltas":{"affection":3,"trust":2,"chemistry":2,"comfort":1,"respect":1,"curiosity":0,"tension":-1}}',
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await generateWithTimeout(
    client,
    { ...REL_PARAMS, max_length: 260, max_context_length: await client.getEffectiveMaxContext(), prompt },
    'Commitment ask',
  )
  const parsed = parseLenientJson(text)
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const decision = obj.decision === 'accept' || obj.decision === 'backfire' ? obj.decision : 'deflect'
  const reason =
    typeof obj.reason === 'string' && obj.reason.trim() ? obj.reason.trim().slice(0, 300) : 'They need a moment to process this.'
  const deltasObj = (obj.deltas && typeof obj.deltas === 'object' ? obj.deltas : {}) as Record<string, unknown>
  const deltas = { ...ZERO_DELTAS }
  for (const key of DELTA_KEYS) {
    const v = Number(deltasObj[key])
    deltas[key] = Number.isInteger(v) ? Math.max(-3, Math.min(3, v)) : 0
  }
  return { decision, reason, deltas }
}

/** Judges a single "first time together" ask — a deliberate initiation, not just something the relationship-moment classifier might notice after the fact. Same three-outcome shape as `assessCommitmentAsk`. */
export async function assessIntimacyMilestone(
  client: ChatBackend,
  params: {
    history: ChatMessage[]
    charName: string
    charPersonality?: string
    userName: string
    current: RelationshipDeltas
  },
): Promise<CommitmentAskOutcome> {
  const recent = recentText(params.history, params.charName, params.userName, 10)
  const prompt = [
    `You are judging a single pivotal moment in an in-character roleplay: ${params.userName} has just initiated taking things all the way with ${params.charName} for the first time together.`,
    `Current scores (0-100 each): ${DELTA_KEYS.map((k) => `${k}=${params.current[k]}`).join(', ')}.`,
    params.charPersonality ? `${params.charName}'s personality: ${params.charPersonality}` : '',
    `Recent conversation leading up to this:\n${recent || '(no prior conversation)'}`,
    'Decide how {{char}} genuinely reacts, in character. Never an automatic yes just because it was initiated. Three possible outcomes:',
    '- "accept": they genuinely want this too, right now.',
    '- "deflect": not right now. Caught off guard, needs more time, or it feels premature, but nothing is damaged and this can come up again later.',
    '- "backfire": the timing or delivery was genuinely bad given how things have actually been going (asked too soon, mid-argument, or reads as presumptuous). This stings and costs something real.',
    'Return ONLY a minified JSON object: {"decision":"accept"|"deflect"|"backfire","reason":"one short in-character sentence explaining the reaction","deltas":{ one integer -3..3 per dimension key }}.',
    '"accept" should generally have positive deltas; "deflect" should stay close to neutral; "backfire" should have real negative deltas, not just zeros.',
    'Example: {"decision":"accept","reason":"They go still for a moment, then pull you closer instead of pulling away.","deltas":{"affection":3,"trust":2,"chemistry":3,"comfort":1,"respect":0,"curiosity":0,"tension":-1}}',
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await generateWithTimeout(
    client,
    { ...REL_PARAMS, max_length: 260, max_context_length: await client.getEffectiveMaxContext(), prompt },
    'Intimacy milestone ask',
  )
  const parsed = parseLenientJson(text)
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const decision = obj.decision === 'accept' || obj.decision === 'backfire' ? obj.decision : 'deflect'
  const reason =
    typeof obj.reason === 'string' && obj.reason.trim() ? obj.reason.trim().slice(0, 300) : 'They need a moment to process this.'
  const deltasObj = (obj.deltas && typeof obj.deltas === 'object' ? obj.deltas : {}) as Record<string, unknown>
  const deltas = { ...ZERO_DELTAS }
  for (const key of DELTA_KEYS) {
    const v = Number(deltasObj[key])
    deltas[key] = Number.isInteger(v) ? Math.max(-3, Math.min(3, v)) : 0
  }
  return { decision, reason, deltas }
}
