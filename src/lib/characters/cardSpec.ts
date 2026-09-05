// SillyTavern-compatible character card types (chara_card_v2 spec), so cards
// exported from/imported into SillyTavern round-trip without loss.
// https://github.com/malfoyslastname/character-card-spec-v2

import type { TtsProviderId } from '@/lib/voice/ttsProviders'
import type { ReplyLength } from '@/lib/characters/voice'
import type { ScheduleEntry, WeatherPreferences } from '@/lib/world/calendar'
import { DEFAULT_EXPRESSION_IDS, type CustomExpression } from '@/lib/vn/expressions'
import type { Outfit } from '@/lib/vn/outfits'

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
  /** A once-per-relationship epilogue (10c's "Endings gallery") — unlocks the moment warmth reaches the top "sweethearts" stage, not through `unlockAffection`/story-beat detection like an ordinary CG. */
  isEnding?: boolean
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
  position?: 'before_char' | 'after_char' | 'at_depth'
  /** Only meaningful when `position` is `'at_depth'` — how many messages up from the latest to sit, same convention as `AuthorNote.depth`. 0 = immediately before the model replies. */
  depth?: number
  case_sensitive?: boolean
  /** Not part of the upstream spec — mirrors ST's always/when-relevant/manual radio. Kept in sync with `constant`. */
  activationMode?: WorldInfoActivationMode
  /** 0-100 — a keyword match only fires this often even when otherwise matched. Doesn't apply to always/manual entries (see activation.ts). */
  probability?: number
  /** Entries sharing a non-empty group name are mutually exclusive — only one match in the group fires. */
  group?: string
  /** Optional weighted-random pick within a `group`, mirroring ST — if ANY entry in the group sets this, the winner is a weighted random draw across the whole group (unset weight defaults to 1) instead of the deterministic highest-`insertion_order`-wins rule that applies when no entry in the group sets it. */
  groupWeight?: number
  /** ST's "sticky": once a keyword-mode entry activates, it stays force-active for this many further turns even if the keyword stops appearing. 0/undefined = off. */
  sticky?: number
  /** ST's "cooldown": after a keyword-mode entry deactivates, it can't reactivate by keyword for this many turns. 0/undefined = off. */
  cooldown?: number
  /** ST's "delay": the entry can't activate at all until the chat has at least this many messages. 0/undefined = off. Applies to every activation mode. */
  delay?: number
  extensions?: Record<string, unknown>
}

