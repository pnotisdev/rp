import type { ChatBackend } from '@/lib/api/chatBackend'
import { parseLenientJson } from '@/lib/jsonRepair'
import type { Character } from '@/lib/characters/cardSpec'
import type { CommitmentStatus, CustomSceneFlag, DateEventCard, RelationshipDimension, SceneFlag } from '@/lib/types'
import type { ChatMessage } from '@/lib/prompt/builder'
import { formatCommitmentStatus, RELATIONSHIP_DIMENSIONS, SCENE_FLAGS } from '@/lib/dating/stage'
import { describeIntentForJudge, describeIntentsForDate } from '@/lib/dating/intent'
import { MOOD_VOCAB, NEED_VOCAB, type CharacterMood, type CharacterNeed } from '@/lib/prompt/mindGuidance'

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

export interface RelationshipMoment {
  deltas: RelationshipDeltas
  newFlags: SceneFlag[]
  /** Short one-line reason for whatever moved, e.g. "Complimented her cooking unprompted" — undefined when nothing moved. */
  reason?: string
  /** New durable facts worth remembering long-term (name, preference, backstory, a promise made) — [] most turns. */
  newFacts: string[]
  /**
   * Section 9(c)'s remaining (a) item: indices into the `pendingTasks` array passed in, for tasks
   * this exchange clearly and unambiguously completed — same conservative contract as
   * `detectCompletedTasks` in `objectiveAssist.ts`, folded into this call instead of firing as its
   * own separate request when both relationship-tracking and task-detection are due the same turn.
   * Always `[]` when `pendingTasks` wasn't passed (nothing was asked, so nothing to report).
   */
  completedTaskIndices: number[]
  /** The "Character Mind" scoped slice — see `prompt/mindGuidance.ts`'s doc comment. Undefined means no clear shift this turn, not "neutral"; all three are sticky rather than reset every turn nothing moved them. */
  mood?: CharacterMood
  currentNeed?: CharacterNeed
  characterIntent?: string
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
    /** World-authored flags beyond the 4 built-in defaults (see `CustomSceneFlag`) — glossaried and validated exactly like the built-ins. */
    customFlags?: CustomSceneFlag[]
    /** 10b: how the player tagged their most recent line (`MessageIntent`) — interpretation context, not a direct stat move. */
    intent?: string
    /** Pending objective task descriptions, in the caller's index order — only passed when task-detection is also due this turn. Omitted/empty means "don't ask", not "nothing completed". */
    pendingTasks?: string[]
    /** The character's mood/need/intention going into this exchange (before it), so the classifier can judge whether any genuinely shifted rather than guessing blind. See `prompt/mindGuidance.ts`. */
    currentMood?: CharacterMood
    currentNeed?: CharacterNeed
    currentIntent?: string
  },
): Promise<RelationshipMoment> {
  const hasTasks = !!params.pendingTasks?.length
  const prompt = [
    'You are scoring relationship momentum, tracking high-level romance route flags, noting durable facts worth remembering long-term, AND (separately) reading the character\'s own current emotional state, an underlying need, and private intentions, in an in-character roleplay.',
    `Current scores (0-100 each): ${DELTA_KEYS.map((k) => `${k}=${params.current[k]}`).join(', ')}.`,
    `Recent context:\n${recentText(params.history, params.charName, params.userName, 8)}`,
    `Latest reply from ${params.charName}:\n${params.latestReply}`,
    `Dimension meanings: ${DELTA_KEYS.map((k) => `${k} = ${DIMENSION_GLOSSARY[k]}`).join('; ')}.`,
    `Known route flags: ${describeFlags(params.customFlags)}.`,
    describeIntentForJudge(params.intent)?.replace(/\{\{char\}\}/g, params.charName) ?? '',
    params.knownFacts?.length ? `Facts already remembered (don't repeat these): ${params.knownFacts.join('; ')}.` : '',
    hasTasks ? `Pending objective tasks:\n${params.pendingTasks!.map((t, i) => `${i}: ${t}`).join('\n')}` : '',
    `${params.charName}'s mood going into this exchange: ${params.currentMood ?? 'not yet read'}. Their underlying need lately: ${params.currentNeed ?? 'not yet read'}. Their private intention going in: ${params.currentIntent ?? 'none noted'}.`,
    `Return ONLY a minified JSON object: {"deltas":{ one integer -2..2 per dimension key },"newFlags":[ any newly-established flags from the known set, or [] ],"reason":"...","newFacts":[ any new durable facts, or [] ]${hasTasks ? ',"completedTaskIndices":[ pending task index numbers this exchange clearly and unambiguously accomplished, or [] ]' : ''},"mood":"one of [${MOOD_VOCAB.join(', ')}], only if this exchange gives a clear enough read to state one — omit entirely otherwise","currentNeed":"one of [${NEED_VOCAB.join(', ')}], only if this stretch of the story clearly shows this need going unmet — omit entirely otherwise, and don't change it lightly","characterIntent":"a short (under 12 words) private thing ${params.charName} now wants, only if something concrete and new became clear this exchange — omit entirely otherwise"}.`,
    'Only move a dimension if this specific exchange clearly affected it. Leave the rest at 0. Most turns should move only one or two dimensions and add no new flags.',
    '"reason" is a short (under 12 words) in-world one-liner naming what just happened, e.g. "Complimented her cooking unprompted". Give one only if at least one dimension moved or a flag was added, otherwise "".',
    '"newFacts" is for concrete, durable facts about {{user}} worth recalling much later: a name, a stated preference, a piece of backstory, a promise made. Not every line of dialogue. Most turns should add none. Each fact as one short standalone sentence, e.g. "Prefers tea over coffee" or "Promised to visit again next weekend".',
    `"mood" is ${params.charName}'s own transient emotional state right now, independent of the relationship dimensions above — a close, trusted relationship can still have an "annoyed" or "exhausted" day. Omit it on most turns; only state one when this exchange actually gave a clear signal, and don't just repeat the current mood back for no reason.`,
    `"currentNeed" is steadier than mood — a psychological undercurrent this stretch of the story hasn't been meeting (e.g. "reassurance" after being flaky, "recognition" after going unnoticed, "solitude" after being crowded). Omit it almost every turn; it shouldn't flip as readily as mood does, and should only be set or changed on a genuinely clear, sustained signal, not one line of dialogue.`,
    `"characterIntent" is a private thing ${params.charName} wants that the player hasn't necessarily been told — a small hidden agenda that can quietly color future turns (wanting reassurance, wanting space, planning a surprise, wanting an apology first). Omit it on almost every turn; once set it should usually stay omitted (meaning "no change") for a while rather than being reset every exchange.`,
    hasTasks
      ? 'Be conservative about "completedTaskIndices": only include a task index if this exchange plainly and unambiguously accomplished it, not if it merely became more likely. Use [] if none did.'
      : '',
    hasTasks
      ? 'Example: {"deltas":{"affection":1,"trust":0,"chemistry":0,"comfort":1,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"Stayed to help clean up without being asked","newFacts":[],"completedTaskIndices":[]}'
      : 'Example: {"deltas":{"affection":1,"trust":0,"chemistry":0,"comfort":1,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"Stayed to help clean up without being asked","newFacts":[]}',
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await client.generate({ ...REL_PARAMS, max_length: 340, max_context_length: await client.getEffectiveMaxContext(), prompt })
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
  const newFacts = Array.isArray(obj.newFacts)
    ? obj.newFacts.filter((f): f is string => typeof f === 'string' && f.trim().length > 0).map((f) => f.trim().slice(0, 200))
    : []
  const pendingCount = params.pendingTasks?.length ?? 0
  const completedTaskIndices =
    hasTasks && Array.isArray(obj.completedTaskIndices)
      ? obj.completedTaskIndices.filter((i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < pendingCount)
      : []
  const mood = MOOD_VOCAB.includes(obj.mood as CharacterMood) ? (obj.mood as CharacterMood) : undefined
  const currentNeed = NEED_VOCAB.includes(obj.currentNeed as CharacterNeed) ? (obj.currentNeed as CharacterNeed) : undefined
  const characterIntent =
    typeof obj.characterIntent === 'string' && obj.characterIntent.trim() ? obj.characterIntent.trim().slice(0, 160) : undefined
  return { deltas, newFlags, reason, newFacts, completedTaskIndices, mood, currentNeed, characterIntent }
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

  const text = await client.generate({ ...REL_PARAMS, max_length: 120, max_context_length: await client.getEffectiveMaxContext(), prompt })
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
  newFacts: string[]
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
    '"newFacts" is for concrete, durable facts about {{user}} worth recalling much later. Most scenes add one or none.',
    // The example's `newFlags` has to stay inside the same set the menu above offers: a hangout
    // that withholds `first_date` while still *demonstrating* it would be handing the classifier
    // the flag back in the most suggestive line of the whole prompt. Hangouts get modest deltas
    // here too, matching the gentler framing they're judged under.
    isHangout
      ? 'Example: {"deltas":{"affection":1,"trust":2,"chemistry":0,"comfort":2,"respect":0,"curiosity":1,"tension":0},"newFlags":["promise"],"recap":"She talked about her old bakery for the first time, and made you swear to try her cinnamon rolls sometime.","newFacts":["Used to run a small bakery before moving here"]}'
      : 'Example: {"deltas":{"affection":3,"trust":2,"chemistry":2,"comfort":1,"respect":0,"curiosity":1,"tension":0},"newFlags":["first_date"],"recap":"She lit up talking about her old bakery and kept finding reasons to lean in closer.","newFacts":["Used to run a small bakery before moving here"]}',
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await client.generate({ ...REL_PARAMS, max_length: 420, max_context_length: await client.getEffectiveMaxContext(), prompt })
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
  const newFacts = Array.isArray(obj.newFacts)
    ? obj.newFacts.filter((f): f is string => typeof f === 'string' && f.trim().length > 0).map((f) => f.trim().slice(0, 200))
    : []
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
  },
): Promise<DateEventCard | null> {
  const official = params.commitmentStatus && params.commitmentStatus !== 'none' ? params.commitmentStatus : null
  const prompt = [
    'You design a lightweight dating-sim style event card for a roleplay chat.',
    `Character: ${params.characterName}${params.characterDescription ? `. ${params.characterDescription}` : ''}`,
    `User persona: ${params.personaName}`,
    params.worldDescription ? `World context: ${params.worldDescription}` : '',
    `Current affection: ${params.affection}/100`,
    official
      ? `They are already officially ${formatCommitmentStatus(official)}. Suggest something that fits a couple at that stage — an actual date, or something they'd plausibly do together now that it's established — rather than a tentative, getting-to-know-you outing.`
      : 'They are not officially together.',
    `Available background ids: ${params.availableBackgrounds.join(', ')}`,
    'Return ONLY one minified JSON object:',
    '{"title":"...","description":"...","objectiveTitle":"...","objectiveDescription":"...","backgroundId":"...","kind":"date|hangout|gift|milestone"}',
    '"date" is a real, romantically-charged date. "hangout" is a lower-stakes, casual get-together — friendly, no romantic stakes riding on it, fitting for earlier affection or a deliberately relaxed scene. Pick whichever actually fits the current relationship and mood.',
    'Make it plausible for the current affection level, with a clear scene objective.',
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await client.generate({ ...EVENT_PARAMS, max_context_length: await client.getEffectiveMaxContext(), prompt })
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
    kind: obj.kind === 'gift' || obj.kind === 'milestone' || obj.kind === 'hangout' ? obj.kind : 'date',
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
    text = await client.generate({ ...REL_PARAMS, max_length: 60, max_context_length: await client.getEffectiveMaxContext(), prompt })
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

  const text = await client.generate({ ...REL_PARAMS, max_length: 260, max_context_length: await client.getEffectiveMaxContext(), prompt })
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

  const text = await client.generate({ ...REL_PARAMS, max_length: 260, max_context_length: await client.getEffectiveMaxContext(), prompt })
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
