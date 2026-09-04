import type { Lorebook } from '@/lib/characters/cardSpec'
import type { ChatMessage } from '@/lib/prompt/builder'
import type { InstructTemplate } from '@/lib/prompt/instructTemplates'
import type { SceneTag } from '@/lib/vn/sceneTag'
import type { WorldTemplateId } from '@/lib/world/worldTemplates'

export interface Persona {
  id: string
  name: string
  description: string
  avatarDataUrl?: string
  createdAt: number
}

/** A six-stage warmth ladder, replacing the old 4-stage strangers/curious/close/romance union. */
export type RelationshipStage =
  | 'near_strangers'
  | 'acquaintances'
  | 'warming_up'
  | 'getting_close'
  | 'close'
  | 'sweethearts'

/**
 * The six dimensions tracked alongside `Chat.affection` (which stays a top-level field — it's
 * the oldest and most load-bearing of the seven, gating lorebook/sprite/background/gallery
 * unlocks — so it isn't folded in here to avoid a breaking rename of every unlock threshold).
 * `warmth` (see `stage.ts`) is a derived average of five of these seven, not stored separately.
 */
export type RelationshipDimension = 'trust' | 'chemistry' | 'comfort' | 'respect' | 'curiosity' | 'tension'

/**
 * Not a closed literal union — `stage.ts`'s `SCENE_FLAGS` still names the 4 built-in defaults
 * (first_date/confession/jealousy/promise, each with a glossary entry the AI classifier reads),
 * but a flag actually stored here can also be the `id` of a world's own `CustomSceneFlag` (see
 * below). Mirrors how `GalleryEntry.requiredFlags` was already a plain `string[]` — nothing that
 * reads a stored flag ever assumed a fixed 4-value set, so widening this to `string` needed no
 * changes anywhere flags are read, only where new ones are authored/glossaried.
 */
export type SceneFlag = string

/**
 * A world-authored scene flag beyond the 4 built-in defaults (10c's original "scene-flag
 * authoring" gap) — additive, the same shape as `CustomExpression`: the built-in defaults keep
 * working exactly as before, this just gives a world its own extra ones on top. `description` is
 * the classifier-facing bar for when it should fire (mirrors `FLAG_GLOSSARY`'s built-in entries);
 * `label` is the player-facing name shown in the Relationship panel's checklist.
 */
export interface CustomSceneFlag {
  id: string
  label: string
  description: string
}

/**
 * Section 14's "Quick Replies bar" — the cheap, independently-useful subset of SillyTavern's
 * STscript/Quick Replies without committing to an actual scripting language: a user-configurable
 * button that sends `message` verbatim, exactly as if the player had typed and sent it themselves.
 * Global (Settings → Generation), not per-chat/per-character — the whole point is a small fixed
 * toolbar of narrative utility actions ("describe my surroundings," "let some time pass") that
 * makes sense in any chat, not authored content tied to one world or card.
 */
export interface QuickReply {
  id: string
  label: string
  message: string
}

/**
 * 10c's "Define-the-Relationship ladder" — a player-driven progression, separate from the
 * warmth-derived `RelationshipStage` above (which only ever tracks how close things *feel*, never
 * an explicit status). Warmth gates which tier can be *asked for* (see `stage.ts`'s
 * `commitmentTierThreshold`); actually reaching a tier always requires asking and the character
 * accepting — never an automatic side effect of warmth crossing a number.
 */
export type CommitmentStatus = 'none' | 'dating' | 'exclusive' | 'living_together'

/**
 * A committed relationship under real strain (10c's "Breakups & reconciliation") — a grace period
 * before neglect or tension actually breaks things, rather than an instant, unwarned snap. Cleared
 * the moment the underlying strain resolves; if it doesn't within the grace period, the
 * relationship breaks on its own the next time relationship state is evaluated.
 */
export interface RelationshipWarning {
  startedAt: number
  reason: string
}

