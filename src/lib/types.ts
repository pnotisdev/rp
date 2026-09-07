/**
 * Core persisted data model: chats, characters' relationship state, world/lorebook content,
 * messages, and the smaller supporting types (gifts, items, scenes, regex scripts, etc.) that
 * make up what gets stored to and read from the SQLite-backed store.
 */

import type { Lorebook } from '@/lib/characters/cardSpec'
import type { ChatMessage } from '@/lib/prompt/builder'
import type { InstructTemplate } from '@/lib/prompt/instructTemplates'
import type { SceneTag } from '@/lib/vn/sceneTag'
import type { WorldTemplateId } from '@/lib/world/worldTemplates'
import type { CustomBackground } from '@/lib/vn/backgrounds'
import type { CharacterMood, CharacterNeed } from '@/lib/prompt/mindGuidance'
import type { IntimacyUnlockable } from '@/lib/dating/intimacyCatalog'
import type { Afterglow } from '@/lib/dating/aftercare'
import type { Trigger } from '@/lib/world/triggers'
import type { IntimacyDetailLevel } from '@/lib/store/useSettingsStore'
import type { IntimacyScene } from '@/lib/dating/intimacyScene'
import type { RecentRebuff } from '@/lib/dating/rebuff'
import type { GiftLogEntry, ReciprocityCue } from '@/lib/dating/gifts'

export interface Persona {
  id: string
  name: string
  description: string
  avatarDataUrl?: string
  createdAt: number
}

/** Six-stage warmth ladder (replaces the old 4-stage strangers/curious/close/romance union). */
export type RelationshipStage =
  | 'near_strangers'
  | 'acquaintances'
  | 'warming_up'
  | 'getting_close'
  | 'close'
  | 'sweethearts'

/** The six dimensions tracked alongside `Chat.affection`, which stays top-level and separate since it gates unlocks. `warmth` (`stage.ts`) is a derived average of five of these seven. */
export type RelationshipDimension = 'trust' | 'chemistry' | 'comfort' | 'respect' | 'curiosity' | 'tension'

/** Not a closed union — also matches a `CustomSceneFlag.id`. `stage.ts`'s `SCENE_FLAGS` names the 4 built-in defaults. */
export type SceneFlag = string

/** A world-authored scene flag beyond the 4 built-ins. `description` is the classifier-facing bar for when it fires; `label` is player-facing. */
export interface CustomSceneFlag {
  id: string
  label: string
  description: string
}

/** Section 14's Quick Replies bar — a user-configurable button that sends `message` verbatim, as if typed by the player. Global, not per-chat/per-character. */
export interface QuickReply {
  id: string
  label: string
  message: string
}

/** 10c's Define-the-Relationship ladder — player-driven, separate from the warmth-derived `RelationshipStage`. Warmth only gates which tier can be *asked for* (`stage.ts`'s `commitmentTierThreshold`); reaching one always requires asking and acceptance. */
export type CommitmentStatus = 'none' | 'dating' | 'exclusive' | 'living_together' | 'married'

/** A committed relationship under strain (10c's breakups/reconciliation) — a grace period before it breaks. Cleared once the strain resolves; otherwise the relationship breaks on its own once the grace period lapses. */
export interface RelationshipWarning {
  startedAt: number
  reason: string
}

/** One turn's relationship movement, logged append-only alongside the running totals on `Chat`. */
export interface RelationshipEvent {
  id: string
  chatId: string
  createdAt: number
  reason: string
  /** Only the dimensions that actually moved that turn; zeros omitted. */
  deltas: Partial<Record<'affection' | RelationshipDimension, number>>
  newFlags?: SceneFlag[]
  sourceMessageId?: string
  /** Unset means the chat's primary character (the only case before multi-character tracking). */
  characterId?: string
}

/** One entry in a character's persistent agency layer (`RelationshipTrack.plans`) — formed/annotated/resolved by the judge call. Capped at 3 active (`dating/plans.ts`). Contrast `characterIntent`, which resets every turn. */
export interface CharacterPlan {
  id: string
  /** The intention in the character's own terms, short: "finish the mural before the showcase". */
  goal: string
  /** `personal` = the character's own life; `together` = wants to do it *with* the player; `distance` = deliberately holding back. Lets `plansGuidance` frame it correctly. */
  kind: 'personal' | 'together' | 'distance'
  /** `Chat.messages.length` when the judge formed this — lets stale plans age out. */
  formedTurn: number
  /** Running annotation the judge appends as the plan progresses or hits friction. */
  note?: string
}

