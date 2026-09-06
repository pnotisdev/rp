import type { ChatBackend } from '@/lib/api/chatBackend'
import type { GenerateRequest } from '@/lib/api/types'
import { parseLenientJson } from '@/lib/jsonRepair'
import type { Character } from '@/lib/characters/cardSpec'
import type { CommitmentStatus, CustomSceneFlag, DateEventCard, RelationshipDimension, SceneFlag } from '@/lib/types'
import type { ChatMessage } from '@/lib/prompt/builder'
import { formatCommitmentStatus, RELATIONSHIP_DIMENSIONS, SCENE_FLAGS } from '@/lib/dating/stage'
import { describeIntentForJudge, describeIntentsForDate } from '@/lib/dating/intent'
import { AFTERCARE_VERDICTS, isAftercareVerdict, type AftercareVerdict } from '@/lib/dating/aftercare'
import { MOOD_VOCAB, NEED_VOCAB, type CharacterMood, type CharacterNeed } from '@/lib/prompt/mindGuidance'
import { parsePlanUpdates, type PlanUpdate } from '@/lib/dating/plans'
import type { IntimacyPhase } from '@/lib/dating/intimacyScene'
import { parseBeliefUpdates, type BeliefUpdate } from '@/lib/dating/beliefs'
import { parseExpectationUpdates, type ExpectationUpdate } from '@/lib/dating/expectations'

// max_context_length is deliberately omitted here — every call site fetches the server's actual
// loaded context via `client.getEffectiveMaxContext()` instead of hardcoding a guess.
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

// None of this file's `client.generate` calls ever passed a `signal`, so a slow or hanging
// provider response (confirmed live against a rate-limited free OpenRouter model: a request that
// simply never resolved) left the *caller* stuck forever too — worst-observed case was "End
// hangout"/"End date", whose button reads "Ending…" with no way to cancel or retry, because
// `endDateEvent` awaits `assessDateOutcome` directly and its promise never settles either way.
// Every one of this file's assist calls shares the same shape (build prompt, `generate`, parse),
// so the fix lives once, here: race the call against a timeout that aborts the underlying request
// (via the `signal` every backend's `generate` already accepts) and rejects with a message the
// caller's existing catch/toastError path already knows how to surface.
// Exported for `relationshipAssist.test.ts` — every other symbol here is a small pure helper this
// file uses internally, but this one has real timing behavior worth locking in directly rather
// than only indirectly through whichever exported function happens to call it.
export const ASSIST_TIMEOUT_MS = 45_000

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

/**
 * Bare flag names with no definition invited false positives (e.g. "first_date" firing for an
 * ordinary friendly hangout with a small gift, nothing either party understood as a date) — one
 * short line per flag gives the classifier an actual bar to clear instead of guessing from the name.
 */
const FLAG_GLOSSARY: Record<SceneFlag, string> = {
  first_date: 'an explicit, mutually understood date has now happened, not just a friendly hangout, chance encounter, or a gift given in passing',
  confession: 'one of them stated real romantic feelings out loud, not just flirted or hinted',
  jealousy: 'clear jealousy or possessiveness was shown over a rival or another relationship',
  promise: 'a specific, meaningful promise was made that the story should remember later',
  first_kiss: 'they actually kissed — lips meeting mouth, forehead, cheek, hand, or anywhere else — not just closeness, a lingering look, or an almost-kiss that did not quite happen',
}

/**
 * Flags a hangout structurally cannot establish, no matter how the scene goes. `first_date`'s own
 * glossary line above already spells out that a friendly hangout doesn't qualify, and it fired on
 * a scene explicitly started and scored as a hangout anyway — a prose bar is a request, not a
 * gate, and this app's whole design premise is that outcomes are judged by the model but *applied*
 * deterministically. So the flag is withheld from the classifier's menu for a hangout and dropped
 * on the way back in if it shows up regardless.
 *
 * Built-ins only. A world's own `CustomSceneFlag`s have no date/hangout marker to key off (see
 * `CustomSceneFlag` in `types.ts`), so they keep relying on their `description` the way they
 * always have — adding a per-flag "dates only" switch is a world-editor change, not this one.
 */
const DATE_ONLY_FLAGS: ReadonlySet<SceneFlag> = new Set<SceneFlag>(['first_date'])

const NO_EXCLUSIONS: ReadonlySet<SceneFlag> = new Set<SceneFlag>()

/** The flags a scene of this kind is allowed to establish. `undefined` (an ordinary chat turn or an unspecified scene) means "all of them" — only a hangout narrows the set. */
function excludedFlagsFor(sceneKind?: 'date' | 'hangout'): ReadonlySet<SceneFlag> {
  return sceneKind === 'hangout' ? DATE_ONLY_FLAGS : NO_EXCLUSIONS
}

