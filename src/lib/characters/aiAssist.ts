import type { CharacterCardData, LorebookEntry } from './cardSpec'
import type { ChatBackend } from '@/lib/api/chatBackend'
import { parseLenientJson } from '@/lib/jsonRepair'

const FIELD_LABELS: Record<string, string> = {
  description: 'Description (appearance, background)',
  personality: 'Personality (how they speak, act, feel)',
  scenario: 'Scenario (the current setting)',
}

/** Anything AI-assist can ground a suggestion in — a character card, a world card, or anything else with a name + some free text. */
export interface AiLoreSubject {
  name: string
  description?: string
  personality?: string
  scenario?: string
  /** Extra free-text context with no fixed slot elsewhere (e.g. a world's "rules" field). */
  extra?: string
}

function contextSummary(subject: AiLoreSubject, omitField?: string): string {
  const lines = [`Name: ${subject.name}`]
  if (omitField !== 'description' && subject.description?.trim())
    lines.push(`Description: ${subject.description.trim()}`)
  if (omitField !== 'personality' && subject.personality?.trim())
    lines.push(`Personality: ${subject.personality.trim()}`)
  if (omitField !== 'scenario' && subject.scenario?.trim())
    lines.push(`Scenario: ${subject.scenario.trim()}`)
  if (subject.extra?.trim()) lines.push(subject.extra.trim())
  return lines.join('\n')
}

/** Rewrites a single card field (keeping it consistent with the rest), rather than the whole card. */
export async function regenerateCardField(
  client: ChatBackend,
  character: CharacterCardData,
  fieldKey: 'description' | 'personality' | 'scenario',
  hint?: string,
): Promise<string> {
  const label = FIELD_LABELS[fieldKey]
  const context = contextSummary(
    { ...character, extra: character.first_mes?.trim() ? `First message: ${character.first_mes.trim()}` : undefined },
    fieldKey,
  )
  const prompt = [
    'You are helping write a character card for a roleplay app.',
    `Character so far:\n${context}`,
    `Rewrite ONLY the "${label}" field so it fits well with everything above.${hint ? ` Guidance: ${hint.trim()}` : ''}`,
    'Output just the new field text. No label, no quotes, no commentary, no markdown.',
    `${label}:`,
  ].join('\n\n')

  const text = await client.generate({
    prompt,
    max_length: 300,
    max_context_length: await client.getEffectiveMaxContext(),
    temperature: 0.85,
    top_p: 0.95,
    top_k: 0,
    min_p: 0.05,
    typical: 1,
    tfs: 1,
    rep_pen: 1.1,
    rep_pen_range: 1024,
    rep_pen_slope: 0.7,
    stop_sequence: ['\n\n\n'],
    trim_stop: true,
  })
  return text.trim()
}

export interface SuggestedLoreEntry {
  keys: string[]
  content: string
}

/** Proposes new world-info entries grounded in a character or world card, avoiding whatever's already in the book. */
export async function suggestLoreEntries(
  client: ChatBackend,
  subject: AiLoreSubject,
  existingEntries: LorebookEntry[],
  count = 3,
): Promise<SuggestedLoreEntry[]> {
  const context = contextSummary(subject)
  const existingKeys = existingEntries.flatMap((e) => e.keys).join(', ')
  const prompt = [
    'You are helping write World Info / lorebook entries for a roleplay app.',
    `Subject:\n${context}`,
    existingKeys ? `Lore already covered (don't repeat these): ${existingKeys}` : '',
    `Propose ${count} new lore entries: relationships, locations, important past events, or rules that would help an AI stay consistent when roleplaying in this context.`,
    `Output ONLY a minified JSON array of ${count} objects, each shaped exactly {"keys": ["keyword1","keyword2"], "content": "1-3 sentences of plain prose"}. 2-3 keywords per entry that would plausibly come up in conversation. No markdown fences, no commentary.`,
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await client.generate({
    prompt,
    max_length: 600,
    max_context_length: await client.getEffectiveMaxContext(),
    temperature: 0.8,
    top_p: 0.95,
    top_k: 0,
    min_p: 0.05,
    typical: 1,
    tfs: 1,
    rep_pen: 1.1,
    rep_pen_range: 1024,
    rep_pen_slope: 0.7,
    stop_sequence: ['\n\n\n', '```'],
    trim_stop: true,
  })

  const parsed = parseLenientJson(text)
  if (!Array.isArray(parsed)) throw new Error('Model did not return a JSON array of lore entries')
  return parsed
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      keys: Array.isArray(e.keys) ? e.keys.filter((k): k is string => typeof k === 'string') : [],
      content: typeof e.content === 'string' ? e.content : '',
    }))
    .filter((e) => e.keys.length > 0 && e.content.trim())
}
