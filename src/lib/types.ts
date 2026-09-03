import type { Lorebook } from '@/lib/characters/cardSpec'
import type { ChatMessage } from '@/lib/prompt/builder'
import type { SceneTag } from '@/lib/vn/sceneTag'

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

export type SceneFlag = 'first_date' | 'confession' | 'jealousy' | 'promise'

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
  giftCoins?: number
  giftInventory?: Record<string, number>
  giftsGiven?: Record<string, number>
  /** Owned quantity per `ItemDef.id` — 10d's item catalog, separate from `giftInventory` since items are used/consumed, not given to a character. */
  itemInventory?: Record<string, number>
  unlockedGalleryIds?: string[]
  activeEvent?: DateEventCard
  /** Running long-term memory log covering everything older than summaryUpToTimestamp. */
  summary?: string
  /** Messages with createdAt <= this are represented by `summary`, not sent verbatim. */
  summaryUpToTimestamp?: number
  /** Set when this chat was created by forking another one — the source chat's id. */
  parentChatId?: string
  /** The message (in the parent chat) this fork branched off from. */
  forkedFromMessageId?: string
}

export interface WorldInfoBook {
  id: string
  name: string
  book: Lorebook
  /** Chat ids this global book is bound to; empty = available to all chats. */
  boundChatIds: string[]
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
  /** Overrides the default gift catalog for characters living here. Empty/unset falls back to the built-in default catalog. */
  gifts?: GiftItem[]
  /** Per-world item catalog (10d) — no built-in default catalog the way gifts have one, since items are optional; empty/unset just means no items exist yet. */
  items?: ItemDef[]
  /** Overrides the default warmth thresholds for characters living here. Unset stages fall back to the default. */
  relationshipThresholds?: Partial<Record<Exclude<RelationshipStage, 'near_strangers'>, number>>
  /** Absolute day count in the shared 112-day calendar (src/lib/world/calendar.ts) — 0 if the clock has never been advanced. */
  currentDay?: number
  /** Index into calendar.ts's PHASES (morning/afternoon/evening/night) — 0 if never advanced. */
  currentPhaseIndex?: number
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
