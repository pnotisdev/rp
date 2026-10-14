// Staged AI world drafting: the core setting first, then lorebook batches. Returns a draft; the caller reviews and saves.

import type { ChatBackend } from '@/lib/api/chatBackend'
import { generateWithTimeout, type AssistShaping } from '@/lib/api/generateWithTimeout'
import { ASSIST_SAMPLER, PROSE_STYLE_CORE, writerStyleNote } from '@/lib/characters/aiAssist'
import type { LorebookEntry } from '@/lib/characters/cardSpec'
import { isAbortError } from '@/lib/characters/generateFullCharacter'
import { parseLenientJson } from '@/lib/jsonRepair'

export type WorldStage = 'core' | 'lore'
export type WorldStageStatus = 'start' | 'done' | 'failed'

export const WORLD_STAGE_LABELS: Record<WorldStage, string> = {
  core: 'Setting and rules',
  lore: 'Lorebook entries',
}

export interface DraftLoreEntry {
  title: string
  keys: string[]
  content: string
}

export interface WorldDraft {
  name: string
  description: string
  rules: string
  entries: DraftLoreEntry[]
  failed: { stage: WorldStage; error: string }[]
}

export interface DraftWorldInput {
  brief: string
  /** How many lore entries to aim for. */
  loreCount?: number
  styleGuidance?: string
}

export interface DraftWorldOpts {
  /** Template wrapping for strict chat-template models (see assistShaping.ts). */
  shaping?: AssistShaping,
  signal?: AbortSignal
  onStage?: (stage: WorldStage, status: WorldStageStatus) => void
  /** Fires after each lorebook batch with how many have finished. */
  onBatch?: (done: number, total: number) => void
}

const CATEGORIES = [
  { id: 'places', focus: 'notable places: districts, buildings, landmarks, wild areas' },
  { id: 'people', focus: 'named people and factions, and what each of them wants' },
  { id: 'customs', focus: 'customs, objects, creatures and the rules of daily life' },
  { id: 'history', focus: 'past events that still shape the present' },
]

const JSON_RULES = `Critical JSON rules: output strictly valid JSON. Keep every string value on a single logical line, write \\n for any line break inside a string, never a real newline. Follow every property and array element with a comma unless it is the last one. Straight double quotes only; escape any quote inside a string as \\".`

const abortError = () => new DOMException('The world generation was stopped.', 'AbortError')

/** Splits a lore target into batches small enough for a local model to answer reliably. */
export function planLoreBatches(total: number): { category: (typeof CATEGORIES)[number]; count: number }[] {
  const target = Math.max(0, Math.min(40, Math.round(total)))
  if (target === 0) return []
  const per = target <= 8 ? 4 : 6
  const batches: { category: (typeof CATEGORIES)[number]; count: number }[] = []
  let left = target
  for (let i = 0; left > 0; i++) {
    const count = Math.min(per, left)
    batches.push({ category: CATEGORIES[i % CATEGORIES.length], count })
    left -= count
  }
  return batches
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function coreFrom(raw: unknown): { name: string; description: string; rules: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Model did not return a JSON object for the setting')
  const o = raw as Record<string, unknown>
  const rules = Array.isArray(o.rules) ? o.rules.filter((r): r is string => typeof r === 'string').join('\n') : text(o.rules, 3000)
  const description = Array.isArray(o.description) ? o.description.filter((p): p is string => typeof p === 'string').map((p) => p.trim()).filter(Boolean).join('\n\n') : text(o.description, 6000)
  const core = { name: text(o.name, 120), description, rules: rules.trim() }
  if (!core.description) throw new Error('Model did not write a description for the setting')
  return core
}

const keyOf = (k: string) => k.trim().toLowerCase()

/** Parses one lore batch, dropping unusable entries and any that only repeat keys already used. */
export function entriesFrom(raw: unknown, taken: Set<string>): DraftLoreEntry[] {
  if (!Array.isArray(raw)) throw new Error('Model did not return a JSON array of lore entries')
  const out: DraftLoreEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    const content = text(e.content, 1500)
    const keys = (Array.isArray(e.keys) ? e.keys : [])
      .filter((k): k is string => typeof k === 'string' && k.trim() !== '')
      .map((k) => k.trim().slice(0, 60))
      .slice(0, 8)
    if (!content || keys.length === 0) continue
    if (keys.every((k) => taken.has(keyOf(k)))) continue
    for (const k of keys) taken.add(keyOf(k))
    out.push({ title: text(e.title, 80) || text(e.comment, 80) || keys[0], keys, content })
  }
  return out
}