/** World-authored flags (see `CustomSceneFlag`) get the same glossary treatment as the built-in 4 — their own `description` is the classifier's bar for firing, same idea as `FLAG_GLOSSARY`. */
function describeFlags(customFlags?: CustomSceneFlag[], exclude: ReadonlySet<SceneFlag> = NO_EXCLUSIONS): string {
  const builtIn = SCENE_FLAGS.filter((f) => !exclude.has(f)).map((f) => `${f} (${FLAG_GLOSSARY[f]})`)
  const custom = (customFlags ?? []).map((f) => `${f.id} (${f.description})`)
  return [...builtIn, ...custom].join('; ')
}

function allowedFlagIds(customFlags?: CustomSceneFlag[], exclude: ReadonlySet<SceneFlag> = NO_EXCLUSIONS): Set<string> {
  return new Set([...SCENE_FLAGS.filter((f) => !exclude.has(f)), ...(customFlags ?? []).map((f) => f.id)])
}

const ZERO_DELTAS: RelationshipDeltas = Object.fromEntries(DELTA_KEYS.map((k) => [k, 0])) as RelationshipDeltas

/** Gentle/Normal/Harsh — a global scale on how far consequences swing (10b), never what a character says or how a scene opens. */
export type RelationshipDifficulty = 'gentle' | 'normal' | 'harsh'

const DIFFICULTY_MULTIPLIERS: Record<RelationshipDifficulty, number> = {
  gentle: 0.6,
  normal: 1,
  harsh: 1.6,
}

/** Applied once, right before judge-returned deltas are added to the running totals — everything upstream (the judge call itself, prompts, scene generation) stays difficulty-agnostic. */
export function scaleDeltasForDifficulty(deltas: RelationshipDeltas, difficulty: RelationshipDifficulty): RelationshipDeltas {
  const factor = DIFFICULTY_MULTIPLIERS[difficulty]
  if (factor === 1) return deltas
  return Object.fromEntries(DELTA_KEYS.map((k) => [k, Math.round(deltas[k] * factor)])) as RelationshipDeltas
}

/**
 * "Repeated same interaction → diminishing returns" (part of the momentum/friction work): when the
 * player keeps playing the exact same move (the same intent chip three turns running), a positive
 * warmth gain is scaled toward nothing — a compliment that landed the first time is just noise by
 * the fifth. Negative deltas and `tension` pass through untouched: a repeated *bad* move shouldn't
 * be softened, and rising friction from the repetition is a real reaction. `curiosity` is left
 * alone too (it's not warmth). Applied after `scaleDeltasForDifficulty`, on the same "adjust the
 * numbers, not the judge" principle.
 */
export function dampenRepeatedDeltas(deltas: RelationshipDeltas): RelationshipDeltas {
  const out = { ...deltas }
  for (const k of ['affection', 'trust', 'chemistry', 'comfort', 'respect'] as const) {
    if (out[k] > 0) out[k] = Math.round(out[k] * 0.4)
  }
  return out
}

/**
 * A durable memory with its emotional colouring ("memory emotion") — so a later callback can be
 * triggered by the *feel* of a remembered event without the model re-deriving it from prose. All
 * three numbers are defaulted, so a model that regresses to a bare string still produces a usable
 * fact.
 */
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