/**
 * One turn's worth of relationship movement, logged append-only alongside the overwritten
 * running totals on `Chat` — answers "why is trust 62 now" instead of only ever showing the
 * current number. `deltas` holds only the dimensions that actually moved that turn (zeros
 * omitted); `reason` is the AI classifier's short one-line account of what happened.
 */
export interface RelationshipEvent {
  id: string
  chatId: string
  createdAt: number
  reason: string
  deltas: Partial<Record<'affection' | RelationshipDimension, number>>
  newFlags?: SceneFlag[]
  sourceMessageId?: string
}

/**
 * A discrete, durable fact about the user worth recalling much later — a name, a stated
 * preference, a promise made — distinct from `Chat.summary`'s one rolling prose blob, which is
 * lossy and gets rewritten wholesale on every resummarization. Fed into the prompt as a synthetic
 * constant lorebook entry (see `useChatSession.ts`'s `buildCurrentPrompt`), reusing World Info's
 * existing token-budget/placement machinery rather than adding a new prompt section.
 */
export interface ChatFact {
  id: string
  chatId: string
  text: string
  /** false once retired (superseded/contradicted/no longer relevant) — kept, not deleted, for the audit trail. */
  active: boolean
  sourceMessageId?: string
  createdAt: number
}

/**
 * A per-chat steering note injected into the prompt at a chosen position — SillyTavern's
 * Author's Note. Distinct from `CharacterCardData.post_history_instructions`, which is card-level
 * (shared by every chat with that character) and not editable mid-conversation: this is scoped to
 * one `Chat`, editable any time, and never rendered as something a character "said". A blank
 * `text` is inert (the whole field is cleared to `null` rather than persisted empty).
 */
export interface AuthorNote {
  text: string
  /**
   * Where in the assembled prompt the note lands:
   * - `before_char` — just before the character's identity block; lightest, setting-level framing.
   * - `after_char` — after the card/examples, before the chat history; medium.
   * - `at_depth` — inserted `depth` messages up from the latest turn; strongest, and `depth` 0-2
   *   is the most immediate steer (mirrors ST's default "in-chat @ depth 4").
   */
  position: 'before_char' | 'after_char' | 'at_depth'
  /** Only meaningful for `position: 'at_depth'` — how many messages up from the latest to insert it. */
  depth: number
}

/**
 * A user-defined find/replace rule applied to message text — SillyTavern's and RisuAI's regex
 * scripts. `target` decides where it runs: `display` rewrites only what's shown on screen (trim
 * artifacts, restyle narration), `prompt` rewrites only the history text fed back to the model
 * (strip a persistent tic the model keeps copying), `both` does each. The stored message is never
 * altered, so a rule is always reversible by disabling it.
 */
export interface RegexScript {
  id: string
  name: string
  /** A JS regex source string. Applied globally (an implicit `g` flag); add other flags in `flags`. */
  find: string
  /** Replacement string — supports `$1`/`$<name>` backrefs, and `\n` for a newline. */
  replace: string
  /** Extra regex flags beyond the implicit `g` (e.g. `i`, `s`, `m`). */
  flags?: string
  target: 'display' | 'prompt' | 'both'
  enabled: boolean
}

export type GiftRarity = 'common' | 'uncommon' | 'rare' | 'epic'

export interface GiftItem {
  id: string
  name: string
  rarity: GiftRarity
  price: number
  tags: string[]
}

/**
 * 10d's "Item catalog beyond gifts" — deliberately the deterministic subset of the originally
 * envisioned effect model: an immediate, permanent relationship nudge, a scene flag, or coins.
 * "Permanently raise a character's base dating stat" isn't included — there's no such concept
 * distinct from the tracked `relationshipStats` today — and "grant a time-limited buff" isn't
 * either, since that needs a whole new active-effects-with-expiry system. Both stay open.
 */