export interface Lorebook {
  name?: string
  description?: string
  scan_depth?: number
  token_budget?: number
  recursive_scanning?: boolean
  /** A stable id for this book across turns, set by the caller assembling the merged book list — the composite `${sourceKey}:${entry.id}` is what per-entry runtime state (sticky/cooldown) is keyed on, since `entry.id` alone is only unique within one book. */
  sourceKey?: string
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
  /**
   * Expression art — falls back to the main avatar when missing. Keyed by expression id
   * (src/lib/vn/expressions.ts) for the base outfit, or `<outfitId>--<expressionId>` for one of
   * `outfits` below (src/lib/vn/outfits.ts). A character authored before outfits existed uses
   * only bare keys, which is exactly the base outfit — hence no migration.
   */
  sprites?: Record<string, string>
  /** Minimum affection required before an expression sprite can be selected/displayed. Keyed the same way as `sprites`, so an individual outfit's expression can carry its own threshold. */
  spriteUnlocks?: Record<string, number>
  /** Wardrobe states beyond the base art (src/lib/vn/outfits.ts). The base outfit is implicit and never listed here. */
  outfits?: Outfit[]
  /** Expression slots beyond the built-in default set (src/lib/vn/expressions.ts) — e.g. a signature expression unique to this character. Their sprites/unlocks live in the same `sprites`/`spriteUnlocks` maps as any default expression. */
  customExpressions?: CustomExpression[]
  /** Gift preference score per gift id (-2..3) used by the gift economy to affect relationship gain. */
  giftPreferences?: Record<string, number>
  /**
   * Authored gift taste (10d's "Authored reactions") — richer than the numeric `giftPreferences`
   * score above, which only ever drives the affection delta, never the model's own reaction text.
   * Free text rather than a fixed catalog, so it reads naturally in a fed-in prompt line and isn't
   * limited to gifts already in the catalog (a character can love "anything handmade" in general).
   */
  giftLikes?: string[]
  giftDislikes?: string[]
  /** Free text — how this character feels most loved/appreciated, e.g. "quality time" or "acts of service". */
  loveLanguage?: string
  /** Unlockable CG-like gallery entries for this character. */
  gallery?: GalleryEntry[]
  /** Optional narrative starting points offered when creating a new chat with this character. */
  relationshipStarters?: RelationshipStarter[]
  /** Per-character TTS override — unset fields fall back to the global Settings → Voice config. */
  voice?: { provider?: TtsProviderId; voiceId?: string }
  /** Extra comic sound-effect words this character's messages get the manga-style "burst" styling on, beyond the built-in list — e.g. "nya", "mrrp" for a catgirl, or an imouto's own vocalisations. Display-only; never sent to the model. */
  sfxWords?: string[]
  /** Per-character instruct-template override (builtin or custom id) — unset falls back to the global Settings → Generation default. */
  instructTemplateId?: string
  /**
   * How long this character's replies should run (src/lib/characters/voice.ts). Unset / 'auto'
   * measures the card's own `mes_example` turn length and both instructs and hard-caps `max_length`
   * to it, so a terse card stops getting essay-length replies; 'brief'/'moderate'/'detailed' are an
   * explicit override for a card whose examples are unrepresentative or missing.
   */
  replyLength?: ReplyLength
  /** Weather this character loves/hates (src/lib/world/calendar.ts) — nudges the world-moment prompt line, never dictates it. */
  weatherPreferences?: WeatherPreferences
  /** Daily/weekly routine (src/lib/world/calendar.ts) — where they are and what they're doing at a given world day/phase. Only meaningful for a world-bound character, since it reads the world's shared clock. */
  schedule?: ScheduleEntry[]
  /** General interests/hobbies — distinct from `giftLikes` (gift-shopping taste specifically). Free text so it reads naturally in a fed-in prompt line. */
  likes?: string[]
  /** What this character wants or is working toward — motivations, not just personality color. */
  goals?: string[]
  /** Hard limits — things this character won't do or won't tolerate, in character. Informational for the model, not itself an enforcement mechanism (see `dateModeOptOut` for the one boundary this app actually gates mechanically). */
  boundaries?: string[]
  /** Who this character knows and how (10e's "social connections") — reaches the prompt as a compact roster line, the same idea as the group-chat participant roster but for people who aren't actually in the scene. */
  socialConnections?: SocialConnection[]
  /** Job title/role, e.g. "barista" or "second-year architecture student". */
  occupation?: string
  /** Where they work/study, distinct from `occupation` (the role) — e.g. "Sakura Hill University". */
  workplace?: string
  /** Where they live, e.g. "a small apartment near the station". */
  homeLocation?: string
  /** Places they're often found beyond home/work — cafes, parks, a favorite bench. */
  frequentedLocations?: string[]
  /** Content/feature flag (10e): excludes this character from the date/event system entirely — the "reaching for a boundary" case a numeric affection gate can't express, since it's an authorial opt-out rather than something that unlocks with more warmth. */
  dateModeOptOut?: boolean
  /** How often this character might text the player first, unprompted (10f's proactive outreach) — an authored trait, not a global timer. Unset behaves as 'never' so shipping this doesn't retroactively change any already-scheduled character's behavior. */
  outreach?: { frequency: OutreachFrequency }
  createdAt: number
  updatedAt: number
}

/** 10f: how readily a character initiates unprompted contact. A character that never reaches out is a valid, intentional choice, not a missing feature. */
export type OutreachFrequency = 'never' | 'rare' | 'normal' | 'eager'

