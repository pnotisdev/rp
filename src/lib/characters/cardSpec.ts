// SillyTavern-compatible character card types (chara_card_v2 spec), so cards
// exported from/imported into SillyTavern round-trip without loss.
// https://github.com/malfoyslastname/character-card-spec-v2

import type { TtsProviderId } from '@/lib/voice/ttsProviders'
import type { ReplyLength } from '@/lib/characters/voice'
import type { ScheduleEntry, WeatherPreferences } from '@/lib/world/calendar'
import { DEFAULT_EXPRESSION_IDS, type CustomExpression } from '@/lib/vn/expressions'
import type { Outfit } from '@/lib/vn/outfits'
import type { IntimacyPhase } from '@/lib/dating/intimacyScene'
import type { RelationshipStage } from '@/lib/types'

export type WorldInfoActivationMode = 'always' | 'keyword' | 'manual'

/** Concrete, recurring speech patterns an author fills in directly — the structured complement to
 *  free-text `personality`/`mes_example`. `detectVoiceFingerprint` (`voice.ts`) can seed a first
 *  draft from the card's own examples; every field stays freely editable afterward. */
export interface VoiceFingerprint {
  /** Filler words/discourse markers — "well,", "I mean", "you know?" */
  verbalTics?: string[]
  /** Signature phrases reused across scenes — "you're impossible", "don't push it". */
  catchphrases?: string[]
  /** Dialect, register, formality, and taboo-language notes in the author's own words. */
  dialectNotes?: string
  /** How their sentences tend to run — e.g. "short and clipped" or "long, winding". */
  sentenceRhythm?: string
}

export interface RelationshipStarter {
  id: string
  /** Short picker label, e.g. "Childhood friends". */
  label: string
  /** Seeds the chat's long-term memory (`Chat.summary`) with this backstory from message one. */
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
  /** A once-per-relationship epilogue, unlocked at the top affection stage rather than via `unlockAffection`. */
  isEnding?: boolean
  /** Item 10: auto-surfaces this CG full-bleed on the VN stage the moment its condition is met — still gated by `unlockAffection`/`requiredFlags` above, which just say it's *allowed* to appear. Unset means never auto-shown; still browsable once unlocked. Ignored on an `isEnding` entry — those stay a browsable epilogue, not something the mid-scene director swaps in unprompted. */
  autoTrigger?: CgTrigger
  /** Item 11: extra alternate art for this same CG — `cgTrigger.ts`'s caller picks one of `[imageUrl, ...variants]` per showing, for visual variety on a beat that recurs (e.g. an `intimacyPhase` trigger that fires again in a later scene). */
  variants?: string[]
}

/** One condition `cgTrigger.ts`'s `triggeredCg` checks a `GalleryEntry.autoTrigger` against. */
export type CgTrigger =
  | { kind: 'intimacyPhase'; phase: IntimacyPhase }
  | { kind: 'catalogAction'; optionId: string }
  | { kind: 'sceneFlag'; flag: string }
  | { kind: 'relationshipStage'; stage: RelationshipStage }

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
  /** Only used when `position` is `'at_depth'` — messages up from the latest, same convention as `AuthorNote.depth`. */
  depth?: number
  case_sensitive?: boolean
  /** Mirrors ST's always/when-relevant/manual radio; kept in sync with `constant`. */
  activationMode?: WorldInfoActivationMode
  /** 0-100 odds a keyword match fires; doesn't apply to always/manual entries (see activation.ts). */
  probability?: number
  /** Entries sharing a non-empty group name are mutually exclusive — only one fires. */
  group?: string
  /** Optional weighted-random pick within a `group` (ST-style); unset weight defaults to 1. */
  groupWeight?: number
  /** ST's "sticky" — turns a keyword entry stays force-active after matching. 0/undefined = off. */
  sticky?: number
  /** ST's "cooldown" — turns before a keyword entry can reactivate. 0/undefined = off. */
  cooldown?: number
  /** ST's "delay" — chat must have at least this many messages before the entry can activate. */
  delay?: number
  extensions?: Record<string, unknown>
}