/** A durable impression the character has formed about the player as a person (`dating/beliefs.ts`), distinct from a `ChatFact` (an event) or `characterIntent` (a private want). Capped; ages out like `CharacterPlan`. */
export interface CharacterBelief {
  id: string
  /** The impression itself, in the character's own voice: "He's unusually patient with me." */
  text: string
  formedTurn: number
}

/** A standing expectation the character has developed of the player — met (quietly retired) or violated (logged as a `ChatFact` with negative valence). Distinct from `CharacterPlan`, which is the character's own intention. */
export interface UserExpectation {
  id: string
  /** The expectation itself: "expects a check-in most Sundays." */
  text: string
  formedTurn: number
  /** Running annotation as it plays out — mirrors `CharacterPlan.note`. */
  note?: string
}

/** Relationship-state bundle. The primary reads/writes `Chat`'s own top-level fields directly; any other participant's copy lives in `Chat.participantRelationships`, keyed by character id. See `getRelationshipTrack`/`patchRelationshipTrack` in `stage.ts`. Not per-character: `sceneFlags`, `giftCoins`/`giftInventory`, and `ChatFact`s stay on `Chat` only. */
export interface RelationshipTrack {
  affection?: number
  relationshipStats?: Partial<Record<RelationshipDimension, number>>
  relationshipStage?: RelationshipStage
  commitmentStatus?: CommitmentStatus
  /** `null` clears it; `undefined` is dropped by `JSON.stringify` and won't overwrite a stored value. */
  relationshipWarning?: RelationshipWarning | null
  breakupCount?: number
  unlockedGalleryIds?: string[]
  /** Per-gift-id tally received by this character — separate from `Chat.giftInventory` (the player's shared stock). */
  giftsGiven?: Record<string, number>
  /** Open post-intimacy window (`dating/aftercare.ts`); cleared once judged. `null` clears it (see `relationshipWarning`). */
  afterglow?: Afterglow | null
  /** Transient emotional read; can differ from the warmth-driving fields above (e.g. `annoyed` while still close). Set by the judge call, read by `prompt/mindGuidance.ts`. Undefined means no read yet, not "neutral". */
  mood?: CharacterMood
  /** Steadier undercurrent than `mood` — see `mood`. Not shown to the player as a "need", but not fully hidden either (`RelationshipPanel`). */
  currentNeed?: CharacterNeed
  /** A private thing the character currently wants — never shown to the player; shapes tone via `mindGuidance.ts`. */
  characterIntent?: string
  /** A deeper, steadier drive — the counterpart to `currentNeed` that `characterIntent` is to `mood`. Never shown to the player. See `mindGuidance.ts`'s `desireGuidance`. */
  currentDesire?: string
  /** Decayed running rate of warmth change (`dating/momentum.ts`'s `nextMomentum`): positive = deepening fast, negative = cooling, ~0 = settled. */
  momentum?: number
  /** Persistent agency layer — a few concrete intentions outlasting a turn. Max 3 active; see `dating/plans.ts`. */
  plans?: CharacterPlan[]
  /** Set when this relationship first reaches a deliberately-initiated "first time together" milestone (`stage.ts`'s `canInitiateFirstTime`). Undefined = hasn't happened. */
  firstIntimateSceneAt?: number
  /** Item 2's asymmetric-pacing signal: who's been initiating lately. Positive = the player; negative = the character. See `dating/momentum.ts`. */
  initiativeBalance?: number
  /** Item 2's "missed opportunity" cue after a deflected commitment/intimacy ask (`dating/rebuff.ts`) — distinct from `relationshipWarning`'s hard breakup risk. `null` clears it. */
  recentRebuff?: RecentRebuff | null
  /** Item 1's intimacy scene state machine (`dating/intimacyScene.ts`) — where a scene currently stands, separate from `afterglow` (the aftermath once it's concluded). `null` clears it. */
  intimacyScene?: IntimacyScene | null
  /** Item 3's recency log of gifts given to this character (`dating/gifts.ts`) — distinct from `giftsGiven`'s lifetime tally; lets a re-gift pattern be recognized. */
  giftLog?: GiftLogEntry[]
  /** FIXES_TODO #12's escalation-shape memory (`dating/intimacyScene.ts`) — recent resolved scenes' catalog-category sequences, e.g. `['kissing_spot', 'position', 'toy']`. Bare `string[][]`, not `IntimacyCategory[][]`, to avoid a circular import back through `intimacyCatalog.ts`. */
  intimacySceneShapeLog?: string[][]
  /** See `CharacterBelief`. Capped/aged out the same way `plans` is (`dating/beliefs.ts`). */
  beliefsAboutUser?: CharacterBelief[]
  /** See `UserExpectation`. Capped/aged out the same way `plans` is (`dating/expectations.ts`). */
  expectationsOfUser?: UserExpectation[]
  /** The character's own private fear right now — the third leg alongside `characterIntent` (a want) and `currentNeed` (an undercurrent). Same sticky-until-replaced contract as `mood`. Undefined means no read yet, not "fearless". */
  currentFear?: string
  /** Item 6's character-initiated gift reciprocity cue (`dating/gifts.ts`) after warmth/circumstance has earned it. `null` clears it. */
  reciprocityCue?: ReciprocityCue | null
}