/**
 * Parses the judge's `newFacts` — either the current `["short sentence", ...]` form or the richer
 * `[{"text","importance","valence","unresolved"}, ...]` form (models drift between the two). A bare
 * string gets neutral defaults: importance 0.5, valence 0, not unresolved.
 */
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
  /**
   * Section 9(c)'s remaining (a) item: indices into the `pendingTasks` array passed in, for tasks
   * this exchange clearly and unambiguously completed — same conservative contract as
   * `detectCompletedTasks` in `objectiveAssist.ts`, folded into this call instead of firing as its
   * own separate request when both relationship-tracking and task-detection are due the same turn.
   * Always `[]` when `pendingTasks` wasn't passed (nothing was asked, so nothing to report).
   */
  completedTaskIndices: number[]
  /**
   * The post-intimacy window's verdict (`dating/aftercare.ts`), only ever present on the turn the
   * caller actually asked for one by passing `aftercareTurns`. Undefined otherwise — including
   * when it was asked for and the model returned nothing usable, which the caller treats as
   * `'awkward'` rather than as a reason to skip closing the window.
   */
  aftercareVerdict?: AftercareVerdict
  /** The "Character Mind" scoped slice — see `prompt/mindGuidance.ts`'s doc comment. Undefined means no clear shift this turn, not "neutral"; all three are sticky rather than reset every turn nothing moved them. */
  mood?: CharacterMood
  currentNeed?: CharacterNeed
  characterIntent?: string
  /**
   * Changes to the character's persistent agency layer (`dating/plans.ts`) — form a new plan,
   * annotate one, or close one out. `[]` on most turns. `note`/`resolve` indices point into the
   * `activePlans` list passed in. The caller folds these into `RelationshipTrack.plans` via
   * `applyPlanUpdates`.
   */
  planUpdates: PlanUpdate[]
  /**
   * Item 1's intimacy-scene phase read (`dating/intimacyScene.ts`) — only ever present on a turn
   * the caller actually asked for one by passing `currentIntimacyPhase` (a scene is currently
   * active), same conditional contract `aftercareVerdict` already has. `'resolved'` means the judge
   * read the scene as having wound down/concluded; `undefined` (with a scene active) is read by the
   * caller as "no change" and keeps the current phase, mirroring mood/need's own contract.
   */
  intimacyPhase?: IntimacyPhase | 'resolved'
  /**
   * Changes to the character's standing impressions of {{user}} (`dating/beliefs.ts`) — form,
   * revise, or drop one. `[]` on most turns. `revise`/`drop` indices point into the
   * `activeBeliefs` list passed in.
   */
  beliefUpdates: BeliefUpdate[]
  /**
   * Changes to the character's standing expectations of {{user}} (`dating/expectations.ts`) —
   * form, annotate, or resolve one (naming whether it was met or violated). `[]` on most turns.
   * `note`/`resolve` indices point into the `activeExpectations` list passed in.
   */
  expectationUpdates: ExpectationUpdate[]
  /** See `prompt/mindGuidance.ts`'s `fearGuidance` — sticky like `mood`/`currentNeed`/`characterIntent`; undefined means no change this turn. */
  currentFear?: string
}

