/**
 * 10b's "live feedback during the scene" — a rapport-trajectory read shown while a live date is
 * running. Per-turn relationship *scoring* is deliberately suppressed for the whole date (its
 * outcome is judged once at the end); this is the qualitative counterpart, so the player can feel
 * how a scene is trending without a number moving or the end result being spoiled.
 *
 * `assessRapport` is a cheap, stateless judge call: it reads the last few turns of the date and
 * returns one label, nothing else. It never touches affection or the tracked dimensions.
 */

import type { ChatBackend } from '@/lib/api/chatBackend'
import { parseLenientJson } from '@/lib/jsonRepair'
import type { ChatMessage } from '@/lib/prompt/builder'
import type { RapportRead, RapportTrajectory } from '@/lib/types'

export type { RapportRead, RapportTrajectory }

interface RapportSpec {
  /** Short phrase shown to the player, character-relative. */
  label: string
  /** Direction of travel — drives the glyph and colour. */
  tone: 'up' | 'up-strong' | 'flat' | 'down' | 'down-strong'
  /** How the judge is told to pick this one. */
  judgeHint: string
}

export const RAPPORT_READS: Record<RapportTrajectory, RapportSpec> = {
  lighting_up: {
    label: 'lighting up',
    tone: 'up-strong',
    judgeHint: 'clearly delighted — leaning in, initiating, visibly enjoying this',
  },
  warming: {
    label: 'warming to you',
    tone: 'up',
    judgeHint: 'opening up, softening, the conversation is flowing better than it started',
  },
  at_ease: {
    label: 'at ease',
    tone: 'flat',
    judgeHint: 'comfortable and steady — neither pulling closer nor away, just present',
  },
  pulling_back: {
    label: 'pulling back',
    tone: 'down',
    judgeHint: 'getting shorter, more guarded, or politely disengaging; the energy is dropping',
  },
  on_edge: {
    label: 'on edge',
    tone: 'down-strong',
    judgeHint: 'irritated, hurt, or genuinely uncomfortable; this could tip into them ending the date',
  },
}

export const RAPPORT_TRAJECTORIES = Object.keys(RAPPORT_READS) as RapportTrajectory[]

export function isRapportTrajectory(v: unknown): v is RapportTrajectory {
  return typeof v === 'string' && (RAPPORT_TRAJECTORIES as string[]).includes(v)
}

const RAPPORT_PARAMS = {
  max_length: 90,
  temperature: 0.3,
  top_p: 1,
  top_k: 0,
  min_p: 0,
  typical: 1,
  tfs: 1,
  rep_pen: 1.05,
  rep_pen_range: 512,
  rep_pen_slope: 0,
  // `\n\n\n` (not `\n\n`) matches the other judge calls — a model that opens with a stray blank
  // line shouldn't have its whole answer swallowed by the stop sequence.
  stop_sequence: ['\n\n\n', '```'],
  trim_stop: true,
}

/**
 * Reads how the date is trending from its last few turns. Returns null on any parse/connection
 * failure — the caller just keeps showing the previous read rather than flashing an error mid-scene.
 */
export async function assessRapport(
  client: ChatBackend,
  params: {
    /** The date's own transcript so far, oldest first — the caller passes a short tail, not the whole thing. */
    transcript: ChatMessage[]
    charName: string
    userName: string
    charPersonality?: string
  },
): Promise<Omit<RapportRead, 'updatedAt'> | null> {
  const turns = params.transcript.filter((m) => m.text.trim()).slice(-8)
  if (turns.length === 0) return null
  const transcriptText = turns
    .map((m) => `${m.role === 'user' ? params.userName : params.charName}: ${m.text}`)
    .join('\n')

  const prompt = [
    `You are reading the mood of a date between ${params.userName} and ${params.charName}, from ${params.charName}'s side.`,
    params.charPersonality ? `${params.charName}'s personality: ${params.charPersonality}` : '',
    `Read past the surface: a guarded or teasing character can still be enjoying themselves. Judge the trend across these turns, not just the last line.`,
    `Recent turns:\n${transcriptText}`,
    `Pick the ONE label that fits how ${params.charName} is trending right now:`,
    RAPPORT_TRAJECTORIES.map((id) => `- ${id}: ${RAPPORT_READS[id].judgeHint}`).join('\n'),
    `Also decide "walkOut": true ONLY if ${params.userName}'s latest turn is a genuine dealbreaker a reasonable person would leave over right now — overt hostility, cruelty, or an explicit/crude proposition. false for ordinary friction, awkwardness, a bad joke, or garden-variety "on_edge" tension. This should be rare.`,
    'Return ONLY a minified JSON object: {"trajectory":"<one label>","note":"<3-8 word in-world observation>","walkOut":true|false}.',
    'Example: {"trajectory":"warming","note":"her lecturing has lost its edge","walkOut":false}',
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  let text: string
  try {
    text = await client.generate({
      ...RAPPORT_PARAMS,
      max_context_length: await client.getEffectiveMaxContext(),
      prompt,
    })
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = parseLenientJson(text)
  } catch {
    return null
  }
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  if (!isRapportTrajectory(obj.trajectory)) return null
  const note = typeof obj.note === 'string' && obj.note.trim() ? obj.note.trim().slice(0, 120) : undefined
  return { trajectory: obj.trajectory, note, walkOut: obj.walkOut === true }
}
