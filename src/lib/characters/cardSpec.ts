// SillyTavern-compatible character card types (chara_card_v2 spec), so cards
// exported from/imported into SillyTavern round-trip without loss.
// https://github.com/malfoyslastname/character-card-spec-v2

import type { TtsProviderId } from '@/lib/voice/ttsProviders'

export type WorldInfoActivationMode = 'always' | 'keyword' | 'manual'

export interface RelationshipStarter {
  id: string
  /** Short picker label, e.g. "Childhood friends". */
  label: string
  /** Seeds the chat's long-term memory (`Chat.summary`) so the model has this backstory from message one. */
  blurb: string
  startingAffection: number
}

export interface GalleryEntry {
  id: string
  title: string
  imageUrl: string
  unlockAffection: number
  unlockHint?: string
  requiredFlags?: string[]
}

export interface LorebookEntry {
  id?: number
  keys: string[]
  secondary_keys?: string[]
  comment?: string
  content: string
  constant: boolean
  selective: boolean
  insertion_order: number
  enabled: boolean
  position?: 'before_char' | 'after_char'
  case_sensitive?: boolean
  /** Not part of the upstream spec — mirrors ST's always/when-relevant/manual radio. Kept in sync with `constant`. */
  activationMode?: WorldInfoActivationMode
  extensions?: Record<string, unknown>
}

export interface Lorebook {
  name?: string
  description?: string
  scan_depth?: number
  token_budget?: number
  recursive_scanning?: boolean
  extensions?: Record<string, unknown>
  entries: LorebookEntry[]
}

export interface CharacterCardData {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  creator_notes?: string
  system_prompt?: string
  post_history_instructions?: string
  alternate_greetings?: string[]
  character_book?: Lorebook
  tags?: string[]
  creator?: string
  character_version?: string
  extensions?: Record<string, unknown>
}

export interface CharacterCardV2 {
  spec: 'chara_card_v2'
  spec_version: '2.0'
  data: CharacterCardData
}

/** Our internal record: the spec card plus local-only bookkeeping fields. */
export interface Character {
  id: string
  card: CharacterCardData
  avatarDataUrl?: string
  /** The world this character lives in, if any — not part of the portable card spec, so it lives here rather than on `card`. */
  worldId?: string
  /** Expression art keyed by id (src/lib/vn/expressions.ts) — falls back to the main avatar when missing. */
  sprites?: Record<string, string>
  /** Minimum affection required before an expression sprite can be selected/displayed. */
  spriteUnlocks?: Record<string, number>
  /** Gift preference score per gift id (-2..3) used by the gift economy to affect relationship gain. */
  giftPreferences?: Record<string, number>
  /** Unlockable CG-like gallery entries for this character. */
  gallery?: GalleryEntry[]
  /** Optional narrative starting points offered when creating a new chat with this character. */
  relationshipStarters?: RelationshipStarter[]
  /** Per-character TTS override — unset fields fall back to the global Settings → Voice config. */
  voice?: { provider?: TtsProviderId; voiceId?: string }
  createdAt: number
  updatedAt: number
}

export function blankCharacterData(name = 'New Character'): CharacterCardData {
  return {
    name,
    description: '',
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    tags: [],
    creator: '',
    character_version: '',
    extensions: {},
  }
}

export function wrapCardV2(data: CharacterCardData): CharacterCardV2 {
  return { spec: 'chara_card_v2', spec_version: '2.0', data }
}

/**
 * Accepts a V2 card ({spec,data}), a V3-ish card (same shape, spec_version 3.0),
 * or a legacy flat V1 card (fields at top level) and normalizes to our data shape.
 */
export function normalizeCardJson(raw: unknown): CharacterCardData {
  if (!raw || typeof raw !== 'object') throw new Error('Character JSON is not an object')
  const obj = raw as Record<string, unknown>
  const source = (obj.data && typeof obj.data === 'object' ? obj.data : obj) as Record<
    string,
    unknown
  >

  const name = str(source.name) || 'Imported Character'
  return {
    name,
    description: strLenient(source.description),
    personality: strLenient(source.personality),
    scenario: strLenient(source.scenario),
    first_mes: strLenient(source.first_mes),
    mes_example: strLenient(source.mes_example),
    creator_notes: strLenient(source.creator_notes),
    system_prompt: strLenient(source.system_prompt),
    post_history_instructions: strLenient(source.post_history_instructions),
    alternate_greetings: Array.isArray(source.alternate_greetings)
      ? (source.alternate_greetings as string[])
      : [],
    character_book: normalizeLorebook(source.character_book),
    tags: Array.isArray(source.tags) ? (source.tags as string[]) : [],
    creator: str(source.creator),
    character_version: str(source.character_version),
    extensions: (source.extensions as Record<string, unknown>) ?? {},
  }
}

function normalizeLorebook(raw: unknown): Lorebook | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const entriesRaw = obj.entries
  const entries: LorebookEntry[] = []
  const pushEntry = (e: Record<string, unknown>, fallbackId: number) => {
    const constant = !!e.constant
    const activationMode: WorldInfoActivationMode =
      (e.activationMode as WorldInfoActivationMode) ?? (constant ? 'always' : 'keyword')
    entries.push({
      id: typeof e.id === 'number' ? e.id : fallbackId,
      keys: Array.isArray(e.keys) ? (e.keys as string[]) : Array.isArray(e.key) ? (e.key as string[]) : [],
      secondary_keys: Array.isArray(e.secondary_keys) ? (e.secondary_keys as string[]) : [],
      comment: str(e.comment),
      content: str(e.content),
      constant,
      selective: !!e.selective,
      insertion_order: typeof e.insertion_order === 'number' ? e.insertion_order : 100,
      enabled: e.enabled === undefined ? !(e.disable === true) : !!e.enabled,
      position: e.position === 'after_char' ? 'after_char' : 'before_char',
      case_sensitive: !!e.case_sensitive,
      activationMode,
      extensions: (e.extensions as Record<string, unknown>) ?? {},
    })
  }
  if (Array.isArray(entriesRaw)) {
    entriesRaw.forEach((e, i) => pushEntry(e as Record<string, unknown>, i))
  } else if (entriesRaw && typeof entriesRaw === 'object') {
    // Some exports key entries by id in an object map rather than an array.
    Object.values(entriesRaw as Record<string, unknown>).forEach((e, i) =>
      pushEntry(e as Record<string, unknown>, i),
    )
  }
  return {
    name: str(obj.name),
    description: str(obj.description),
    scan_depth: typeof obj.scan_depth === 'number' ? obj.scan_depth : 100,
    token_budget: typeof obj.token_budget === 'number' ? obj.token_budget : 512,
    recursive_scanning: !!obj.recursive_scanning,
    extensions: (obj.extensions as Record<string, unknown>) ?? {},
    entries,
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Same as str(), but tolerates a model returning an array of strings instead of one string (a common mistake for fields like mes_example). */
function strLenient(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join('\n\n')
  return ''
}