export interface SocialConnection {
  id: string
  name: string
  /** How they know each other, e.g. "childhood friend", "older sister", "rival from the debate club". */
  relation: string
  notes?: string
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
      position: e.position === 'after_char' || e.position === 'at_depth' ? e.position : 'before_char',
      depth: typeof e.depth === 'number' && e.depth >= 0 ? e.depth : undefined,
      case_sensitive: !!e.case_sensitive,
      activationMode,
      // ST only honors `probability` when `useProbability` is explicitly true; absent entirely,
      // treat it the same as "no probability set" (always passes) rather than silently dropping it.
      probability:
        typeof e.probability === 'number' && e.useProbability !== false ? e.probability : undefined,
      group: typeof e.group === 'string' && e.group.trim() ? e.group : undefined,
      groupWeight: typeof e.groupWeight === 'number' && e.groupWeight >= 0 ? e.groupWeight : undefined,
      // ST calls these `sticky` / `cooldown` too — copy them straight through when present.
      sticky: typeof e.sticky === 'number' && e.sticky > 0 ? Math.floor(e.sticky) : undefined,
      cooldown: typeof e.cooldown === 'number' && e.cooldown > 0 ? Math.floor(e.cooldown) : undefined,
      delay: typeof e.delay === 'number' && e.delay > 0 ? Math.floor(e.delay) : undefined,
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

/**
 * Character Card V3 (`chara_card_v3`) standardises embedded art in a `data.assets` array —
 * `{ type, uri, name, ext }` per asset. This pulls the parts we can actually use out of a card
 * being imported: the `icon` asset as a portrait, and `emotion` assets as expression sprites
 * (keyed by our expression id — with a few common aliases mapped, and anything unrecognised kept
 * as a custom expression so it still gets an editor slot). `ccdefault:` and `embeded://` URIs are
 * skipped — neither resolves from a plain card file (the former means "use the card's own image",
 * already handled for PNG imports; the latter needs the CHARX zip container we don't read).
 * `http:` is skipped too; only `data:` and `https:` art is taken.
 */
const CCV3_USABLE_URI = /^(data:|https:\/\/)/i

/** V3 emotion names that don't line up 1:1 with our expression ids (src/lib/vn/expressions.ts). */
const V3_EMOTION_ALIASES: Record<string, string> = {
  joy: 'happy',
  joyful: 'happy',
  smile: 'happy',
  smiling: 'happy',
  anger: 'angry',
  mad: 'angry',
  fear: 'scared',
  afraid: 'scared',
  fearful: 'scared',
  disgust: 'annoyed',
  disgusted: 'annoyed',
  sadness: 'sad',
  unhappy: 'sad',
  surprise: 'surprised',
  shock: 'surprised',
  shocked: 'surprised',
  embarrassment: 'embarrassed',
  shy: 'blush',
  bashful: 'blush',
  adoration: 'love',
  loving: 'love',
  normal: 'neutral',
  default: 'neutral',
  amusement: 'laughing',
  laugh: 'laughing',
  thoughtful: 'thinking',
  pensive: 'thinking',
  tired: 'sleepy',
  sleep: 'sleepy',
}

function slugEmotion(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}

export interface CardAssets {
  /** From an `icon` asset — only set when the card carried a usable inline/https portrait. */
  avatarDataUrl?: string
  /** expression id -> image URI, from `emotion` assets. */
  sprites?: Record<string, string>
  /** Expression ids not in the built-in set — so the editor grid still shows a slot for them. */
  customExpressions?: CustomExpression[]
}

export function extractCardAssets(raw: unknown): CardAssets {
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  const data = (obj.data && typeof obj.data === 'object' ? obj.data : obj) as Record<string, unknown>
  if (!Array.isArray(data.assets)) return {}

  const result: CardAssets = {}
  const sprites: Record<string, string> = {}
  const customExpressions: CustomExpression[] = []

  for (const entry of data.assets) {
    if (!entry || typeof entry !== 'object') continue
    const asset = entry as Record<string, unknown>
    const type = typeof asset.type === 'string' ? asset.type : ''
    const uri = typeof asset.uri === 'string' ? asset.uri : ''
    const name = typeof asset.name === 'string' ? asset.name : ''
    if (!CCV3_USABLE_URI.test(uri)) continue

    if (type === 'icon') {
      result.avatarDataUrl ??= uri
    } else if (type === 'emotion' && name) {
      const slug = slugEmotion(name)
      if (!slug) continue
      const id = V3_EMOTION_ALIASES[slug] ?? slug
      if (sprites[id]) continue
      sprites[id] = uri
      if (!DEFAULT_EXPRESSION_IDS.includes(id) && !customExpressions.some((c) => c.id === id)) {
        customExpressions.push({ id, label: name.trim() || id })
      }
    }
  }

  if (Object.keys(sprites).length) result.sprites = sprites
  if (customExpressions.length) result.customExpressions = customExpressions
  return result
}

/** Same as str(), but tolerates a model returning an array of strings instead of one string (a common mistake for fields like mes_example). */
function strLenient(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join('\n\n')
  return ''
}
