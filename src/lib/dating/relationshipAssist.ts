import { KoboldClient } from '@/lib/api/kobold'
import { parseLenientJson } from '@/lib/jsonRepair'
import type { Character } from '@/lib/characters/cardSpec'
import type { CustomSceneFlag, DateEventCard, RelationshipDimension, SceneFlag } from '@/lib/types'
import type { ChatMessage } from '@/lib/prompt/builder'
import { RELATIONSHIP_DIMENSIONS, SCENE_FLAGS } from '@/lib/dating/stage'

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

/** World-authored flags (see `CustomSceneFlag`) get the same glossary treatment as the built-in 4 — their own `description` is the classifier's bar for firing, same idea as `FLAG_GLOSSARY`. */
function describeFlags(customFlags?: CustomSceneFlag[]): string {
  const builtIn = SCENE_FLAGS.map((f) => `${f} (${FLAG_GLOSSARY[f]})`)
  const custom = (customFlags ?? []).map((f) => `${f.id} (${f.description})`)
  return [...builtIn, ...custom].join('; ')
}

function allowedFlagIds(customFlags?: CustomSceneFlag[]): Set<string> {
  return new Set([...SCENE_FLAGS, ...(customFlags ?? []).map((f) => f.id)])
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
 * should move.
 */
export async function assessRelationshipMoment(
  client: KoboldClient,
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
  },
): Promise<RelationshipMoment> {
  const prompt = [
    'You are scoring relationship momentum, tracking high-level romance route flags, AND noting durable facts worth remembering long-term, in an in-character roleplay.',
    `Current scores (0-100 each): ${DELTA_KEYS.map((k) => `${k}=${params.current[k]}`).join(', ')}.`,
    `Recent context:\n${recentText(params.history, params.charName, params.userName, 8)}`,
    `Latest reply from ${params.charName}:\n${params.latestReply}`,
    `Dimension meanings: ${DELTA_KEYS.map((k) => `${k} = ${DIMENSION_GLOSSARY[k]}`).join('; ')}.`,
    `Known route flags: ${describeFlags(params.customFlags)}.`,
    params.knownFacts?.length ? `Facts already remembered (don't repeat these): ${params.knownFacts.join('; ')}.` : '',
    'Return ONLY a minified JSON object: {"deltas":{ one integer -2..2 per dimension key },"newFlags":[ any newly-established flags from the known set, or [] ],"reason":"...","newFacts":[ any new durable facts, or [] ]}.',
    'Only move a dimension if this specific exchange clearly affected it. Leave the rest at 0. Most turns should move only one or two dimensions and add no new flags.',
    '"reason" is a short (under 12 words) in-world one-liner naming what just happened, e.g. "Complimented her cooking unprompted". Give one only if at least one dimension moved or a flag was added, otherwise "".',
    '"newFacts" is for concrete, durable facts about {{user}} worth recalling much later: a name, a stated preference, a piece of backstory, a promise made. Not every line of dialogue. Most turns should add none. Each fact as one short standalone sentence, e.g. "Prefers tea over coffee" or "Promised to visit again next weekend".',
    'Example: {"deltas":{"affection":1,"trust":0,"chemistry":0,"comfort":1,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"Stayed to help clean up without being asked","newFacts":[]}',
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
  return { deltas, newFlags, reason, newFacts }
}

/**
 * Checks whether any locked gallery entries seem to have been earned by the latest moment.
 */
export async function detectGalleryUnlocks(
  client: KoboldClient,
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
  client: KoboldClient,
  params: {
    transcript: ChatMessage[]
    eventTitle: string
    charName: string
    userName: string
    current: RelationshipDeltas
    knownFacts?: string[]
    customFlags?: CustomSceneFlag[]
  },
): Promise<DateOutcome> {
  // Cap at the last 24 turns — plenty for a single date scene, and keeps the prompt bounded even
  // if the player let this run long. Empty messages (still-streaming placeholders) are dropped.
  const turns = params.transcript.filter((m) => m.text.trim()).slice(-24)
  const transcriptText = turns.map((m) => `${m.role === 'user' ? params.userName : params.charName}: ${m.text}`).join('\n')

  const prompt = [
    `You are scoring how an entire date/scene went, in an in-character roleplay: "${params.eventTitle}".`,
    `Current scores (0-100 each): ${DELTA_KEYS.map((k) => `${k}=${params.current[k]}`).join(', ')}.`,
    `Full transcript of the date:\n${transcriptText || '(nothing was said)'}`,
    `Dimension meanings: ${DELTA_KEYS.map((k) => `${k} = ${DIMENSION_GLOSSARY[k]}`).join('; ')}.`,
    `Known route flags: ${describeFlags(params.customFlags)}.`,
    params.knownFacts?.length ? `Facts already remembered (don't repeat these): ${params.knownFacts.join('; ')}.` : '',
    'Return ONLY a minified JSON object: {"deltas":{ one integer -5..5 per dimension key, judged across the WHOLE date, not per line },"newFlags":[ any newly-established flags from the known set, or [] ],"recap":"...","newFacts":[ any new durable facts, or [] ]}.',
    'Judge the date honestly: a flat, awkward, one-sided, or hurtful date should score low or even negative deltas, not a token positive bump just for happening. A genuinely warm, attentive date should score well across the relevant dimensions.',
    '"recap" is a short 1-3 sentence in-world summary of how the date felt from {{char}}\'s side, written for the player to read afterward, not a mechanical report.',
    '"newFacts" is for concrete, durable facts about {{user}} worth recalling much later. Most dates add one or none.',
    'Example: {"deltas":{"affection":3,"trust":2,"chemistry":2,"comfort":1,"respect":0,"curiosity":1,"tension":0},"newFlags":["first_date"],"recap":"She lit up talking about her old bakery and kept finding reasons to lean in closer.","newFacts":["Used to run a small bakery before moving here"]}',
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
  const allowed = allowedFlagIds(params.customFlags)
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
  client: KoboldClient,
  params: {
    characterName: string
    characterDescription?: string
    personaName: string
    worldDescription?: string
    availableBackgrounds: string[]
    affection: number
  },
): Promise<DateEventCard | null> {
  const prompt = [
    'You design a lightweight dating-sim style event card for a roleplay chat.',
    `Character: ${params.characterName}${params.characterDescription ? `. ${params.characterDescription}` : ''}`,
    `User persona: ${params.personaName}`,
    params.worldDescription ? `World context: ${params.worldDescription}` : '',
    `Current affection: ${params.affection}/100`,
    `Available background ids: ${params.availableBackgrounds.join(', ')}`,
    'Return ONLY one minified JSON object:',
    '{"title":"...","description":"...","objectiveTitle":"...","objectiveDescription":"...","backgroundId":"...","kind":"date|gift|milestone"}',
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
    kind: obj.kind === 'gift' || obj.kind === 'milestone' ? obj.kind : 'date',
    affectionRequirement: params.affection,
  }
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
  client: KoboldClient,
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
