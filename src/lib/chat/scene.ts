import type { ChatBackend } from '@/lib/api/chatBackend'
import type { Character } from '@/lib/characters/cardSpec'
import type { ChatMessage } from '@/lib/prompt/builder'
import type { Scene } from '@/lib/types'

/**
 * The roster a turn policy chooses among, in a fixed order — the primary first, then participants
 * in whatever order `Chat.participants` lists them. Every policy function below takes this exact
 * shape so none of them need to know how it was assembled.
 */
export type SceneRoster = { id: string; name: string }[]

export function rosterFrom(character: Character | undefined, participantCharacters: Character[]): SceneRoster {
  const primary = character ? [{ id: character.id, name: character.card.name }] : []
  return [...primary, ...participantCharacters.map((c) => ({ id: c.id, name: c.card.name }))]
}

/**
 * Round-robin's own bookkeeping is a plain array index, which the roster can silently outgrow or
 * shrink past (a participant removed, or the character list re-ordered) — modulo rather than
 * trusting it keeps this from ever producing an out-of-range pick or throwing.
 */
export function nextRoundRobinSpeaker(roster: SceneRoster, index: number | undefined): { id: string; nextIndex: number } | undefined {
  if (roster.length === 0) return undefined
  const i = ((index ?? 0) % roster.length + roster.length) % roster.length
  return { id: roster[i].id, nextIndex: (i + 1) % roster.length }
}

/**
 * SillyTavern's own group-chat convention: `@Name` in the player's own message routes the reply to
 * that character. Longest-name-first so "Aria" doesn't shadow a match for "Aria Kestrel" mentioned
 * in full, and a name is only matched at a word boundary so "@Ari" doesn't accidentally hit "Aria".
 */
export function parseMention(text: string, roster: SceneRoster): SceneRoster[number] | undefined {
  const sorted = [...roster].sort((a, b) => b.name.length - a.name.length)
  for (const entry of sorted) {
    const escaped = entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`@${escaped}\\b`, 'i')
    if (re.test(text)) return entry
  }
  return undefined
}

const DIRECTOR_PARAMS = {
  max_length: 20,
  temperature: 0.2,
  top_p: 1,
  top_k: 0,
  min_p: 0,
  typical: 1,
  tfs: 1,
  rep_pen: 1.0,
  stop_sequence: ['\n'],
  trim_stop: true,
}

/**
 * The `'director'` turn policy: a cheap classification call (same "model plays the character,
 * plain code decides what to do with it" shape as `assessRelationshipMoment`) picks who in the
 * roster would naturally respond to what the player just said. Deliberately tiny — a name, nothing
 * else — and never blocks or fails the actual reply: any parse/network failure resolves to
 * `undefined`, which every call site treats as "fall back to the primary."
 */
export async function pickDirectorSpeaker(
  client: ChatBackend,
  params: {
    roster: SceneRoster
    history: ChatMessage[]
    userName: string
    sceneLocation?: string
  },
): Promise<string | undefined> {
  if (params.roster.length <= 1) return params.roster[0]?.id
  const names = params.roster.map((r) => r.name)
  const recent = params.history
    .slice(-6)
    .filter((m) => m.text.trim())
    .map((m) => `${m.role === 'user' ? params.userName : m.name}: ${m.text}`)
    .join('\n')
  const locationLine = params.sceneLocation ? `Setting: ${params.sceneLocation}\n` : ''
  const prompt = [
    `You are directing a group scene with these characters present: ${names.join(', ')}.`,
    locationLine,
    'Recent conversation:',
    recent || '(nothing said yet)',
    '',
    `Given what ${params.userName} just said, which one character would most naturally respond next?`,
    `Answer with exactly one name from this list, nothing else: ${names.join(', ')}.`,
    'Name:',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const text = await client.generate({
      ...DIRECTOR_PARAMS,
      max_context_length: await client.getEffectiveMaxContext(4096),
      prompt,
    })
    const answer = text.trim().toLowerCase()
    // Exact match first, then "the answer starts with/contains a real name" as a looser fallback
    // for a model that adds punctuation or a stray word despite the instruction.
    const exact = params.roster.find((r) => r.name.toLowerCase() === answer)
    if (exact) return exact.id
    const loose = params.roster.find((r) => answer.includes(r.name.toLowerCase()))
    return loose?.id
  } catch {
    return undefined
  }
}
