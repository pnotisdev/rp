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

export type GiftRarity = 'common' | 'uncommon' | 'rare' | 'epic'

export interface GiftItem {
  id: string
  name: string
  rarity: GiftRarity
  price: number
  tags: string[]
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
}

export interface Chat {
  id: string
  characterId: string
  personaId: string
  title: string
  createdAt: number
  updatedAt: number
  affection?: number
  /** The six dimensions beyond `affection` — see `RelationshipDimension`. Missing keys read as 0. */
  relationshipStats?: Partial<Record<RelationshipDimension, number>>
  relationshipStage?: RelationshipStage
  sceneFlags?: SceneFlag[]
  giftCoins?: number
  giftInventory?: Record<string, number>
  giftsGiven?: Record<string, number>
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
  /** Overrides the default warmth thresholds for characters living here. Unset stages fall back to the default. */
  relationshipThresholds?: Partial<Record<Exclude<RelationshipStage, 'near_strangers'>, number>>
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