export function toLorebookEntries(drafts: DraftLoreEntry[], startId = 1): LorebookEntry[] {
  return drafts.map((d, i) => ({
    id: startId + i,
    keys: d.keys,
    comment: d.title,
    content: d.content,
    constant: false,
    selective: false,
    insertion_order: 100,
    enabled: true,
    position: 'before_char' as const,
    activationMode: 'keyword' as const,
  }))
}

export async function draftWorld(client: ChatBackend, input: DraftWorldInput, opts: DraftWorldOpts = {}): Promise<WorldDraft> {
  const { signal, onStage, onBatch, shaping } = opts
  const brief = input.brief.trim()
  if (!brief) throw new Error('Describe the world you want first.')
  const throwIfAborted = () => {
    if (signal?.aborted) throw abortError()
  }
  const style = writerStyleNote(input.styleGuidance)
  const failed: WorldDraft['failed'] = []

  throwIfAborted()
  onStage?.('core', 'start')
  let core: ReturnType<typeof coreFrom>
  try {
    const prompt = [
      'You are designing a setting for a roleplay app. Take the brief as the seed and fill in what it leaves open.',
      `Brief: ${brief}`,
      `Output ONLY a single JSON object with exactly these keys:
- "name": string. A memorable name for the world or its main location.
- "description": array of two to four strings, one short paragraph each: where and when this is, the tone, what daily life is like, what makes it distinct. Concrete details over general impressions.
- "rules": array of four to eight short strings, one hard constraint each: how magic or technology works, what is impossible, social taboos.`,
      PROSE_STYLE_CORE,
      style,
      JSON_RULES,
      'JSON:',
    ]
      .filter(Boolean)
      .join('\n\n')
    const out = await generateWithTimeout(
      client,
      { prompt, max_length: 900, max_context_length: await client.getEffectiveMaxContext(), ...ASSIST_SAMPLER, stop_sequence: ['\n\n\n', '```'], trim_stop: true },
      'Draft world',
      signal,
      shaping,
    )
    core = coreFrom(parseLenientJson(out))
    if (!core.name) core.name = brief.slice(0, 40)
    onStage?.('core', 'done')
  } catch (e) {
    onStage?.('core', 'failed')
    throw e
  }

  const entries: DraftLoreEntry[] = []
  const taken = new Set<string>()
  const batches = planLoreBatches(input.loreCount ?? 16)
  if (batches.length) {
    throwIfAborted()
    onStage?.('lore', 'start')
    let lastError = ''
    for (const [index, batch] of batches.entries()) {
      throwIfAborted()
      try {
        const known = entries.map((e) => e.title)
        const prompt = [
          'You are writing lorebook entries for a roleplay setting. Each entry is a short, self-contained fact that is added to the prompt only when someone mentions one of its keys.',
          `Setting:\nName: ${core.name}\nDescription: ${core.description}${core.rules ? `\nRules: ${core.rules}` : ''}`,
          known.length ? `Already written (do not repeat or contradict): ${known.join('; ')}` : '',
          `Write ${batch.count} entries about ${batch.category.focus}.`,
          `Output ONLY a JSON array of ${batch.count} objects shaped exactly {"title": "short label", "keys": ["word or phrase"], "content": "40 to 80 words of plain prose"}. Give each entry 3 to 6 keys: names and words a player would actually type. One idea per entry. No markdown fences, no commentary.`,
          PROSE_STYLE_CORE,
          style,
          JSON_RULES,
          'JSON:',
        ]
          .filter(Boolean)
          .join('\n\n')
        const out = await generateWithTimeout(
          client,
          { prompt, max_length: batch.count * 150 + 200, max_context_length: await client.getEffectiveMaxContext(), ...ASSIST_SAMPLER, stop_sequence: ['\n\n\n', '```'], trim_stop: true },
          'Draft world lore',
          signal,
          shaping,
        )
        entries.push(...entriesFrom(parseLenientJson(out), taken))
      } catch (e) {
        if (isAbortError(e) || signal?.aborted) throw e
        lastError = e instanceof Error ? e.message : String(e)
      }
      onBatch?.(index + 1, batches.length)
    }
    if (entries.length === 0 && lastError) {
      failed.push({ stage: 'lore', error: lastError })
      onStage?.('lore', 'failed')
    } else {
      onStage?.('lore', 'done')
    }
  }

  return { ...core, entries, failed }
}