/**
 * Group-chat turn policy — who replies next. `manual`: the Composer's "reply as" picker decides.
 * `round_robin`: cycles the primary + every participant in order. `director`: a judge call picks
 * who'd respond. `mention`: an `@Name` routes to them, else falls back to the primary.
 */
export type ScenePolicy = 'manual' | 'round_robin' | 'director' | 'mention'

export interface Scene {
  /** `null` clears just this field via `updateScene`'s partial-patch merge. */
  location?: string | null
  atmosphere?: string | null
  turnPolicy: ScenePolicy
  /** Round-robin bookkeeping: index into `[primaryId, ...participantIds]`. Read defensively (clamped/modulo) since the roster can shrink. */
  roundRobinIndex?: number
}

/** A discrete, durable fact about the user worth recalling later, distinct from `Chat.summary`'s lossy rolling prose. Fed into the prompt as a synthetic lorebook entry (`useChatSession.ts`'s `buildCurrentPrompt`). */
export interface ChatFact {
  id: string
  chatId: string
  text: string
  /** False once retired (superseded/contradicted/no longer relevant) — kept, not deleted, for the audit trail. */
  active: boolean
  sourceMessageId?: string
  createdAt: number
  /** 0-1: how much this matters long-term. Unset ~0.5. Drives which facts keep a prompt slot when budget is tight. */
  importance?: number
  /** -1..1: how the event felt to the character. Unset is neutral. */
  valence?: number
  /** An open thread the story hasn't closed (a slight, an unkept promise). Gets stronger prompt treatment until the judge marks it resolved. */
  unresolved?: boolean
}

/** A per-chat steering note (SillyTavern's Author's Note) — distinct from card-level `post_history_instructions`. A blank `text` is cleared to `null` rather than persisted empty. */
export interface AuthorNote {
  text: string
  /** `before_char` = lightest, before the identity block. `after_char` = medium, before chat history. `at_depth` = strongest, inserted `depth` messages up (mirrors ST's default depth 4). */
  position: 'before_char' | 'after_char' | 'at_depth'
  /** Only meaningful for `position: 'at_depth'`. */
  depth: number
}

/** A user-defined find/replace rule (SillyTavern/RisuAI regex scripts). The stored message is never altered, so a rule is always reversible by disabling it. */
export interface RegexScript {
  id: string
  name: string
  /** JS regex source string; applied with an implicit `g` flag (add others via `flags`). */
  find: string
  /** Replacement string — supports `$1`/`$<name>` backrefs and `\n`. */
  replace: string
  /** Extra regex flags beyond the implicit `g` (e.g. `i`, `s`, `m`). */
  flags?: string
  /** `display` rewrites only what's shown; `prompt` rewrites only history text sent to the model; `both` does each. */
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

/** 10d's item catalog — deliberately the deterministic subset (immediate relationship nudge, scene flag, or coins). Permanent stat boosts and time-limited buffs aren't modeled yet. */
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
  /** `hangout` is `date`'s lower-stakes sibling (10b) — same live/scored machinery, no hidden agenda or walkout risk. See `isLiveScene`. */
  kind?: 'date' | 'gift' | 'milestone' | 'hangout'
  /** Set the moment a `date`/`hangout` event starts — marks it a live, scored scene (10b) and doubles as the cutoff timestamp for gathering its transcript. Stamped on every new event; see `isLiveScene`. */
  startedAt?: number
  /** 10b's hidden stakes — drafted once from the character's card when a `date` starts (never for `hangout`), never shown to the player. Fed to `assessDateOutcome` at the end. Best-effort: may stay unset if a card's too thin or the draft call fails. */
  hiddenAgenda?: string
}