/**
 * Small conservative classifier that estimates whether the latest exchange moved relationship
 * tone (across seven independent dimensions, see `RelationshipDeltaKey`), newly established any
 * romance-route flags, AND surfaced any durable fact worth remembering — combined into one call
 * on purpose. This used to be two sequential requests (`assessRelationshipDeltas` +
 * `detectSceneFlags`), then three once fact-extraction was folded in too; on a local single-GPU
 * KoboldCpp server, every background classifier call after a reply is serialized, so this fires
 * on literally every single turn (unlike the conditional gallery-unlock check below) and keeping
 * it to one call is a real responsiveness win, not just tidiness. Most dimensions, all flags, and
 * facts should stay unchanged on most turns — only what this specific exchange clearly touched
 * should move. `pendingTasks`, when passed, folds `objectiveAssist.ts`'s `detectCompletedTasks`
 * in as a fourth thing checked in the same call — section 9(c)'s last open (a) item, same idea.
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
    /** Currently-unresolved facts, in the caller's index order — the judge can mark one closed via `resolvedFactIndices`. Omit when there are none. */
    unresolvedFacts?: string[]
    /**
     * The character's persistent plans (`dating/plans.ts`), pre-formatted one per line (kind + note
     * baked in by `planLinesForJudge`), in the caller's index order — the judge annotates or closes
     * one by that index, and can always add new ones. Omit when there are none.
     */
    activePlans?: string[]
    /** World-authored flags beyond the 4 built-in defaults (see `CustomSceneFlag`) — glossaried and validated exactly like the built-ins. */
    customFlags?: CustomSceneFlag[]
    /** 10b: how the player tagged their most recent line (`MessageIntent`) — interpretation context, not a direct stat move. */
    intent?: string
    /** Pending objective task descriptions, in the caller's index order — only passed when task-detection is also due this turn. Omitted/empty means "don't ask", not "nothing completed". */
    pendingTasks?: string[]
    /**
     * Transcript of the post-intimacy window, passed only on the turn it closes — the same
     * ride-along trick `pendingTasks` uses, so judging it costs no extra model call. Omitted means
     * "don't ask", which is every ordinary turn.
     */
    aftercareTurns?: ChatMessage[]
    /** The character's mood/need/intention going into this exchange (before it), so the classifier can judge whether any genuinely shifted rather than guessing blind. See `prompt/mindGuidance.ts`. */
    currentMood?: CharacterMood
    currentNeed?: CharacterNeed
    currentIntent?: string
    /**
     * Item 1's intimacy scene state machine (`dating/intimacyScene.ts`) — passed only while a scene
     * is currently active, the same ride-along trick `aftercareTurns`/`pendingTasks` already use so
     * this costs no extra model call. Asks the judge to read whether this turn's reply is still
     * building, has reached its peak, or has wound down/concluded.
     */
    currentIntimacyPhase?: IntimacyPhase
    /** The character's standing impressions of {{user}} (`dating/beliefs.ts`), pre-formatted one per line, in the caller's index order — the judge revises or drops one by that index, and can always add new ones. Omit when there are none. */
    activeBeliefs?: string[]
    /** The character's standing expectations of {{user}} (`dating/expectations.ts`), pre-formatted one per line (note baked in), in the caller's index order — the judge annotates or resolves one by that index. Omit when there are none. */
    activeExpectations?: string[]
    /** The character's current private fear going into this exchange, if one's been read — see `prompt/mindGuidance.ts`'s `fearGuidance`. */
    currentFear?: string
  },
): Promise<RelationshipMoment> {
  const hasTasks = !!params.pendingTasks?.length
  const hasAftercare = !!params.aftercareTurns?.length
  const hasOpenThreads = !!params.unresolvedFacts?.length
  const hasPlans = !!params.activePlans?.length
  const hasIntimacyScene = !!params.currentIntimacyPhase
  const hasBeliefs = !!params.activeBeliefs?.length
  const hasExpectations = !!params.activeExpectations?.length
  const prompt = [
    'You are scoring relationship momentum, tracking high-level romance route flags, noting durable facts worth remembering long-term, AND (separately) reading the character\'s own current emotional state, an underlying need, and private intentions, in an in-character roleplay.',
    `Current scores (0-100 each): ${DELTA_KEYS.map((k) => `${k}=${params.current[k]}`).join(', ')}.`,
    `Recent context:\n${recentText(params.history, params.charName, params.userName, 8)}`,
    `Latest reply from ${params.charName}:\n${params.latestReply}`,
    `Dimension meanings: ${DELTA_KEYS.map((k) => `${k} = ${DIMENSION_GLOSSARY[k]}`).join('; ')}.`,
    `Known route flags: ${describeFlags(params.customFlags)}.`,
    describeIntentForJudge(params.intent)?.replace(/\{\{char\}\}/g, params.charName) ?? '',
    params.knownFacts?.length ? `Facts already remembered (don't repeat these): ${params.knownFacts.join('; ')}.` : '',
    hasOpenThreads
      ? `Open threads still unresolved (something between them the story hasn't closed):\n${params.unresolvedFacts!.map((f, i) => `${i}: ${f}`).join('\n')}`
      : '',
    hasTasks ? `Pending objective tasks:\n${params.pendingTasks!.map((t, i) => `${i}: ${t}`).join('\n')}` : '',
    hasAftercare
      ? `Separately: ${params.charName} and ${params.userName} were intimate a few turns ago, and you are also judging how the time SINCE went for ${params.charName} — the aftermath, not the act. Everything said since:\n${recentText(params.aftercareTurns!, params.charName, params.userName, 24)}`
      : '',
    hasIntimacyScene
      ? `Separately: an explicit intimate scene is currently in progress (currently read as "${params.currentIntimacyPhase}"). Judge whether the latest reply is still building, has reached its physical peak, or has now wound down/concluded (moving into its aftermath).`
      : '',
    `${params.charName}'s mood going into this exchange: ${params.currentMood ?? 'not yet read'}. Their underlying need lately: ${params.currentNeed ?? 'not yet read'}. Their private intention going in: ${params.currentIntent ?? 'none noted'}. Their private fear going in: ${params.currentFear ?? 'none noted'}.`,
    hasPlans
      ? `${params.charName}'s current standing plans — concrete intentions they're carrying between turns, not just this-turn reactions:\n${params.activePlans!.map((p, i) => `${i}: ${p}`).join('\n')}`
      : `${params.charName} has no standing plans on record yet.`,
    hasBeliefs
      ? `${params.charName}'s standing impressions of ${params.userName} as a person — not the relationship stats, an actual judgment of who ${params.userName} is:\n${params.activeBeliefs!.map((b, i) => `${i}: ${b}`).join('\n')}`
      : `${params.charName} hasn't formed any standing impressions of ${params.userName} yet.`,
    hasExpectations
      ? `${params.charName}'s standing expectations of ${params.userName} — things ${params.charName} has started counting on, whether or not ${params.userName} knows it:\n${params.activeExpectations!.map((e, i) => `${i}: ${e}`).join('\n')}`
      : `${params.charName} has no standing expectations of ${params.userName} on record yet.`,
    `Return ONLY a minified JSON object: {"deltas":{ one integer -2..2 per dimension key },"newFlags":[ any newly-established flags from the known set, or [] ],"reason":"...","newFacts":[ any new durable facts, or [] ]${hasOpenThreads ? ',"resolvedFactIndices":[ open-thread index numbers this exchange clearly closed, or [] ]' : ''}${hasTasks ? ',"completedTaskIndices":[ pending task index numbers this exchange clearly and unambiguously accomplished, or [] ]' : ''}${hasAftercare ? `,"aftercareVerdict":"exactly one of [${AFTERCARE_VERDICTS.join(', ')}]"` : ''}${hasIntimacyScene ? ',"intimacyPhase":"exactly one of [building, peak, resolved]"' : ''},"mood":"one of [${MOOD_VOCAB.join(', ')}], only if this exchange gives a clear enough read to state one — omit entirely otherwise","currentNeed":"one of [${NEED_VOCAB.join(', ')}], only if this stretch of the story clearly shows this need going unmet — omit entirely otherwise, and don't change it lightly","characterIntent":"a short (under 12 words) private thing ${params.charName} now wants, only if something concrete and new became clear this exchange — omit entirely otherwise","currentFear":"a short (under 12 words) private fear ${params.charName} has right now, only if this exchange makes one genuinely clear — omit entirely otherwise, and don't change it lightly","planUpdates":[ usually [] — see the plan rules below ],"beliefUpdates":[ usually [] — see the belief rules below ],"expectationUpdates":[ usually [] — see the expectation rules below ]}.`,
    'Only move a dimension if this specific exchange clearly affected it. Leave the rest at 0. Most turns should move only one or two dimensions and add no new flags.',
    '"reason" is a short (under 12 words) in-world one-liner naming what just happened, e.g. "Complimented her cooking unprompted". Give one only if at least one dimension moved or a flag was added, otherwise "".',
    `"newFacts" is for concrete, durable things worth recalling much later: a name, a stated preference, a piece of backstory, a promise made, a moment that landed hard. Not every line of dialogue. Most turns add none. Each fact is an object {"text": one short standalone sentence, "importance": 0-1, "valence": -1 to 1, "unresolved": true/false}. "importance": ~0.2 for a small detail, 0.8+ for something that reshapes how ${params.charName} sees ${params.userName}. "valence": how it felt to ${params.charName} — negative if it hurt or disappointed, positive if it meant a lot, 0 for neutral information. "unresolved": true only for an open wound or open question the story has NOT closed (a slight not addressed, a promise not yet kept, a question dodged) — most facts are false.`,
    hasOpenThreads
      ? '"resolvedFactIndices" lists open-thread indices from the list above that this exchange clearly closed — an apology that landed, a promise kept, a dodged question finally answered. Be conservative: [] unless it plainly happened this turn.'
      : '',
    `"mood" is ${params.charName}'s own transient emotional state right now, independent of the relationship dimensions above — a close, trusted relationship can still have an "annoyed" or "exhausted" day. Omit it on most turns; only state one when this exchange actually gave a clear signal, and don't just repeat the current mood back for no reason.`,
    `"currentNeed" is steadier than mood — a psychological undercurrent this stretch of the story hasn't been meeting (e.g. "reassurance" after being flaky, "recognition" after going unnoticed, "solitude" after being crowded). Omit it almost every turn; it shouldn't flip as readily as mood does, and should only be set or changed on a genuinely clear, sustained signal, not one line of dialogue.`,
    `"characterIntent" is a private thing ${params.charName} wants that the player hasn't necessarily been told — a small hidden agenda that can quietly color future turns (wanting reassurance, wanting space, planning a surprise, wanting an apology first). Omit it on almost every turn; once set it should usually stay omitted (meaning "no change") for a while rather than being reset every exchange.`,
    `"planUpdates" changes ${params.charName}'s standing plans — bigger and longer-lived than "characterIntent": a real intention that spans many turns and can be entirely about ${params.charName}'s own life. Each entry is one of: {"action":"add","goal":"short, in ${params.charName}'s own terms","kind":"personal"|"together"|"distance","note":"optional"} to form a new one; {"action":"note","index":N,"note":"..."} to record progress or a setback on plan N; {"action":"resolve","index":N} to close plan N (finished, abandoned, or overtaken by events). "personal" = ${params.charName}'s own life independent of ${params.userName}; "together" = something they want to do with ${params.userName}; "distance" = deliberately holding back or protecting themselves. Use [] on almost every turn. Only "add" when this exchange genuinely gave ${params.charName} a new reason to want something lasting — a plan formed on a whim and never mentioned again is noise. Resolve a plan the moment the story has clearly moved past it.`,
    `"beliefUpdates" changes ${params.charName}'s standing impressions of ${params.userName} as a person — a judgment about who ${params.userName} *is*, not a one-off event (that's "newFacts") and not a relationship stat. Each entry is one of: {"action":"add","text":"the impression in ${params.charName}'s own voice, e.g. 'He's unusually patient with me.'"} to form a new one; {"action":"revise","index":N,"text":"..."} to correct or sharpen belief N once it's proven wrong or too simple; {"action":"drop","index":N} to abandon one that's been clearly disproven. Use [] on almost every turn — only add one when this exchange gives real, repeated-pattern evidence, not from a single isolated moment.`,
    `"expectationUpdates" changes ${params.charName}'s standing expectations of ${params.userName} — something ${params.charName} has started quietly counting on, whether or not ${params.userName} has ever been told. Each entry is one of: {"action":"add","text":"the expectation, e.g. 'expects a check-in most Sundays'"}; {"action":"note","index":N,"note":"..."} to record it playing out; {"action":"resolve","index":N,"outcome":"met"|"violated"} once it's clearly been met or clearly been missed. Use [] on almost every turn. "violated" should be reserved for a real, noticeable letdown, not a trivial miss.`,
    hasAftercare
      ? `"aftercareVerdict" judges only how ${params.userName} treated ${params.charName} in the turns since they were intimate. "tender" = stayed present and warm, gave reassurance or closeness, took ${params.charName} seriously. "cold" = pulled away, went distant or dismissive, changed the subject, or acted as if it had not happened. "awkward" = anything in between, including a fumbled or self-conscious aftermath that was still well meant. Judge ${params.userName}'s behaviour, not ${params.charName}'s, and not whether the intimacy itself went well. Most aftermaths are "awkward" — reserve "cold" for a real, visible withdrawal, not merely for a quiet stretch.`
      : '',
    hasTasks
      ? 'Be conservative about "completedTaskIndices": only include a task index if this exchange plainly and unambiguously accomplished it, not if it merely became more likely. Use [] if none did.'
      : '',
    hasIntimacyScene
      ? '"intimacyPhase": "building" if the scene is still escalating (anticipation, teasing, not yet at full intensity); "peak" once it has clearly reached full intensity; "resolved" once it has visibly wound down or concluded this reply (moving into its aftermath). Judge only this specific reply, not the scene in the abstract.'
      : '',
    `Example (nothing much happened): {"deltas":{"affection":1,"trust":0,"chemistry":0,"comfort":1,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"Stayed to help clean up without being asked","newFacts":[]${hasOpenThreads ? ',"resolvedFactIndices":[]' : ''}${hasTasks ? ',"completedTaskIndices":[]' : ''},"planUpdates":[],"beliefUpdates":[],"expectationUpdates":[]}`,
    `Example (a fact landed hard): {"deltas":{"affection":-2,"trust":-1,"chemistry":0,"comfort":-1,"respect":0,"curiosity":0,"tension":2},"newFlags":[],"reason":"Forgot her birthday entirely","newFacts":[{"text":"Forgot ${params.charName}'s birthday","importance":0.75,"valence":-0.7,"unresolved":true}]${hasOpenThreads ? ',"resolvedFactIndices":[]' : ''}${hasTasks ? ',"completedTaskIndices":[]' : ''},"planUpdates":[],"beliefUpdates":[],"expectationUpdates":[]}`,
    `Example (a plan forms — ${params.charName} decides on something lasting): {"deltas":{"affection":0,"trust":1,"chemistry":0,"comfort":0,"respect":1,"curiosity":0,"tension":0},"newFlags":[],"reason":"Opened up about the gallery showcase deadline","newFacts":[]${hasOpenThreads ? ',"resolvedFactIndices":[]' : ''}${hasTasks ? ',"completedTaskIndices":[]' : ''},"planUpdates":[{"action":"add","goal":"finish the mural before the showcase","kind":"personal","note":"three weeks out, behind on it"}],"beliefUpdates":[],"expectationUpdates":[]}`,
    `Example (a pattern becomes a real impression, and an expectation is broken): {"deltas":{"affection":-1,"trust":0,"chemistry":0,"comfort":-1,"respect":0,"curiosity":0,"tension":1},"newFlags":[],"reason":"Third Sunday in a row with no check-in","newFacts":[]${hasOpenThreads ? ',"resolvedFactIndices":[]' : ''}${hasTasks ? ',"completedTaskIndices":[]' : ''},"planUpdates":[],"beliefUpdates":[{"action":"add","text":"He means well but tends to go quiet when things get busy for him."}],"expectationUpdates":[{"action":"resolve","index":0,"outcome":"violated"}]}`,
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await generateWithTimeout(
    client,
    { ...REL_PARAMS, max_length: 380, max_context_length: await client.getEffectiveMaxContext(), prompt },
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
  // Only trusted when it was actually asked for: a model that volunteers the field unprompted is
  // guessing about a window that isn't open, and honouring that would apply a real stat swing for
  // an event that never happened.
  const aftercareVerdict = hasAftercare && isAftercareVerdict(obj.aftercareVerdict) ? obj.aftercareVerdict : undefined
  const mood = MOOD_VOCAB.includes(obj.mood as CharacterMood) ? (obj.mood as CharacterMood) : undefined
  const currentNeed = NEED_VOCAB.includes(obj.currentNeed as CharacterNeed) ? (obj.currentNeed as CharacterNeed) : undefined
  const characterIntent =
    typeof obj.characterIntent === 'string' && obj.characterIntent.trim() ? obj.characterIntent.trim().slice(0, 160) : undefined
  const currentFear =
    typeof obj.currentFear === 'string' && obj.currentFear.trim() ? obj.currentFear.trim().slice(0, 160) : undefined
  // `note`/`resolve` updates that point past the plans actually passed in are dropped — a stale
  // index from a model that miscounted must not silently rewrite or delete the wrong plan.
  const planCount = params.activePlans?.length ?? 0
  const planUpdates = parsePlanUpdates(obj.planUpdates).filter(
    (u) => u.action === 'add' || u.index < planCount,
  )
  // Same stale-index guard as `planUpdates` above, for each of the two new lifecycles.
  const beliefCount = params.activeBeliefs?.length ?? 0
  const beliefUpdates = parseBeliefUpdates(obj.beliefUpdates).filter((u) => u.action === 'add' || u.index < beliefCount)
  const expectationCount = params.activeExpectations?.length ?? 0
  const expectationUpdates = parseExpectationUpdates(obj.expectationUpdates).filter(
    (u) => u.action === 'add' || u.index < expectationCount,
  )
  // Only trusted when actually asked for, same guard `aftercareVerdict` above already applies — a
  // model volunteering this unprompted is guessing about a scene that isn't tracked as active.
  const intimacyPhase =
    hasIntimacyScene && (obj.intimacyPhase === 'building' || obj.intimacyPhase === 'peak' || obj.intimacyPhase === 'resolved')
      ? (obj.intimacyPhase as IntimacyPhase | 'resolved')
      : undefined
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
    intimacyPhase,
    beliefUpdates,
    expectationUpdates,
    currentFear,
  }
}

/**
 * Checks whether any locked gallery entries seem to have been earned by the latest moment.
 */
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
 * Turns an entire date's transcript into one outcome — deltas, new route flags, a player-facing
 * recap, and any durable facts — instead of the per-turn drip-feed `assessRelationshipMoment`
 * already does for ordinary chat. Deliberately a separate pass (10b's "save-safe end-of-date
 * scoring"): a date in progress suppresses the normal per-turn tracking (see
 * `useChatSession.ts`'s `runGeneration`) so a flat, awkward, or hurtful date doesn't quietly drift
 * the relationship forward turn by turn — only this end-of-scene judgment counts, and it can
 * legitimately score near-zero across the board for a date that went nowhere.
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
    /** 10b: the `MessageIntent`s the player deliberately played across the date, in order. */
    intents?: string[]
    /** 10b: what the character secretly wanted from this date (`DateEventCard.hiddenAgenda`) — never shown to the player, only used to judge whether it landed. Never set for a hangout. */
    hiddenAgenda?: string
    /** 10b: set when the date ended because the rapport judge flagged a walkout mid-scene, not the player choosing to end it — the outcome should read and score as an abrupt, negative exit. Hangouts never walk out, so this is only ever set for a date. */
    walkedOut?: boolean
    /** 10b: `'hangout'` is the lower-stakes sibling of `'date'` (see `DateEventCard.kind`) — same judge pass, gentler framing: no verdict-y language, modest deltas, comfort/trust-led growth rather than a graded outcome. Defaults to `'date'`. */
    sceneKind?: 'date' | 'hangout'
  },
): Promise<DateOutcome> {
  const isHangout = params.sceneKind === 'hangout'
  const sceneNoun = isHangout ? 'hangout' : 'date'
  const excludedFlags = excludedFlagsFor(params.sceneKind)
  // Cap at the last 24 turns — plenty for a single scene, and keeps the prompt bounded even
  // if the player let this run long. Empty messages (still-streaming placeholders) are dropped.
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
    describeIntentsForDate(params.intents ?? [])?.replace(/\{\{char\}\}/g, params.charName) ?? '',
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
    // The example's `newFlags` has to stay inside the same set the menu above offers: a hangout
    // that withholds `first_date` while still *demonstrating* it would be handing the classifier
    // the flag back in the most suggestive line of the whole prompt. Hangouts get modest deltas
    // here too, matching the gentler framing they're judged under.
    isHangout
      ? 'Example: {"deltas":{"affection":1,"trust":2,"chemistry":0,"comfort":2,"respect":0,"curiosity":1,"tension":0},"newFlags":["promise"],"recap":"She talked about her old bakery for the first time, and made you swear to try her cinnamon rolls sometime.","newFacts":[{"text":"Used to run a small bakery before moving here","importance":0.6,"valence":0.3,"unresolved":false}]}'
      : 'Example: {"deltas":{"affection":3,"trust":2,"chemistry":2,"comfort":1,"respect":0,"curiosity":1,"tension":0},"newFlags":["first_date"],"recap":"She lit up talking about her old bakery and kept finding reasons to lean in closer.","newFacts":[{"text":"Used to run a small bakery before moving here","importance":0.6,"valence":0.3,"unresolved":false}]}',
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
  // Re-checked here, not just omitted from the prompt above: a model that names `first_date`
  // anyway (it is, after all, a flag it has seen in every date scene) must not be able to set it.
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
    /**
     * Where the two of them officially stand (10c's commitment ladder). Without it this call only
     * ever saw `affection`, and an established couple kept getting handed casual "hangout" cards
     * long after "ask to be dating" was accepted — affection alone can't distinguish "very fond of
     * each other" from "actually together", which is exactly the distinction that decides whether
     * a suggestion should read as a date or a get-together. Optional so an ordinary
     * not-yet-official chat keeps the prompt it always had, unchanged.
     */
    commitmentStatus?: CommitmentStatus
    /**
     * Set only when this card is being drafted for one specific ladder-crossing occasion — a
     * wedding for `married`, a moving-in day for `living_together` — right after `useChatSession.ts`'s
     * `askForCommitment` sees that tier accepted, rather than an ordinary "Suggest event with AI"
     * click. Overrides the generic `commitmentStatus`-aware framing below with a much more specific
     * ask, and forces the returned card's `kind` to `'date'` regardless of what the model answers,
     * so this milestone always surfaces as a real, live, played-out scene (`stage.ts`'s `isLiveScene`)
     * instead of risking a `hangout`/`gift`/`milestone` card that never goes live at all.
     */
    milestoneOccasion?: Extract<CommitmentStatus, 'married' | 'living_together'>
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
    // A milestone occasion never trusts the model's own `kind` choice — this must always be a live
    // scene (see the param's own doc comment), not left to chance.
    kind: params.milestoneOccasion ? 'date' : obj.kind === 'gift' || obj.kind === 'milestone' || obj.kind === 'hangout' ? obj.kind : 'date',
    affectionRequirement: params.affection,
  }
}