export type ItemEffect =
  | { kind: 'relationship'; dimension: 'affection' | RelationshipDimension; amount: number }
  | { kind: 'flag'; flag: SceneFlag }
  | { kind: 'currency'; amount: number }

export interface ItemDef {
  id: string
  name: string
  rarity: GiftRarity
  price: number
  tags: string[]
  description?: string
  effect: ItemEffect
}

export interface ChoiceOption {
  id: string
  kind: 'line' | 'action' | 'gift'
  label: string
  text: string
  giftId?: string
  giftName?: string
}

export interface DateEventCard {
  id: string
  title: string
  description: string
  objectiveTitle: string
  objectiveDescription?: string
  backgroundId?: string
  affectionRequirement?: number
  kind?: 'date' | 'gift' | 'milestone'
  /**
   * Set the moment a `kind: 'date'` event actually starts — marks it as a *live, scored* date
   * (10b), not just the original lightweight event-card flow. Its presence (rather than a
   * separate boolean) does double duty: it's both the "this is a scored live date" flag AND the
   * cutoff timestamp used to gather the date's own transcript for end-of-date scoring. Stamped on
   * every new event regardless of kind (harmless metadata for gift/milestone cards, which never
   * read it), so only `kind === 'date'` actually changes behavior — the original flow is
   * untouched for anyone not using the new "live date" action.
   */
  startedAt?: number
}

export interface StoredMessage extends ChatMessage {
  chatId: string
  createdAt: number
  giftId?: string
  swipes?: string[]
  activeSwipe?: number
  tokenCount?: number
  /** Expression/background the model tagged this reply with (Visual Novel mode) — undefined for user messages. */
  scene?: SceneTag
  /** Parallel to `swipes` — each alternate reply can carry its own scene. */
  swipeScenes?: (SceneTag | undefined)[]
  /**
   * The model's exact output for the active swipe, before scene-tag extraction ever touches it —
   * `text`/`swipes` already have that (and any display regex scripts) applied. Undefined for
   * messages generated before this field existed, and for user messages. Debug-only: shown in the
   * Prompt Inspector's raw/processed toggle, never read by prompt-building or anything gameplay-facing.
   */
  rawText?: string
  /** Parallel to `swipes` — each alternate reply's own pre-extraction raw output. */
  swipeRawTexts?: (string | undefined)[]
  /** Suggested next lines/actions for the user, generated after this (char) message lands. */
  choices?: string[]
  /** Structured branch options that can include direct lines, actions, or gifts. */
  choiceCards?: ChoiceOption[]
  /** Bookmarked as a favorite moment — surfaced in the chat's "Pinned" panel. */
  pinned?: boolean
  /**
   * Which character "said" this (role: 'char' only) — undefined means the chat's primary
   * `characterId`, so every message from before group chats existed stays valid with no
   * migration. Only set when a non-primary participant generated the reply.
   */
  speakerId?: string
  /**
   * True when this (char) message's generation attempt failed outright — `text` stays empty
   * rather than persisting an error string as the character's actual dialogue, which would
   * otherwise get fed back into every future prompt as something they genuinely said. The UI
   * renders a "Generation failed" indicator itself, driven by this flag, not by message text.
   */
  failed?: boolean
  /** Set when the world tick (10f's proactive outreach) generated this message unprompted, rather than as a reply to a player message in the same turn. */
  initiatedBy?: 'character'
  /** 10b's intent chips — how the player meant this line. User messages only; fed to the relationship judge as interpretation context, never a direct stat move. See `src/lib/dating/intent.ts`. */
  intent?: MessageIntent
}

/** 10b: how a player meant a tagged line, distinct from what it literally says. Specs (labels, how the judge reads each) live in `src/lib/dating/intent.ts`. */
export type MessageIntent = 'flirt' | 'tease' | 'open_up' | 'reassure' | 'apologize'