export interface StoredMessage extends ChatMessage {
  chatId: string
  createdAt: number
  giftId?: string
  swipes?: string[]
  activeSwipe?: number
  tokenCount?: number
  /** Expression/background tag (Visual Novel mode) — undefined for user messages. */
  scene?: SceneTag
  /** Parallel to `swipes` — each alternate reply's own scene. */
  swipeScenes?: (SceneTag | undefined)[]
  /** The model's raw output before scene-tag extraction (and display regex) is applied. Debug-only — shown in the Prompt Inspector, never read by prompt-building. */
  rawText?: string
  /** Parallel to `swipes` — each alternate reply's own pre-extraction raw output. */
  swipeRawTexts?: (string | undefined)[]
  /** Suggested next lines/actions for the user, generated after this (char) message lands. */
  choices?: string[]
  /** Structured branch options that can include direct lines, actions, or gifts. */
  choiceCards?: ChoiceOption[]
  /** Bookmarked as a favorite moment — surfaced in the chat's Pinned panel. */
  pinned?: boolean
  /** Which character "said" this (role: 'char' only) — undefined means the chat's primary `characterId`. */
  speakerId?: string
  /** True when this (char) message's generation attempt failed outright — `text` stays empty rather than persisting an error string as dialogue. UI renders "Generation failed" from this flag. */
  failed?: boolean
  /** Set when the world tick (10f's proactive outreach) generated this message unprompted. */
  initiatedBy?: 'character'
  /** 10b's intent chips — how the player meant this line. User messages only; fed to the relationship judge as context. See `src/lib/dating/intent.ts`. */
  intent?: MessageIntent
  /** Set when this (user) message was sent via a Relationship-panel Unlocks-tab action rather than typed. `label`/`category` are frozen at send time so it stays accurate if the catalog changes later. `category` is a bare string (not `IntimacyCategory`) to avoid a circular import. See `MessageBubble.tsx`'s badge. `optionId` (the catalog entry's own id) feeds a `'catalogAction'` `CgTrigger` — unset on an older message from before that field existed. */
  intimacyAction?: { label: string; category: string; optionId?: string }
  /** Item 8: boundary phrase `dating/boundaryGuard.ts` flagged, persisted so it stays visible past the generation-time toast. Not an automatic reroll — see that file. Cleared on edit/regenerate. `null` clears it (see `RelationshipTrack.afterglow`). */
  boundaryFlag?: string | null
  /** FIXES_TODO "regenerate doesn't undo the damage": true once the per-turn judge has scored THIS message, so a regenerate doesn't reapply its delta again. `char` messages only. */
  relationshipJudged?: boolean
  /** FIXES_TODO #8: `dating/agencyGuard.ts` flagged this as narrating the player persona's own climax. Same durable, player-reviewed pattern as `boundaryFlag`, kept separate since it's a different kind of concern. `null` clears it. */
  povFlag?: string | null
  /** FIXES_TODO #11: `dating/intimacyScene.ts` flagged this reply for using one of `EXPLICIT_ANTI_PATTERNS`. Own field since it's a prose-quality miss, not a boundary/POV violation. `null` clears it. */
  explicitQualityFlag?: string | null
  /** Snapshot of this message right before its most recent "Continue" appended a segment — lets the player undo it (restore this) or regenerate just that segment (re-continue from here). Cleared on a fresh generation/swipe/edit; `null` clears it. */
  continueUndo?: { text: string; rawText?: string; scene?: SceneTag } | null
}

/** 10b: how a player meant a tagged line. Labels/judge behavior live in `src/lib/dating/intent.ts`. */
export type MessageIntent = 'flirt' | 'tease' | 'open_up' | 'reassure' | 'apologize'

/** 10b's live rapport trajectory during a date scene. Labels/tone live in `src/lib/dating/rapport.ts`. */
export type RapportTrajectory = 'lighting_up' | 'warming' | 'at_ease' | 'pulling_back' | 'on_edge'