export interface Lorebook {
  name?: string
  description?: string
  scan_depth?: number
  token_budget?: number
  recursive_scanning?: boolean
  /** Stable id for this book across turns; sticky/cooldown state is keyed on `${sourceKey}:${entry.id}`. */
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
  /** The world this character lives in, if any. */
  worldId?: string
  /** Expression art, keyed by expression id (vn/expressions.ts) for the base outfit, or
   *  `<outfitId>--<expressionId>` for an outfit (vn/outfits.ts). Falls back to the avatar when missing. */
  sprites?: Record<string, string>
  /** Minimum affection required before a sprite (keyed the same way as `sprites`) can be shown. */
  spriteUnlocks?: Record<string, number>
  /** Item 11: extra alternate art per sprite key, keyed the same way as `sprites` — `resolveExpressionSprite` picks one of `[sprites[key], ...spriteVariants[key]]` per showing, for visual variety on a slot that's used a lot. */
  spriteVariants?: Record<string, string[]>
  /** Wardrobe states beyond the base look (vn/outfits.ts); the base outfit is implicit. */
  outfits?: Outfit[]
  /** Expression slots beyond the built-in default set (vn/expressions.ts). */
  customExpressions?: CustomExpression[]
  /** Gift preference score per gift id (-2..3), used by the gift economy. */
  giftPreferences?: Record<string, number>
  /** Authored gift taste in free text — richer than the numeric `giftPreferences` score, which only drives the affection delta. */
  giftLikes?: string[]
  giftDislikes?: string[]
  /** How this character feels most loved/appreciated, e.g. "quality time". */
  loveLanguage?: string
  /** How this character's voice holds up under strain during an explicit scene, in the author's own
   *  words. Unset falls back to a generic voice-consistency instruction (`intimacyScene.ts`). */
  explicitVoiceNote?: string
  /** Unlockable CG-like gallery entries. */
  gallery?: GalleryEntry[]
  /** Optional narrative starting points offered when creating a new chat with this character. */
  relationshipStarters?: RelationshipStarter[]
  /** Per-character TTS override; unset falls back to the global Settings → Voice config. */
  voice?: { provider?: TtsProviderId; voiceId?: string }
  /** Structured speech patterns, folded into the prompt by `buildCharacterProfileNote` (profile.ts). */
  voiceFingerprint?: VoiceFingerprint
  /** Extra sound-effect words that get the manga-style "burst" styling, beyond the built-in list. Display-only. */
  sfxWords?: string[]
  /** Per-character instruct-template override; unset falls back to the global Settings → Generation default. */
  instructTemplateId?: string
  /** Reply length band (voice.ts). Unset/'auto' measures the card's own `mes_example` turn length;
   *  the others are an explicit override for a card whose examples are unrepresentative or missing. */
  replyLength?: ReplyLength
  /** Weather this character loves/hates (world/calendar.ts); nudges the world-moment prompt line. */
  weatherPreferences?: WeatherPreferences
  /** Daily/weekly routine (world/calendar.ts); only meaningful for a world-bound character. */
  schedule?: ScheduleEntry[]
  /** General interests/hobbies, distinct from `giftLikes` (gift-shopping taste specifically). */
  likes?: string[]
  /** What this character wants or is working toward. */
  goals?: string[]
  /** Hard limits, in character. Informational only — see `dateModeOptOut` for the one boundary this app enforces mechanically. */
  boundaries?: string[]
  /** Who this character knows and how; reaches the prompt as a compact roster line. */
  socialConnections?: SocialConnection[]
  /** Structured `when X → Y` / `never: Z` behavioral contracts, e.g. for desire, hesitation, aftercare — more precise than free-text personality. */
  behavioralRules?: BehavioralRule[]
  /** Job title/role, e.g. "barista" or "second-year architecture student". */
  occupation?: string
  /** Where they work/study, distinct from `occupation` (the role). */
  workplace?: string
  /** Where they live, e.g. "a small apartment near the station". */
  homeLocation?: string
  /** Places they're often found beyond home/work. */
  frequentedLocations?: string[]
  /** Excludes this character from the date/event system entirely (an authorial opt-out, not an affection gate). */
  dateModeOptOut?: boolean
  /** How often this character texts the player first, unprompted. Unset behaves as 'never'. */
  outreach?: { frequency: OutreachFrequency }
  createdAt: number
  updatedAt: number
}

/** How readily a character initiates unprompted contact. */
export type OutreachFrequency = 'never' | 'rare' | 'normal' | 'eager'

export interface SocialConnection {
  id: string
  name: string
  /** How they know each other, e.g. "childhood friend", "older sister", "rival from the debate club". */
  relation: string
  notes?: string
}

/** One structured behavioral contract. `'when_then'` is conditional ("when X, she Y"); `'never'` is an unconditional negative ("never Y") — `when` is unused for it. */
export type BehavioralRuleKind = 'when_then' | 'never'

export interface BehavioralRule {
  id: string
  kind: BehavioralRuleKind
  /** The trigger, in the author's own words — only meaningful for `'when_then'`. */
  when?: string
  /** What happens (`'when_then'`) or what never does (`'never'`). */
  then: string
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