/** 10b's live rapport trajectory — how a date scene is trending. Labels/tone live in `src/lib/dating/rapport.ts`. */
export type RapportTrajectory = 'lighting_up' | 'warming' | 'at_ease' | 'pulling_back' | 'on_edge'

export interface RapportRead {
  trajectory: RapportTrajectory
  /** A short in-world observation from the judge, e.g. "keeps finding reasons to lean in". */
  note?: string
  /** When this read was taken, so a stale one from a finished date can be ignored. */
  updatedAt: number
}

export interface Chat {
  id: string
  /** The primary character — relationship stats/gifts/gallery/VN sprites stay keyed on this one even when `participants` is set. */
  characterId: string
  /** Extra characters who can also speak in this chat (group scenes). Unset/empty = today's single-character chat. */
  participants?: string[]
  personaId: string
  title: string
  createdAt: number
  updatedAt: number
  affection?: number
  /** The six dimensions beyond `affection` — see `RelationshipDimension`. Missing keys read as 0. */
  relationshipStats?: Partial<Record<RelationshipDimension, number>>
  relationshipStage?: RelationshipStage
  /** 10c's Define-the-Relationship ladder — unset/'none' until the player asks and the character accepts. */
  commitmentStatus?: CommitmentStatus
  /** Set while a committed relationship is under real strain and hasn't yet broken or recovered. */
  relationshipWarning?: RelationshipWarning
  /** How many times this relationship has broken up (deliberately or from unresolved strain) — the "lasting scar" persists as this counter plus a one-time stat hit at break time, not a literal permanent ceiling. */
  breakupCount?: number
  sceneFlags?: SceneFlag[]
  /** Per-lorebook-entry sticky/cooldown bookkeeping, keyed `${book.sourceKey}:${entry.id}` — written back after each generation, read on the next. Unset = fresh. */
  worldInfoState?: Record<string, { activeUntil?: number; blockedUntil?: number; activeAt?: number }>
  /** Per-chat steering note (SillyTavern's Author's Note) — see `AuthorNote`. Unset = none. */
  authorNote?: AuthorNote
  giftCoins?: number
  giftInventory?: Record<string, number>
  giftsGiven?: Record<string, number>
  /** Owned quantity per `ItemDef.id` — 10d's item catalog, separate from `giftInventory` since items are used/consumed, not given to a character. */
  itemInventory?: Record<string, number>
  unlockedGalleryIds?: string[]
  activeEvent?: DateEventCard
  /** 10b's live rapport read — how the scene is trending, refreshed each turn *only* while a live date is active, cleared when it ends. Qualitative only; never affects affection or the tracked dimensions. See `src/lib/dating/rapport.ts`. */
  rapport?: RapportRead
  /** Running long-term memory log covering everything older than summaryUpToTimestamp. */
  summary?: string
  /** Messages with createdAt <= this are represented by `summary`, not sent verbatim. */
  summaryUpToTimestamp?: number
  /** Set when this chat was created by forking another one — the source chat's id. */
  parentChatId?: string
  /** The message (in the parent chat) this fork branched off from. */
  forkedFromMessageId?: string
  /**
   * Per-chat overrides for the global relationship-tracking/choice-suggestion assist toggles
   * (Settings → Generation) — an unset field falls back to that global default, same precedence
   * style as `Character.instructTemplateId`. Seeded once from the bound world's template at chat
   * creation (`NewChatDialog`) so a Freeform/Slice of Life world's chats genuinely don't carry a
   * relationship-tracking prompt line even if the user's global default has it on — not
   * live-recomputed if the world's template changes later, the same "picks a default, doesn't
   * retroactively enforce it" contract world templates (10e) already has for hiding editor tabs.
   */
  assistOverrides?: {
    autoTrackRelationship?: boolean
    autoSuggestChoices?: boolean
    /** Same precedence — unset falls back to the global Settings → Appearance default. Seeded
     *  from the bound world's template (Visual Novel forces it on) same as the two flags above,
     *  editable afterward from `RelationshipPanel`. */
    visualNovelMode?: boolean
  }
  /** 10f's proactive outreach: real-time bookkeeping for the world tick, written every time it evaluates this chat regardless of outcome — prevents re-rolling on every app reopen. Independent of the in-fiction world clock. */
  lastOutreachCheckedAt?: number
  /** True once the world tick has inserted an unprompted message the player hasn't opened this chat to see yet. Cleared when the chat is opened. */
  hasUnreadOutreach?: boolean
}

