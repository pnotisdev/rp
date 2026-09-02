import { KoboldClient } from '@/lib/api/kobold'
import { parseLenientJson } from '@/lib/jsonRepair'
import type { Character } from '@/lib/characters/cardSpec'
import type { DateEventCard, RelationshipDimension, SceneFlag } from '@/lib/types'
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
  tension: 'friction or unresolved conflict — a positive delta here means MORE tension, which is not automatically a bad thing dramatically',
}

const ZERO_DELTAS: RelationshipDeltas = Object.fromEntries(DELTA_KEYS.map((k) => [k, 0])) as RelationshipDeltas

/**
 * Small conservative classifier that estimates whether the latest exchange moved relationship
 * tone, across seven independent dimensions (see `RelationshipDeltaKey`). Most dimensions should
 * stay at 0 on most turns — only the ones this specific exchange clearly touched should move.
 */
export async function assessRelationshipDeltas(
  client: KoboldClient,
  params: {
    history: ChatMessage[]
    latestReply: string
    charName: string
    userName: string
    current: RelationshipDeltas
  },
): Promise<RelationshipDeltas> {
  const prompt = [
    'You are scoring relationship momentum in an in-character roleplay, across several independent dimensions.',
    `Current scores (0-100 each): ${DELTA_KEYS.map((k) => `${k}=${params.current[k]}`).join(', ')}.`,
    `Recent context:\n${recentText(params.history, params.charName, params.userName)}`,
    `Latest reply from ${params.charName}:\n${params.latestReply}`,
    `Dimension meanings: ${DELTA_KEYS.map((k) => `${k} = ${DIMENSION_GLOSSARY[k]}`).join('; ')}.`,
    `Return ONLY a minified JSON object with an integer delta (-2, -1, 0, 1, or 2) for each key: ${DELTA_KEYS.join(', ')}.`,
    'Only move a dimension if this specific exchange clearly affected it — leave the rest at 0. Most turns should only move one or two dimensions.',
    'Example: {"affection":1,"trust":0,"chemistry":0,"comfort":1,"respect":0,"curiosity":0,"tension":0}',
    'JSON:',
  ].join('\n\n')

  const text = await client.generate({ ...REL_PARAMS, max_context_length: await client.getEffectiveMaxContext(), prompt })
  const parsed = parseLenientJson(text)
  if (!parsed || typeof parsed !== 'object') return ZERO_DELTAS
  const obj = parsed as Record<string, unknown>
  const result = { ...ZERO_DELTAS }
  for (const key of DELTA_KEYS) {
    const v = Number(obj[key])
    result[key] = [-2, -1, 0, 1, 2].includes(v) ? v : 0
  }
  return result
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

/** Detects major branching milestones as persistent scene-memory flags. */
export async function detectSceneFlags(
  client: KoboldClient,
  params: { history: ChatMessage[]; latestReply: string; charName: string; userName: string },
): Promise<SceneFlag[]> {
  const known: SceneFlag[] = SCENE_FLAGS
  const prompt = [
    'You track high-level romance route flags in roleplay.',
    `Recent context:\n${recentText(params.history, params.charName, params.userName, 8)}`,
    `Latest reply from ${params.charName}:\n${params.latestReply}`,
    `Return ONLY a minified JSON array of any newly-established flags from this set: ${known.join(', ')}.`,
    'Use [] if none were clearly established in this moment.',
    'JSON:',
  ].join('\n\n')

  const text = await client.generate({
    ...REL_PARAMS,
    max_length: 100,
    temperature: 0.2,
    max_context_length: await client.getEffectiveMaxContext(),
    prompt,
  })
  const parsed = parseLenientJson(text)
  if (!Array.isArray(parsed)) return []
  const allowed = new Set(known)
  return parsed.filter((f): f is SceneFlag => typeof f === 'string' && allowed.has(f as SceneFlag))
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
    `Character: ${params.characterName}${params.characterDescription ? ` — ${params.characterDescription}` : ''}`,
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