export interface RapportRead {
  trajectory: RapportTrajectory
  /** A short in-world observation, e.g. "keeps finding reasons to lean in". */
  note?: string
  /** 10b's walkout signal — true only for a genuine dealbreaker, never ordinary friction. `useChatSession` ends the date the moment this is true; never shown as a raw flag. */
  walkOut?: boolean
  /** When this read was taken, so a stale one from a finished date can be ignored. */
  updatedAt: number
}

export interface Chat {
  id: string
  /** The primary character. VN sprite/expression staging still keys on this one; relationship stats/gifts/gallery no longer do — see `participantRelationships`. */
  characterId: string
  /** Extra characters who can also speak (group scenes). Unset/empty = today's single-character chat. */
  participants?: string[]
  /** Non-primary participants' own `RelationshipTrack`, keyed by character id — the primary keeps using this `Chat`'s top-level fields. See `getRelationshipTrack`/`patchRelationshipTrack` in `stage.ts`. */
  participantRelationships?: Record<string, RelationshipTrack>
  /** Location/atmosphere framing plus who replies next in a group chat. Unset = today's manual behavior. See `Scene`. */
  scene?: Scene
  personaId: string
  title: string
  createdAt: number
  updatedAt: number
  affection?: number
  /** The six dimensions beyond `affection` — see `RelationshipDimension`. Missing keys read as 0. */
  relationshipStats?: Partial<Record<RelationshipDimension, number>>
  relationshipStage?: RelationshipStage
  /** 10c's Define-the-Relationship ladder — unset/'none' until asked for and accepted. */
  commitmentStatus?: CommitmentStatus
  /** Set while a committed relationship is under strain and hasn't yet broken or recovered. */
  relationshipWarning?: RelationshipWarning
  /** Break-up count — the "lasting scar" is this counter plus a one-time stat hit, not a hard ceiling. */
  breakupCount?: number
  sceneFlags?: SceneFlag[]
  /** Per-lorebook-entry sticky/cooldown bookkeeping, keyed `${book.sourceKey}:${entry.id}`. Unset = fresh. */
  worldInfoState?: Record<string, { activeUntil?: number; blockedUntil?: number; activeAt?: number }>
  /** Per-chat steering note (SillyTavern's Author's Note) — see `AuthorNote`. */
  authorNote?: AuthorNote
  giftCoins?: number
  giftInventory?: Record<string, number>
  giftsGiven?: Record<string, number>
  /** Owned quantity per `ItemDef.id` — separate from `giftInventory` since items are used/consumed. */
  itemInventory?: Record<string, number>
  /** Owned quantity per `IntimacyUnlockable.id` (toy-category) — shared chat-wide stock like `giftInventory`. Warmth/commitment only gate eligibility to buy; this is actual possession. */
  toyInventory?: Record<string, number>
  unlockedGalleryIds?: string[]
  mood?: CharacterMood
  currentNeed?: CharacterNeed
  characterIntent?: string
  momentum?: number
  plans?: CharacterPlan[]
  firstIntimateSceneAt?: number
  /**
   * The following are the primary character's own copies of the same-named `RelationshipTrack`
   * fields, kept as top-level `Chat` fields for backward compatibility with chats that predate
   * multi-character tracking. See `RelationshipTrack` and `getRelationshipTrack`.
   */
  afterglow?: Afterglow | null
  initiativeBalance?: number
  recentRebuff?: RecentRebuff | null
  intimacyScene?: IntimacyScene | null
  giftLog?: GiftLogEntry[]
  intimacySceneShapeLog?: string[][]
  beliefsAboutUser?: CharacterBelief[]
  expectationsOfUser?: UserExpectation[]
  currentFear?: string
  currentDesire?: string
  reciprocityCue?: ReciprocityCue | null
  /** One-shot world triggers already fired (`world/triggers.ts`). Per chat, so a fork inherits the parent's history and progresses independently after. */
  firedTriggerIds?: string[]
  activeEvent?: DateEventCard
  /** 10b's live rapport read, refreshed each turn only while a date is active, cleared when it ends. Qualitative only — never affects tracked stats. See `src/lib/dating/rapport.ts`. */
  rapport?: RapportRead
  /** Long-term memory log covering everything older than `summaryUpToTimestamp`. */
  summary?: string
  /** Messages with `createdAt <=` this are represented by `summary`, not sent verbatim. */
  summaryUpToTimestamp?: number
  /** Set when this chat was created by forking another one — the source chat's id. */
  parentChatId?: string
  /** The message (in the parent chat) this fork branched off from. */
  forkedFromMessageId?: string
  /** Per-chat overrides for the global relationship-tracking/choice-suggestion toggles (Settings → Generation); unset falls back to the global default. Seeded once from the bound world's template at chat creation, not live-recomputed later. */
  assistOverrides?: {
    autoTrackRelationship?: boolean
    autoSuggestChoices?: boolean
    /** Same fallback; seeded from the bound world's template (Visual Novel forces it on), editable afterward from `RelationshipPanel`. */
    visualNovelMode?: boolean
  }
  /** 10f's proactive outreach bookkeeping — written every world-tick evaluation regardless of outcome, to avoid re-rolling on every app reopen. */
  lastOutreachCheckedAt?: number
  /** True once the world tick has inserted an unprompted message the player hasn't seen yet. Cleared when the chat is opened. */
  hasUnreadOutreach?: boolean
  /** Keeps a chat at the top of `ChatsPanel` regardless of `updatedAt` — the chat-level analog of `StoredMessage.pinned`. */
  pinned?: boolean
  /** Soft-delete timestamp. `GET /api/chats` excludes it, `GET /api/chats/trash` returns only it. Purges for real (`purgeChat` in `server/app.ts`) on request or after `TRASH_RETENTION_MS`. Restoring clears this back to unset. */
  deletedAt?: number
}