export interface WorldInfoBook {
  id: string
  name: string
  book: Lorebook
  /**
   * Scoping for this standalone book. When `boundChatIds`, `boundCharacterIds`, and
   * `boundWorldIds` are ALL empty the book is global — active in every chat (the original
   * behaviour, and what every book created before scoping existed still gets). Otherwise the book
   * is active only for a chat that matches: its own id is in `boundChatIds`, its primary
   * character is in `boundCharacterIds`, or that character's world is in `boundWorldIds`.
   */
  boundChatIds: string[]
  boundCharacterIds?: string[]
  boundWorldIds?: string[]
  createdAt: number
}

export interface WorldCard {
  id: string
  name: string
  /** Setting, tone, general facts — always included in the prompt for any character in this world. */
  description: string
  /** Hard constraints: magic system, tech level, taboos — things the model should never contradict. */
  rules?: string
  lorebook: Lorebook
  avatarDataUrl?: string
  /** Scene art keyed by background id (src/lib/vn/backgrounds.ts) — falls back to a placeholder gradient when missing. */
  backgrounds?: Record<string, string>
  /** Minimum affection required before a tagged background can be selected/displayed. */
  backgroundUnlocks?: Record<string, number>
  /** Background-music track URLs keyed by scene mood id (src/lib/vn/moods.ts), plus a `default` key played when no mood-specific track applies. VN mode only. */
  music?: Record<string, string>
  /** Overrides the default gift catalog for characters living here. Empty/unset falls back to the built-in default catalog. */
  gifts?: GiftItem[]
  /** Per-world item catalog (10d) — no built-in default catalog the way gifts have one, since items are optional; empty/unset just means no items exist yet. */
  items?: ItemDef[]
  /** Overrides the default warmth thresholds for characters living here. Unset stages fall back to the default. */
  relationshipThresholds?: Partial<Record<Exclude<RelationshipStage, 'near_strangers'>, number>>
  /** World-authored scene flags beyond the 4 built-in defaults — see `CustomSceneFlag`. */
  customSceneFlags?: CustomSceneFlag[]
  /** Absolute day count in the shared 112-day calendar (src/lib/world/calendar.ts) — 0 if the clock has never been advanced. */
  currentDay?: number
  /** Index into calendar.ts's PHASES (morning/afternoon/evening/night) — 0 if never advanced. */
  currentPhaseIndex?: number
  /** Picked at creation (src/lib/world/worldTemplates.ts), editable after — narrows which editor tabs are shown. Unset behaves exactly like 'dating_sim' (the full feature set, matching every world created before this field existed). */
  template?: WorldTemplateId
  createdAt: number
  updatedAt: number
}

export interface ObjectiveTask {
  id: string
  description: string
  status: 'pending' | 'done'
  completedAt?: number
}

export interface Objective {
  id: string
  chatId: string
  title: string
  description?: string
  tasks: ObjectiveTask[]
  status: 'active' | 'completed' | 'abandoned'
  createdBy: 'user' | 'ai'
  createdAt: number
  updatedAt: number
}

export interface SamplerPreset {
  id: string
  name: string
  params: Record<string, unknown>
  createdAt: number
}

export interface Theme {
  id: string
  name: string
  tokens: Record<string, string>
  createdAt: number
}

/** A user-authored instruct template (duplicated from a builtin, or made from scratch), saved and reusable across chats. */
export interface CustomInstructTemplate extends InstructTemplate {
  createdAt: number
}