/**
 * 10b's "real stakes": drafts what a character secretly wants from a date, from their own card —
 * never shown to the player, only fed back to `assessDateOutcome` at the end. Freeform one-sentence
 * text rather than JSON (nothing to validate beyond length), so a model that ignores the format
 * still produces something usable after trimming. Returns null rather than a generic filler when
 * the card gives the judge nothing to work with or the call fails — a missing agenda is a fine
 * outcome, a made-up one that contradicts the card is not.
 */
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
    // Every other judge call in this file ends on a bare generation cue (`JSON:` etc.) — without
    // one here, a local model reliably produced nothing rather than guessing where to start.
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

/**
 * Judges a single Define-the-Relationship ask (10c) — reaching warmth just unlocks asking; it
 * never guarantees a yes. The character can accept, deflect (not right now, but nothing damaged —
 * asking again later stays possible), or the ask can backfire (genuinely bad timing or delivery, a
 * real relationship cost) — decided by the model reading the actual relationship texture, not a
 * coin flip or a hardcoded rule for what counts as "badly timed."
 */
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
    'Example: {"decision":"accept","reason":"She laughs and pulls you into a hug. Of course she wants that too.","deltas":{"affection":3,"trust":2,"chemistry":2,"comfort":1,"respect":1,"curiosity":0,"tension":-1}}',
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

/**
 * Judges a single "first time together" ask — the user's own direct follow-up to the intimacy
 * catalog ("we should be able to choose... lose virginity"), a deliberate initiation rather than
 * only ever something the relationship-moment classifier might notice after the fact. Same shape
 * and same three-outcome spirit as `assessCommitmentAsk` (reusing `CommitmentAskOutcome`) —
 * reaching the warmth/commitment floor (`stage.ts`'s `canInitiateFirstTime`) only unlocks *asking*,
 * never guarantees a yes.
 */
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
    'Example: {"decision":"accept","reason":"She goes still for a moment, then pulls you closer instead of pulling away.","deltas":{"affection":3,"trust":2,"chemistry":3,"comfort":1,"respect":0,"curiosity":0,"tension":-1}}',
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