export interface WorldInfoBook {
  id: string
  name: string
  book: Lorebook
  /** When `boundChatIds`/`boundCharacterIds`/`boundWorldIds` are all empty the book is global (active everywhere). Otherwise active only for a matching chat/character/world. */
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
  /** Hard constraints (magic system, tech level, taboos) the model should never contradict. */
  rules?: string
  lorebook: Lorebook
  avatarDataUrl?: string
  /** Scene art keyed by background id (`src/lib/vn/backgrounds.ts`) — falls back to a placeholder gradient when missing. */
  backgrounds?: Record<string, string>
  /** Minimum affection required before a tagged background can be selected/displayed. */
  backgroundUnlocks?: Record<string, number>
  /** World-authored scene locations beyond the 12 built-ins — see `CustomBackground`. */
  customBackgrounds?: CustomBackground[]
  /** Background-music URLs keyed by scene mood id (`src/lib/vn/moods.ts`), plus a `default` key. VN mode only. */
  music?: Record<string, string>
  /** Overrides the default gift catalog for characters here. Empty/unset falls back to the built-in catalog. */
  gifts?: GiftItem[]
  /** Per-world item catalog (10d) — no built-in default; empty/unset just means no items yet. */
  items?: ItemDef[]
  /** World-authored additions to the built-in intimacy catalog beyond the ~30 defaults — additive. See `intimacyCatalog.ts`. */
  customIntimacyOptions?: IntimacyUnlockable[]
  /** When true, `customIntimacyOptions` REPLACES the built-in catalog instead of adding to it — for non-humanoid or otherwise very different settings. Ignored when `customIntimacyOptions` is empty. */
  replaceIntimacyCatalog?: boolean
  /** This world's own content rating, overriding global Settings. Unset = inherit global, distinct from explicit `'default'`. `null` on the wire clears back to inherit. See `resolveIntimacyLevel`. */
  intimacyLevel?: IntimacyDetailLevel | null
  /** Author-defined "when X, then Y" rules (`world/triggers.ts`). */
  triggers?: Trigger[]
  /** Overrides the default warmth thresholds for characters here. Unset stages fall back to the default. */
  relationshipThresholds?: Partial<Record<Exclude<RelationshipStage, 'near_strangers'>, number>>
  /** World-authored scene flags beyond the 4 built-ins — see `CustomSceneFlag`. */
  customSceneFlags?: CustomSceneFlag[]
  /** Absolute day count in the shared 112-day calendar (`src/lib/world/calendar.ts`) — 0 if never advanced. */
  currentDay?: number
  /** Index into `calendar.ts`'s `PHASES` (morning/afternoon/evening/night) — 0 if never advanced. */
  currentPhaseIndex?: number
  /** Picked at creation (`src/lib/world/worldTemplates.ts`), editable after — narrows which editor tabs show. Unset behaves like 'dating_sim' (full feature set). */
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
