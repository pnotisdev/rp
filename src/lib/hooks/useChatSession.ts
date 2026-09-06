import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatFactsApi, chatsApi, instructTemplatesApi, messagesApi, objectivesApi, personasApi, relationshipEventsApi, worldInfoBooksApi, worldsApi } from '@/lib/api/client'
import { newId } from '@/lib/id'
import type { AuthorNote, Chat, CommitmentStatus, DateEventCard, MessageIntent, Objective, ObjectiveTask, RelationshipStage, StoredMessage, WorldCard } from '@/lib/types'
import { collectImageBase64, composeMessageText, type PendingAttachment } from '@/lib/attachments'
import { makeGenKey } from '@/lib/api/kobold'
import { generateWithTimeout } from '@/lib/api/generateWithTimeout'
import { useChatBackendClient } from '@/lib/hooks/useChatBackendClient'
import { buildPrompt, estimateTokens, type ChatMessage } from '@/lib/prompt/builder'
import { SUMMARY_MAX_LENGTH, summarizeMessages } from '@/lib/prompt/summarize'
import { generateChoices } from '@/lib/prompt/choices'
import { detectCompletedTasks, generateTasks, suggestObjective } from '@/lib/objectives/objectiveAssist'
import {
  assessCommitmentAsk,
  assessDateOutcome,
  assessIntimacyMilestone,
  assessRelationshipMoment,
  dampenRepeatedDeltas,
  detectGalleryUnlocks,
  draftHiddenAgenda,
  scaleDeltasForDifficulty,
  suggestDateEvent,
} from '@/lib/dating/relationshipAssist'
import { initiativeContribution, nextInitiativeBalance, nextMomentum, slowBurnPacingNote, warmthDeltaOf } from '@/lib/dating/momentum'
import { applyPlanUpdates, planLinesForJudge, plansChanged, plansGuidance } from '@/lib/dating/plans'
import { applyBeliefUpdates, beliefLinesForJudge, beliefsChanged, beliefsGuidance } from '@/lib/dating/beliefs'
import {
  applyExpectationUpdates,
  expectationLinesForJudge,
  expectationsChanged,
  expectationsGuidance,
  violatedExpectationTexts,
} from '@/lib/dating/expectations'
import { repeatedIntentNudge, trailingIntentRun } from '@/lib/dating/intent'
import { isRebuffActive, rebuffGuidance, type RecentRebuff } from '@/lib/dating/rebuff'
import {
  advanceIntimacyScene,
  intimacyAnticipationGuidance,
  intimacyConsentTensionGuidance,
  intimacyPaceFor,
  intimacySceneGuidance,
  isIntimacySceneActive,
  startOrShiftIntimacyScene,
} from '@/lib/dating/intimacyScene'
import { detectAnyBoundaryCrossing } from '@/lib/dating/boundaryGuard'
import { buildSteerDirective } from '@/lib/dating/steer'
import {
  activityPhase,
  describePresence,
  describeWeather,
  describeWorldMoment,
  getCurrentActivity,
  getEnergyRemaining,
  getWeather,
  spendEnergy,
} from '@/lib/world/calendar'
import { evaluateTriggers } from '@/lib/world/triggers'
import {
  ambientEventGuidance,
  describeSocialReaction,
  scheduleConflictGuidance,
  selectAmbientEvent,
  selectSocialReaction,
} from '@/lib/world/ambientEvents'
import { findArchetypeMatch, participantRelationshipGuidance } from '@/lib/chat/participantArchetype'
import {
  applyBreakupScar,
  clampAffection,
  clampStat,
  computeWarmth,
  crossedMilestone,
  evaluateRelationshipRisk,
  FIRST_KISS_FLAG,
  formatCommitmentStatus,
  formatRelationshipStage,
  getRelationshipStats,
  getRelationshipTrack,
  isLiveScene,
  nextCommitmentTier,
  patchRelationshipTrack,
  RELATIONSHIP_DIMENSIONS,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
  unlockedEndingIds,
} from '@/lib/dating/stage'
import {
  appendGiftLog,
  defaultGiftInventory,
  getGiftCatalog,
  giftById,
  giftImpactBase,
  giftMismatchPenalty,
  giftReactionGuidance,
  giftRepetitionMultiplier,
  isReciprocityCueActive,
  recentMeaningfulGiftName,
  reciprocityGuidance,
  trailingSameGiftRun,
  type ReciprocityCue,
} from '@/lib/dating/gifts'
import { createGenerationLock, type GenerationLock } from '@/lib/chat/generationLock'
import { getCoinMutex } from '@/lib/chat/coinMutex'
import { nextRoundRobinSpeaker, parseMention, pickDirectorSpeaker, rosterFrom } from '@/lib/chat/scene'
import { itemById } from '@/lib/dating/items'
import { buildRelationshipDescription } from '@/lib/dating/relationshipDescription'
import { getInstructTemplate, resolveInstructTemplate } from '@/lib/prompt/instructTemplates'
import { intimacyGuidance, resolveIntimacyLevel } from '@/lib/prompt/intimacyGuidance'
import { chatCompletionSamplerToRequest } from '@/lib/api/chatCompletionSampler'
import { extractSceneTag, stripSceneTagForDisplay, type SceneTag } from '@/lib/vn/sceneTag'
import { withIndefiniteArticle } from '@/lib/text/article'
import {
  balanceTrailingMarkup,
  buildSlopAvoidanceNote,
  cleanModelOutput,
  endsCleanly,
  isVerbatimEcho,
  trimToLastSentence,
} from '@/lib/text/slop'
import { normalizeRpMarkup } from '@/lib/text/messageSegments'
import { replyMaxTokens, resolveReplyLength } from '@/lib/characters/voice'
import { SCENE_MOOD_IDS } from '@/lib/vn/moods'
import { DEFAULT_EXPRESSIONS, expressionCandidatesFor } from '@/lib/vn/expressions'
import { getUnlockedBackgroundIds, getUnlockedExpressionIds } from '@/lib/vn/unlocks'
import { currentOutfitFrom, intimateOutfitFor, selectableOutfitIds, spriteKey } from '@/lib/vn/outfits'
import {
  AFTERGLOW_TURNS,
  aftercareDeltas,
  aftercareNeed,
  aftercarePaceContext,
  aftercareReason,
  aftercareToast,
  countCharReplies,
  isAfterglowActive,
  isAfterglowComplete,
  afterglowTurnsSince,
} from '@/lib/dating/aftercare'
import { backgroundLabel } from '@/lib/vn/backgrounds'
import { countStaticSceneTurns, sceneProgressionNudge } from '@/lib/prompt/sceneProgression'
import {
  composeIntimacyActionText,
  getUnlockedIntimacyOptions,
  intimacyActionDirective,
  intimacyItemById,
  intimacyOptionsGuidance,
  isExplicitCategory,
  resolveIntimacyPromptNote,
} from '@/lib/dating/intimacyCatalog'
import {
  afterglowGuidance,
  authoredStatePriorityNote,
  characterIntentGuidance,
  desireGuidance,
  fearGuidance,
  moodGuidance,
  needGuidance,
  stockRomancePhrasingNote,
} from '@/lib/prompt/mindGuidance'
import {
  classifyAttachedImageScene,
  detectExpressionFromSprites,
  detectExpressionTextMismatch,
  shortlistExpressions,
} from '@/lib/vn/sceneVision'
import { assessRapport } from '@/lib/dating/rapport'
import { bookAppliesToChat } from '@/lib/worldinfo/scope'
import { buildFactsLorebook } from '@/lib/worldinfo/facts'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { errorMessage, toastError, toastInfo, toastSuccess } from '@/lib/store/useToastStore'
import { playSendBlip } from '@/lib/audio/sfx'
import type { Character, Lorebook } from '@/lib/characters/cardSpec'
import { buildCharacterProfileNote } from '@/lib/characters/profile'
import type { ChoiceOption, RelationshipDimension, RelationshipWarning, Scene, SceneFlag } from '@/lib/types'

/** Minimum number of newly-eligible messages before auto-summarize bothers running (avoids a summarization call on every single turn). */
const MIN_BATCH_FOR_AUTO_SUMMARY = 6

/** Extra generation rounds `runGeneration` allows itself when a reply looks cut off by hitting max_length, before giving up and leaving it as-is. */
const MAX_AUTO_CONTINUE_ROUNDS = 2

/** A chat-level override (`Chat.assistOverrides`) wins over the global Settings → Generation default — unset falls back to it, same precedence style as `Character.instructTemplateId`. */
function effectiveAssistFlag(chatOverride: boolean | undefined, globalDefault: boolean): boolean {
  return chatOverride ?? globalDefault
}

/**
 * Loads an image URL and re-encodes it small — the §8 vision scene pass only needs a face-sized
 * thumbnail to classify an expression, and the stored sprite files are ~1MB PNGs each, which the
 * multimodal projector chews through slowly and several at a time. ~320px JPEG on a white matte
 * (sprites are transparent PNGs; JPEG has no alpha) drops that to tens of KB. Returns base64 with
 * no `data:` prefix, or undefined if the image can't be loaded/drawn.
 */
async function downscaleImageToBase64(url: string, maxEdge = 320): Promise<string | undefined> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.crossOrigin = 'anonymous'
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image load failed'))
      el.src = url
    })
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || maxEdge, img.naturalHeight || maxEdge))
    const w = Math.max(1, Math.round((img.naturalWidth || maxEdge) * scale))
    const h = Math.max(1, Math.round((img.naturalHeight || maxEdge) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
    return dataUrl.slice(dataUrl.indexOf(',') + 1) || undefined
  } catch {
    return undefined
  }
}

/** KoboldCpp's `images` field describes the current context, not per-turn — resend whatever the most recent user turn attached. */
function latestImages(history: StoredMessage[]): string[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const images = history[i].role === 'user' ? history[i].images : undefined
    if (images?.length) return images.map((dataUrl) => dataUrl.slice(dataUrl.indexOf(',') + 1))
  }
  return []
}

/**
 * Coins granted the moment warmth actually crosses into a new relationship stage (see
 * `announceMilestone`) — comparable to a mid-tier gift (`gifts.ts`'s catalog runs roughly 6-28
 * coins). There are only 6 stages total (`RELATIONSHIP_MILESTONES`), so this can fire at most 5
 * times in a relationship's entire lifetime — a genuine occasional high point, not the "constant
 * noise" a per-turn trickle would be.
 */
const STAGE_MILESTONE_COIN_BONUS = 15

/**
 * Coins granted the moment a Define-the-Relationship ask is actually accepted (`askForCommitment`)
 * — bigger than `STAGE_MILESTONE_COIN_BONUS` since only 4 commitment tiers exist total
 * (`COMMITMENT_ORDER`), rarer and more significant than an ordinary warmth-band crossing.
 * Comparable to the priciest end of the gift/toy catalogs (`gifts.ts`/`intimacyCatalog.ts` top out
 * around 28-30 coins).
 */
const COMMITMENT_ACCEPTED_COIN_BONUS = 25

/**
 * Coins granted the moment a chat's own objective — not a formal date/hangout, which already earns
 * its own affection-scaled payout via `endDateEvent` — is marked complete (`setObjectiveStatus`).
 * Comparable to a common-to-uncommon gift (`gifts.ts`): this is the one earning moment available to
 * a player who mostly just talks and works toward ordinary objectives instead of deliberately
 * starting dates.
 */
const OBJECTIVE_COMPLETE_COIN_BONUS = 12

/**
 * Fires the player-facing toast for a warmth-band crossing (10c's "Milestones" — the banner half;
 * a next-morning text and a social-circle ripple stay open, both needing machinery this doesn't
 * have yet), records it as a `ChatFact` "keepsake memory" — so the model actually knows the
 * relationship deepened rather than only the unlock gates silently changing underneath it — and
 * grants a one-time coin bonus (10a's "Economy" bullet): reaching a new relationship high is
 * exactly the kind of discrete, occasional, meaningful moment worth a real, noticed reward, unlike
 * a flat per-turn trickle (see the comment in `updateAffectionFromReply` this replaced). Runs the
 * coin write inside the coin mutex like every other `giftCoins` touch in this file (`coinMutex.ts`),
 * re-reading the live balance rather than trusting a caller's possibly-stale snapshot.
 */
async function announceMilestone(opts: {
  charName: string
  personaName: string
  chatId: string
  previousStage: RelationshipStage
  relationshipStage: RelationshipStage
  sourceMessageId?: string
  /** Item 6: whose track to open a reciprocity window on, and the turn to stamp it with — both omitted (rare, pre-multi-character-tracking call sites) simply skips that part rather than guessing a target. */
  characterId?: string
  turnCount?: number
}): Promise<void> {
  if (!crossedMilestone(opts.previousStage, opts.relationshipStage)) return
  const label = formatRelationshipStage(opts.relationshipStage)
  const coinsGranted = await getCoinMutex(opts.chatId).run(async () => {
    const liveChat = await chatsApi.get(opts.chatId)
    if (!liveChat) return 0
    await chatsApi.update(opts.chatId, { giftCoins: Math.max(0, (liveChat.giftCoins ?? 0) + STAGE_MILESTONE_COIN_BONUS) })
    return STAGE_MILESTONE_COIN_BONUS
  })
  toastSuccess(`${opts.charName}'s relationship with you is now "${label}"${coinsGranted ? ` — +${coinsGranted} coins` : ''}`, { chime: true })
  chatFactsApi
    .create({
      chatId: opts.chatId,
      text: `${opts.personaName} and ${opts.charName}'s relationship recently deepened to "${label}."`,
      sourceMessageId: opts.sourceMessageId,
    })
    .catch(() => {})
  if (opts.characterId) {
    const freshChat = await chatsApi.get(opts.chatId)
    if (freshChat) {
      await chatsApi.update(
        opts.chatId,
        patchRelationshipTrack(freshChat, opts.characterId, {
          reciprocityCue: { startedAtTurn: opts.turnCount ?? 0, reason: 'milestone' },
        }),
      )
    }
  }
}

/**
 * The shared choke point for 10c's "Breakups & reconciliation" — called after every relationship-
 * stat recomputation (per-turn, end-of-date, and a DTR ask), so the pure decision in
 * `evaluateRelationshipRisk` only has to be wired up once. Applies the one-time stat scar and
 * fires the matching toast; callers persist the returned `commitmentStatus`/`relationshipWarning`/
 * `breakupCount` alongside whatever else they're already updating.
 */
function applyRelationshipRisk(opts: {
  charName: string
  commitmentStatus: CommitmentStatus
  stats: Record<RelationshipDimension, number>
  existingWarning?: RelationshipWarning
  breakupCount: number
}): {
  commitmentStatus: CommitmentStatus
  stats: Record<RelationshipDimension, number>
  relationshipWarning?: RelationshipWarning
  breakupCount: number
  warnedJustNow: boolean
  brokeUpJustNow: boolean
  clearedJustNow: boolean
} {
  const result = evaluateRelationshipRisk({
    commitmentStatus: opts.commitmentStatus,
    stats: opts.stats,
    existingWarning: opts.existingWarning,
    breakupCount: opts.breakupCount,
  })
  let stats = opts.stats
  if (result.brokeUpJustNow) {
    stats = applyBreakupScar(opts.stats)
    toastError(`${opts.charName} broke things off — the strain never got resolved in time.`)
  } else if (result.warnedJustNow) {
    toastError(`${opts.charName}'s relationship is on the rocks: ${result.warning?.reason}. Fix things before it's too late.`)
  } else if (result.clearedJustNow) {
    toastSuccess(`${opts.charName}'s relationship has stabilized.`, { chime: true })
  }
  return {
    commitmentStatus: result.commitmentStatus,
    stats,
    relationshipWarning: result.warning,
    breakupCount: result.breakupCount,
    warnedJustNow: result.warnedJustNow,
    brokeUpJustNow: result.brokeUpJustNow,
    clearedJustNow: result.clearedJustNow,
  }
}

/**
 * Until now, relationship state only ever gated WHICH content is available (lorebook entries,
 * sprites, backgrounds, gallery) — nothing ever told the model itself how the relationship is
 * going, so a character's in-character warmth couldn't actually track the numbers under the
 * hood unless an author happened to write affection-gated lore for every stage. This builds one
 * short, qualitative nudge (never raw numbers) for the same late "right before generation" slot
 * the objective block already uses — the placement `builder.ts` itself notes is most effective.
 */
/**
 * 10d's "Authored reactions" — richer than the numeric `giftPreferences[-2..3]` score, which only
 * ever drives the mechanical affection delta a gift gives, never the model's own in-character
 * reaction. Folded into the same always-on relationship line rather than a gift-turn-only prompt
 * section, so the model already has the character's tastes in context the moment `*I give X gift*`
 * shows up in the same turn's user message — no new plumbing needed to detect "a gift was just given."
 */
function sanitizeSceneTag(
  scene: SceneTag | undefined,
  unlockedExpressions: string[],
  unlockedBackgrounds: string[],
  /** The outfit ids the model was actually offered this turn (`selectableOutfitIds`). Omitted for a character with no outfit art, where an `outfit=` tag can only be invention. */
  selectableOutfits?: string[],
): SceneTag | undefined {
  if (!scene) return undefined
  const cleaned: SceneTag = {}
  if (scene.expression && unlockedExpressions.includes(scene.expression)) cleaned.expression = scene.expression
  if (scene.background && unlockedBackgrounds.includes(scene.background)) cleaned.background = scene.background
  // Mood isn't unlock-gated (music isn't affection-locked), just checked against the known set.
  if (scene.mood && SCENE_MOOD_IDS.includes(scene.mood)) cleaned.mood = scene.mood
  // Dropped rather than coerced to base: an unset outfit means "no change" downstream, so a bad
  // tag leaves the character in whatever they were already wearing instead of yanking them back
  // to base art mid-scene. A locked or `manualOnly` outfit never appears in `selectableOutfits`,
  // so this is the same gate the prompt menu used, re-applied to what came back.
  if (scene.outfit && selectableOutfits?.includes(scene.outfit)) cleaned.outfit = scene.outfit
  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

function hasRequiredFlags(required: string[] | undefined, flags: Set<SceneFlag>): boolean {
  if (!required?.length) return true
  return required.every((f) => flags.has(f as SceneFlag))
}

/**
 * Section 15's "Generation HUD" — live feedback while the model is working, distinct from
 * `showTokenCounts`' per-message-after-the-fact count. Entirely client-side, timed from this
 * round's own SSE stream (see `runGeneration`'s own comment for why `/api/extra/perf` was tried
 * and dropped — it reports the server's single most recent generation of any kind, which a
 * concurrent post-reply assist call can and did misattribute live). `tokensPerSec`/`firstTokenMs`
 * update on every token while streaming, then get one final recompute over the round's full
 * duration when it finishes. `contextUsed`/`contextBudget` come straight from the same
 * `buildPrompt` result every generation already computes, no extra call.
 */
export interface GenerationStats {
  tokensPerSec: number
  firstTokenMs: number
  contextUsed: number
  contextBudget: number
  /** True once this round has finished (the numbers are final) — still climbing mid-stream until then. */
  measured: boolean
}

export function useChatSession(chatId: string | null) {
  const sampler = useSettingsStore((s) => s.sampler)
  const chatBackend = useSettingsStore((s) => s.chatBackend)
  const chatCompletionSampler = useSettingsStore((s) => s.chatCompletionSampler)
  const instructTemplateId = useSettingsStore((s) => s.instructTemplateId)
  const autoSummarize = useSettingsStore((s) => s.autoSummarize)
  const keepRecentMessages = useSettingsStore((s) => s.keepRecentMessages)
  const summaryDetail = useSettingsStore((s) => s.summaryDetail)
  const autoDetectTasks = useSettingsStore((s) => s.autoDetectTasks)
  const autoTrackRelationship = useSettingsStore((s) => s.autoTrackRelationship)
  const relationshipDifficulty = useSettingsStore((s) => s.relationshipDifficulty)
  const autoSuggestChoices = useSettingsStore((s) => s.autoSuggestChoices)
  const regexScripts = useSettingsStore((s) => s.regexScripts)
  const reducedAudio = useSettingsStore((s) => s.reducedAudio)
  const styleGuidanceNote = useSettingsStore((s) => s.styleGuidance)
  const avoidEmDashes = useSettingsStore((s) => s.avoidEmDashes)
  const slowBurnPacing = useSettingsStore((s) => s.slowBurnPacing)
  const globalIntimacyLevel = useSettingsStore((s) => s.intimacyLevel)
  const visionSceneDetection = useSettingsStore((s) => s.visionSceneDetection)
  const globalSystemPrompt = useSettingsStore((s) => s.systemPrompt)
  const globalPostHistory = useSettingsStore((s) => s.postHistoryInstructions)
  const promptSections = useSettingsStore((s) => s.promptSections)
  const setActiveChatId = useSettingsStore((s) => s.setActiveChatId)
  const client = useChatBackendClient()
  const customInstructTemplates = useApiQuery('instruct-templates', () => instructTemplatesApi.list(), []) ?? []

  const chat = useApiQuery('chats', () => (chatId ? chatsApi.get(chatId) : Promise.resolve(undefined)), [chatId])
  const character = useApiQuery(
    'characters',
    () => (chat ? charactersApi.get(chat.characterId) : Promise.resolve(undefined)),
    [chat?.characterId],
  )
  // A character's own override wins over the global Settings -> Generation default; empty/unset falls back.
  // A hosted chat-completion backend formats its own turns — the active instruct template's own
  // reserved tokens (ChatML's `<|im_start|>`, Llama 3's `<|eot_id|>`, ...) have no meaning there and
  // would otherwise leak into the system/user message content as literal text (only `plain-chat`'s
  // empty affixes happen to hide this). Force the token-free, name-prefixed `plain-chat` template
  // for this backend instead; KoboldCpp keeps using whatever the user actually has configured.
  const template =
    chatBackend === 'openai-compatible'
      ? getInstructTemplate('plain-chat')
      : resolveInstructTemplate(character?.instructTemplateId || instructTemplateId, customInstructTemplates)
  // Extra characters in a group chat, beyond the primary — [] for today's ordinary single-character
  // chats. Fetched by id rather than a batched endpoint since the character list is small (a local,
  // single-user app) and this reuses the exact same reactive `characters` resource as `character` above.
  const participantIds = chat?.participants ?? []
  const participantCharacters = useApiQuery(
    'characters',
    () => Promise.all(participantIds.map((id) => charactersApi.get(id))).then((list) => list.filter((c): c is Character => !!c)),
    [participantIds.join(',')],
  ) ?? []
  const persona = useApiQuery(
    'personas',
    () => (chat?.personaId ? personasApi.get(chat.personaId) : Promise.resolve(undefined)),
    [chat?.personaId],
  )
  const world = useApiQuery(
    'worlds',
    () => (character?.worldId ? worldsApi.get(character.worldId) : Promise.resolve(undefined)),
    [character?.worldId],
  )
  const messages = useApiQuery(
    'messages',
    () => (chatId ? messagesApi.listByChat(chatId) : Promise.resolve([])),
    [chatId],
  ) ?? []
  const worldInfoBooks = useApiQuery('world-info-books', () => worldInfoBooksApi.list(), []) ?? []
  const chatFacts = useApiQuery(
    'chat-facts',
    () => (chatId ? chatFactsApi.listByChat(chatId) : Promise.resolve([])),
    [chatId],
  ) ?? []
  const activeFacts = useMemo(() => chatFacts.filter((f) => f.active), [chatFacts])
  const activeObjective = useApiQuery(
    'objectives',
    () => (chatId ? objectivesApi.getActive(chatId) : Promise.resolve(undefined)),
    [chatId],
  )

  const [isGenerating, setIsGenerating] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [generatingMessageId, setGeneratingMessageId] = useState<string | null>(null)
  const [genStats, setGenStats] = useState<GenerationStats | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const genKeyRef = useRef<string>('')
  const summarizingRef = useRef(false)
  /**
   * The single-generation lock (`generationLock.ts`). `isGenerating` above is React state, which
   * every entry point here used to guard on directly — but state only reflects a run that started
   * at least one render ago, and each callback reads the value captured in its own closure. Two
   * calls dispatched inside the same tick therefore both saw `false` and both proceeded,
   * interleaving writes against the same message row: observed live as a saved message whose
   * `rawText` came from one run while its `text`/`failed` came from another. `sendUserMessage` had
   * the worse version of it — a double send created two user messages *and* two placeholder
   * replies before either generation began, since every early `messagesApi.create` happens before
   * the first `await` that would have let a state update land.
   *
   * The lock is claimed and released synchronously, so a second caller observes the first's claim
   * immediately, with no render in between. Held by the *entry point* for its whole awaited body
   * (not by `runGeneration`, which several callers reach only after their own setup writes), so
   * the window those writes sit in is inside the lock rather than in front of it. `isGenerating`
   * stays exactly as it was for the UI — it's the render-visible mirror, not the guard.
   *
   * Lazily built rather than `useRef(createGenerationLock())`, which would allocate a fresh lock
   * on every render only to discard it.
   */
  const generationLockRef = useRef<GenerationLock | null>(null)
  if (!generationLockRef.current) generationLockRef.current = createGenerationLock()
  const beginGeneration = useCallback(() => generationLockRef.current!.begin(), [])
  const endGeneration = useCallback(() => generationLockRef.current!.end(), [])
  // Sprite URL -> base64 payload, memoised for the lifetime of the hook so the vision scene-detect
  // pass (§8) doesn't re-fetch and re-encode the same handful of sprite files on every VN turn.
  const spriteBase64Ref = useRef<Map<string, string>>(new Map())
  // Who a freshly-sent user message's reply gets generated as — null/primary for every ordinary
  // chat. Only meaningful when `chat.participants` is non-empty (group chats); manual, not
  // AI-directed, by design (see ROADMAP.md's group-chat scope notes).
  const [replyAsCharacterId, setReplyAsCharacterId] = useState<string | null>(null)
  useEffect(() => {
    setReplyAsCharacterId(null)
  }, [chatId])

  // 10f's proactive outreach: opening a chat that has an unread unprompted message clears its
  // ChatsPanel badge. Reads `chat.hasUnreadOutreach` from the live query rather than chatId alone,
  // so a tick that sets the flag while this exact chat is already open still gets cleared once the
  // query re-fetches (the tick itself also checks activeChatId to avoid setting it in that case,
  // but this is the belt to that belt-and-suspenders).
  useEffect(() => {
    if (chat?.id && chat.hasUnreadOutreach) {
      chatsApi.update(chat.id, { hasUnreadOutreach: false }).catch(() => {})
    }
  }, [chat?.id, chat?.hasUnreadOutreach])

  // Background "assist" work kicked off after a reply lands — memory summary, objective checks,
  // relationship scoring, choice suggestions. Each is its own model call, and on a local
  // single-GPU KoboldCpp server they queue up (and ahead of the next reply), so the roadmap
  // wants the wait legible rather than a result that silently pops in seconds later. `key -> label`.
  const [assistTasks, setAssistTasks] = useState<Record<string, string>>({})
  useEffect(() => {
    setAssistTasks({})
  }, [chatId])
  const runAssist = useCallback((key: string, label: string, fn: () => Promise<unknown>) => {
    setAssistTasks((t) => ({ ...t, [key]: label }))
    void Promise.resolve()
      .then(fn)
      .catch(() => {})
      .finally(() =>
        setAssistTasks((t) => {
          if (!(key in t)) return t
          const { [key]: _drop, ...rest } = t
          return rest
        }),
      )
  }, [])
  // Fixed order so the strip doesn't reshuffle as tasks finish at different times.
  const assistActivity = ['relationship', 'rapport', 'choices', 'tasks', 'summary', 'vision']
    .map((k) => assistTasks[k])
    .filter((label): label is string => !!label)

  // Resolves which character's card is "active" (gets the full system_prompt/description/
  // personality/scenario treatment) for a given speaker id, plus everyone else in the scene as a
  // compact roster — reused by both prompt-building and generation so they never disagree about
  // who's speaking.
  const resolveSpeaker = useCallback(
    (speakerId: string | null | undefined) => {
      const sceneCharacters = character ? [character, ...participantCharacters] : participantCharacters
      const active = (speakerId && sceneCharacters.find((c) => c.id === speakerId)) || character
      const roster = active ? sceneCharacters.filter((c) => c.id !== active.id) : []
      return { active, roster }
    },
    [character, participantCharacters],
  )

  const countTokens = useCallback(
    async (text: string) => {
      if (!text) return 0
      try {
        const r = await client.tokenCount(text)
        return r.count
      } catch {
        return estimateTokens(text)
      }
    },
    [client],
  )

  const buildCurrentPrompt = useCallback(
    async (
      historyForPrompt: ChatMessage[],
      opts?: {
        continueLastTurn?: boolean
        impersonateAsUser?: boolean
        speakerId?: string | null
        /** This turn's player intent chip, if any — used only to detect a repeated-intent streak for the diminishing-returns nudge. */
        intent?: MessageIntent
        /** One-off addition to `styleGuidance`, for a generation shape none of the standing settings cover — e.g. 10b's live-scene opener, "you're breaking the ice, not replying to a message." Never persisted, never reused past this one call. */
        extraStyleGuidance?: string
      },
    ) => {
      if (!character || !chat) return null
      const { active: speaker, roster } = resolveSpeaker(opts?.speakerId)
      if (!speaker) return null
      // Read the chat record fresh rather than trusting the reactive `chat` closure, which can
      // be one render behind a summary update that just landed (this fn may be called in the
      // same tick as that write, before useApiQuery's subscription has re-rendered us).
      const freshChat = (await chatsApi.get(chat.id)) ?? chat
      // Every character present in the scene contributes their own lore, not just whoever's
      // currently speaking — a roster member's card_book stays active in the background.
      // `sourceKey` is stamped on each so sticky/cooldown state (Chat.worldInfoState) has a
      // key that's stable turn-to-turn even as the roster / book list is reassembled.
      const lorebooks: Lorebook[] = [speaker, ...roster]
        .filter((c) => !!c.card.character_book)
        .map((c) => ({ ...c.card.character_book!, sourceKey: `char:${c.id}` }))
      const boundBooks = worldInfoBooks
        .filter((b) =>
          bookAppliesToChat(b, {
            chatId: freshChat.id,
            characterId: character.id,
            worldId: character.worldId,
          }),
        )
        .map((b) => ({ ...b.book, sourceKey: `book:${b.id}` }))
      const worldLorebook = world?.lorebook ? [{ ...world.lorebook, sourceKey: `world:${world.id}` }] : []
      const factsLorebook = buildFactsLorebook(activeFacts).map((b) => ({ ...b, sourceKey: 'facts' }))
      const affection = freshChat.affection ?? 0
      const worldDescriptionLines = [
        ...(world
          ? [
              world.description?.trim(),
              world.rules?.trim() ? `World rules: ${world.rules.trim()}` : '',
              describeWorldMoment({
                worldId: world.id,
                characterId: speaker.id,
                day: world.currentDay ?? 0,
                phaseIndex: world.currentPhaseIndex ?? 0,
                weatherPreferences: speaker.weatherPreferences,
              }),
              // Only worth a prompt line when this character actually has a schedule authored —
              // otherwise every character would get a generic "is currently free" non-fact.
              speaker.schedule?.length
                ? describePresence(getCurrentActivity(speaker.schedule, world.currentDay ?? 0, world.currentPhaseIndex ?? 0))
                : '',
            ]
          : []),
        freshChat.activeEvent?.title
          ? `Current event: ${freshChat.activeEvent.title}${freshChat.activeEvent.description ? `. ${freshChat.activeEvent.description}` : ''}`
          : '',
        // Section 4/12's Scene entity — location/atmosphere framing, independent of whether this
        // chat even has a bound World, so a plain group chat with no World at all can still be
        // told where it's happening.
        freshChat.scene?.location ? `Scene location: ${freshChat.scene.location}` : '',
        freshChat.scene?.atmosphere ? `Scene atmosphere: ${freshChat.scene.atmosphere}` : '',
      ].filter(Boolean)
      const worldDescription = worldDescriptionLines.length > 0 ? worldDescriptionLines.join('\n') : undefined

      // Ordinary chat has no push to ever change the physical setting otherwise — the scene-tag
      // instruction only asks the model to label wherever the story already is, never to progress
      // it. Suppressed during a live hangout/date: that event *is* the scene change, and nudging
      // toward yet another one mid-event would fight the "stay here until it resolves" point of it.
      const { count: staticSceneTurns, currentBackground: staticSceneBackground } = countStaticSceneTurns(messages)
      const speakerPresence = speaker.schedule?.length
        ? getCurrentActivity(speaker.schedule, world?.currentDay ?? 0, world?.currentPhaseIndex ?? 0)
        : undefined
      const scheduleLocation = speakerPresence?.location
      // A genuine schedule conflict (busy/sleeping/traveling per the character's own authored
      // routine) reads as a real, noticed cost rather than the schedule silently not existing —
      // see `world/ambientEvents.ts`'s own doc comment. Suppressed during a live event for the same
      // reason `sceneNudge` is: the event itself already carries whatever cost starting it had.
      const scheduleConflictLine =
        !freshChat.activeEvent && speakerPresence ? scheduleConflictGuidance(speaker.card.name, speakerPresence) : ''
      const sceneNudge = freshChat.activeEvent
        ? ''
        : sceneProgressionNudge(staticSceneTurns, {
            scheduleLocation,
            alternateBackgroundLabels: scheduleLocation
              ? undefined
              : getUnlockedBackgroundIds(world, affection)
                  .filter((id) => id !== staticSceneBackground)
                  .slice(0, 3)
                  .map((id) => backgroundLabel(id, world)),
          })
      // A concrete, authored-data-grounded "something's going on" hook (a holiday, weather the
      // character loves/hates, a routine gap, a goal on their mind, an idle-time interest) — see
      // `world/ambientEvents.ts`. Suppressed during a live event for the same reason `sceneNudge`
      // is: the event itself is already the scene's content.
      const ambientLine = freshChat.activeEvent
        ? ''
        : ambientEventGuidance({
            charName: speaker.card.name,
            characterId: speaker.id,
            chatId: freshChat.id,
            charTurnCount: countCharReplies(messages),
            event: selectAmbientEvent({
              worldId: world?.id,
              characterId: speaker.id,
              day: world?.currentDay ?? 0,
              phaseIndex: world?.currentPhaseIndex ?? 0,
              schedule: speaker.schedule,
              likes: speaker.likes,
              goals: speaker.goals,
              frequentedLocations: speaker.frequentedLocations,
              weatherPreferences: speaker.weatherPreferences,
            }),
          })

      // What this specific relationship has earned so far (places to kiss, and — once the user has
      // explicit content turned on — positions/toys/other intimate beats), offered as a bank of
      // ideas the model can draw from if a scene genuinely goes there. See `intimacyCatalog.ts`.
      const speakerTrack = getRelationshipTrack(freshChat, speaker.id)
      const speakerStats = getRelationshipStats(speakerTrack)
      const speakerWarmth = computeWarmth(speakerTrack.affection ?? 0, speakerStats)
      // A `style_guidance` world rule (`world/triggers.ts`) is meant to colour THIS turn's writing
      // (e.g. "gifts read as loaded right now" while a jealousy flag is hot), not just the next one
      // — the real, persisting evaluation in `updateAffectionFromReply` only runs after this reply
      // already exists. This is a second, read-only preview pass against the pre-turn state already
      // computed above: it never persists `firedIds` or applies any other action kind (that stays
      // solely the post-turn call's job), so a one-shot rule can't get marked "fired" here — it can
      // only ever add prompt text before its real evaluation actually happens. Primary-only, same
      // scoping as the real evaluation ("a world rule describes the player's relationship with the
      // character whose world it is").
      const triggerStyleLines =
        speaker.id === character.id && world?.triggers?.length
          ? evaluateTriggers(
              world.triggers,
              {
                affection: speakerTrack.affection ?? 0,
                warmth: speakerWarmth,
                stats: speakerStats,
                flags: new Set(freshChat.sceneFlags ?? []),
                commitmentStatus: speakerTrack.commitmentStatus ?? 'none',
                day: world?.currentDay,
              },
              freshChat.firedTriggerIds ?? [],
            )
              .actions.filter((a): a is Extract<typeof a, { kind: 'style_guidance' }> => a.kind === 'style_guidance')
              .map((a) => a.text)
          : []
      const triggerStyleLine = triggerStyleLines.join(' ')
      // A toy only ever reaches the model once actually bought (`Chat.toyInventory`) — warmth/
      // commitment alone just gate *eligibility to buy*, see `intimacyCatalog.ts`.
      const ownedToyIds = new Set(Object.keys(freshChat.toyInventory ?? {}))
      // A world's own content rating wins over the global Settings dial — see `resolveIntimacyLevel`.
      const intimacyLevel = resolveIntimacyLevel(world?.intimacyLevel, globalIntimacyLevel)
      const intimacyOptions = intimacyOptionsGuidance(
        getUnlockedIntimacyOptions(speakerWarmth, speakerTrack.commitmentStatus ?? 'none', world, ownedToyIds),
        intimacyLevel,
      )

      // "Character Mind" scoped slice — a transient mood, an underlying need, and a private
      // intention, all deliberately separate from the relationship track above. See `prompt/mindGuidance.ts`.
      // The aftermath of an intimate scene, for as long as the window is open (`aftercare.ts`).
      // Unlike mood/need/intent below it, this is app-known rather than judge-inferred — the
      // player initiated the scene through a real action, so there is nothing to guess at.
      const afterglowSince = afterglowTurnsSince(speakerTrack.afterglow ?? undefined, countCharReplies(messages))
      const afterglowLine =
        afterglowSince !== null && isAfterglowActive(speakerTrack.afterglow ?? undefined, countCharReplies(messages))
          ? afterglowGuidance(speaker.card.name, persona?.name || 'You', afterglowSince, speakerTrack.afterglow?.sourceLabel)
          : ''
      const moodLine = moodGuidance(speaker.card.name, persona?.name || 'You', speakerTrack.mood)
      const needLine = needGuidance(speaker.card.name, speakerTrack.currentNeed)
      const intentLine = characterIntentGuidance(speaker.card.name, speakerTrack.characterIntent)
      // The third leg alongside need/intent — see `mindGuidance.ts`'s `fearGuidance` doc comment.
      const fearLine = fearGuidance(speaker.card.name, speakerTrack.currentFear)
      // Item 5's want-axis undercurrent — see `mindGuidance.ts`'s `desireGuidance` doc comment.
      const desireLine = desireGuidance(speaker.card.name, speakerTrack.currentDesire)
      // The persistent agency layer — a few turn-spanning intentions the character carries of their
      // own (`dating/plans.ts`), formed and retired by the same judge call that sets mood/need/intent.
      const plansLine = plansGuidance(speaker.card.name, persona?.name || 'You', speakerTrack.plans)
      // Standing impressions of, and expectations of, {{user}} — the "what does she think of him"
      // layer `plans`/`mood`/`need` didn't cover (`dating/beliefs.ts`/`dating/expectations.ts`).
      const beliefsLine = beliefsGuidance(speaker.card.name, persona?.name || 'You', speakerTrack.beliefsAboutUser)
      const expectationsLine = expectationsGuidance(speaker.card.name, persona?.name || 'You', speakerTrack.expectationsOfUser)
      // Item 5: a concrete, testable override for a model's own trained romantic defaults winning
      // over this specific character's authored state. Only fires on an actual tension worth naming
      // — a resistant mood, or a `distance`-kind plan (the character deliberately holding back) —
      // never a blanket restatement of "stay in character" that's already implicit every turn.
      const priorityLine = authoredStatePriorityNote(
        speaker.card.name,
        speakerTrack.mood,
        (speakerTrack.plans ?? []).some((p) => p.kind === 'distance'),
        !!speaker.boundaries?.length,
      )
      // Item 1's character-specificity signal — read once, shared by both the intimacy-scene phase
      // text below and `advanceIntimacyScene`'s own phase-gating in `updateAffectionFromReply`.
      const speakerHoldingBackByPlan = (speakerTrack.plans ?? []).some((p) => p.kind === 'distance')
      const speakerPace = intimacyPaceFor(speakerTrack.mood, speakerHoldingBackByPlan, speaker.boundaries?.length ?? 0)
      const speakerSceneActive = isIntimacySceneActive(speakerTrack.intimacyScene, countCharReplies(messages))
      // Item 1's intimacy scene state machine — physical continuity plus phase-scaled sensory
      // guidance, only while a scene is currently active (see `updateAffectionFromReply` for where
      // its phase actually advances, driven by the same per-turn judge call).
      const intimacySceneLine = speakerSceneActive
        ? intimacySceneGuidance(speaker.card.name, speakerTrack.intimacyScene!, speakerPace)
        : ''
      // Item 1's mid-scene consent/comfort-vs-chemistry tension — only meaningful while a scene is
      // actually live, same gate as the line above.
      const intimacyConsentTensionLine = speakerSceneActive
        ? (intimacyConsentTensionGuidance(speaker.card.name, speakerStats.comfort, speakerStats.chemistry) ?? '')
        : ''
      // Item 1's deterministic pre-scene buildup — the mirror image of the line above: only while
      // nothing physical has started yet, so it never overlaps with `intimacySceneLine`.
      const intimacyAnticipationLine = !speakerSceneActive
        ? (intimacyAnticipationGuidance(speaker.card.name, persona?.name || 'You', speakerStats.chemistry, speakerStats.comfort) ?? '')
        : ''
      // Item 2's "missed opportunity" cost — a still-live, decaying cue after a real deflection or
      // backfire (`dating/rebuff.ts`), distinct from the hard `relationshipWarning` banner.
      const rebuffLine = isRebuffActive(speakerTrack.recentRebuff, countCharReplies(messages))
        ? rebuffGuidance(speaker.card.name, persona?.name || 'You', speakerTrack.recentRebuff!)
        : ''
      // Item 6's character-initiated gift reciprocity — a still-live, decaying cue after warmth/
      // circumstance has genuinely earned it (`dating/gifts.ts`).
      const reciprocityLine = isReciprocityCueActive(speakerTrack.reciprocityCue, countCharReplies(messages))
        ? reciprocityGuidance(speaker.card.name, persona?.name || 'You', speakerTrack.reciprocityCue!.reason)
        : ''
      // Item 3's second, narrower anti-generic-romance guard — stock romance-writing tells,
      // regardless of whether they've come up before in this specific chat (`buildSlopAvoidanceNote`
      // below only ever catches this character's own verbatim repeats). Gated to actual romantic/
      // intimate moments so an ordinary turn pays nothing for it.
      const stockRomancePhrasingLine = stockRomancePhrasingNote(
        speakerSceneActive || isAfterglowActive(speakerTrack.afterglow ?? undefined, countCharReplies(messages)) || speakerStats.chemistry >= 70,
      )

      // Messages already folded into chat.summary are represented there, not sent verbatim.
      const cutoff = freshChat.summaryUpToTimestamp ?? 0
      const createdAtById = new Map(messages.map((m) => [m.id, m.createdAt]))
      const recentHistory = cutoff
        ? historyForPrompt.filter((m) => (createdAtById.get(m.id) ?? Infinity) > cutoff)
        : historyForPrompt

      // "Suggest what you'd say next" (`impersonateAsUser`) is writing {{user}}'s line, not {{char}}'s
      // — so every steer built for {{char}}'s reply (the objective it's working toward, the
      // relationship nudge, and the character-behaviour half of `styleGuidance` below) is withheld.
      // Left in for it: the world/persona/history context, and the plain writing-style rules, which
      // apply to {{user}}'s line just the same.
      const impersonating = !!opts?.impersonateAsUser
      const pendingTasks = activeObjective?.tasks.filter((t) => t.status === 'pending') ?? []
      const objectiveForPrompt =
        !impersonating && activeObjective && pendingTasks.length > 0
          ? {
              title: activeObjective.title,
              description: activeObjective.description,
              pendingTasks: pendingTasks.map((t) => t.description),
            }
          : undefined
      // Only makes sense when the primary is the one actually speaking — it's a nudge about
      // {{user}}'s relationship with the primary specifically, not something a non-primary
      // participant's own dialogue should be steered by.
      const relationshipDescription =
        !impersonating &&
        effectiveAssistFlag(freshChat.assistOverrides?.autoTrackRelationship, autoTrackRelationship) &&
        speaker.id === character.id
          ? buildRelationshipDescription(freshChat, world, character)
          : undefined
      // The non-primary half of the line above: every other speaking participant got zero
      // relationship-flavor guidance until now, which read as either silence or (worse) borrowing
      // the primary's own romantic warmth. See `chat/participantArchetype.ts`'s own top comment.
      const participantGuidance =
        !impersonating && speaker.id !== character.id
          ? participantRelationshipGuidance({
              speakerName: speaker.card.name,
              personaName: persona?.name || 'You',
              primaryName: character.card.name,
              warmth: speakerWarmth,
              archetype: findArchetypeMatch(
                [character.card.name, persona?.name].filter((n): n is string => !!n),
                [{ connections: character.socialConnections }, { connections: speaker.socialConnections }],
              ),
              // `Chat.commitmentStatus`/`sceneFlags` are always the PRIMARY's own copies (never a
              // non-primary participant's), exactly what a rival's tone should be reading off —
              // see `rivalCommitmentFraming`/`rivalJealousyIntensifier`'s own doc comments.
              primaryCommitmentStatus: freshChat.commitmentStatus,
              jealousyFlagActive: (freshChat.sceneFlags ?? []).includes('jealousy'),
            })
          : undefined
      // Names back to the model the specific AI-prose tells and verbatim repeats this character
      // has just used, so it has something concrete to avoid rather than a generic "write well"
      // line it will agree with and ignore. Costs zero tokens when the recent turns are clean.
      const slopAvoidance = buildSlopAvoidanceNote(
        recentHistory.filter((m) => m.role === 'char' && m.name === speaker.card.name).map((m) => m.text),
      )
      // How long this speaker's turns should run, in a unit the model can count (sentences), taken
      // from their `replyLength` override or measured from their own example dialogue. The matching
      // hard token cap lives in `runGeneration` so brevity survives a model that ignores the line.
      const replyLengthInstruction = resolveReplyLength(speaker.replyLength, speaker.card).instruction
      // The user's own direct feedback from a live playthrough: the character (and the suggested
      // choices around them) only ever reacted, never proposed anything themselves, so a session
      // could sit at "waiting for {{user}} to make every move" indefinitely. Deliberately generic
      // and always-on (not gated behind relationship tracking) — having opinions about what to do
      // next is basic characterization, not a dating-sim-only concern. The character's own likes/
      // frequented locations already reach the model every turn via `buildCharacterProfileNote`;
      // this just tells the model it's allowed to volunteer from that material instead of only
      // answering when asked.
      const activityInitiativeGuidance =
        "Your character doesn't only answer what's put in front of them. Every so often, especially once things feel comfortable, let them bring up an idea of their own: something to do together, a place to go, a topic they're curious about, drawing on their own interests and routine rather than only reacting to what's proposed to them."
      // "Repeated same interaction → diminishing returns": if the player has leaned on the same
      // intent chip several turns running, tell the character to notice rather than keep being moved.
      // `messages` here is a turn behind (this turn's user line is created but not yet re-queried),
      // so `opts.intent` is the current turn folded in.
      const priorUserIntents = messages.filter((m) => m.role === 'user').map((m) => m.intent as string | undefined)
      const repeatNudge = repeatedIntentNudge(
        trailingIntentRun([...priorUserIntents, opts?.intent]),
        speaker.card.name,
        persona?.name || 'You',
      )
      const emDashRule = avoidEmDashes
        ? 'Never use em dashes (the — character) in your writing. Use a comma, period, or parentheses instead.'
        : ''
      const styleGuidance = impersonating
        ? // Impersonation: only the rules that shape prose, not {{char}}'s behaviour or {{char}}'s
          // recent phrasing (the slop-avoidance note is scoped to the character's own turns).
          [emDashRule, styleGuidanceNote.trim(), opts?.extraStyleGuidance ?? ''].filter(Boolean).join(' ') || undefined
        : [
            emDashRule,
            slowBurnPacing
              ? slowBurnPacingNote(speaker.card.name, speakerTrack.mood, speakerHoldingBackByPlan, speakerTrack.currentNeed)
              : '',
            intimacyGuidance(intimacyLevel),
            intimacyOptions,
            activityInitiativeGuidance,
            afterglowLine,
            moodLine,
            needLine,
            intentLine,
            fearLine,
            desireLine,
            plansLine,
            beliefsLine,
            expectationsLine,
            priorityLine,
            stockRomancePhrasingLine,
            intimacySceneLine,
            intimacyConsentTensionLine,
            intimacyAnticipationLine,
            rebuffLine,
            reciprocityLine,
            repeatNudge ?? '',
            sceneNudge,
            scheduleConflictLine,
            triggerStyleLine,
            ambientLine,
            participantGuidance ?? '',
            replyLengthInstruction,
            styleGuidanceNote.trim(),
            slopAvoidance ?? '',
            opts?.extraStyleGuidance ?? '',
          ]
            .filter(Boolean)
            .join(' ') || undefined

      const contextBudget = sampler.max_context_length - sampler.max_length - 32
      return buildPrompt({
        character: speaker.card,
        characterProfile: buildCharacterProfileNote(speaker),
        personaName: persona?.name || 'You',
        personaDescription: persona?.description || '',
        globalSystemPrompt,
        globalPostHistory,
        history: recentHistory,
        chatSummary: freshChat.summary,
        worldDescription,
        lorebooks: [...worldLorebook, ...lorebooks, ...boundBooks, ...factsLorebook],
        template,
        contextBudget: Math.max(contextBudget, 256),
        scanDepth: 8,
        promptSections,
        countTokens,
        continueLastTurn: opts?.continueLastTurn,
        impersonateAsUser: opts?.impersonateAsUser,
        worldInfoState: freshChat.worldInfoState ?? {},
        worldInfoTurn: messages.length,
        activeObjective: objectiveForPrompt,
        relationshipDescription,
        styleGuidance,
        authorNote: freshChat.authorNote,
        regexScripts,
        sceneOptions: {
          // VN scene-tagging stays keyed on the primary for now — per-participant sprites are a
          // separate, larger lift (VNStage is built entirely around one character's sprite state).
          expressionIds: getUnlockedExpressionIds(character, affection),
          backgroundIds: getUnlockedBackgroundIds(world, affection),
          // Only ask for a mood tag when this world actually has music to drive with it — no point
          // spending prompt tokens on a signal the app would then ignore.
          moodIds: world?.music && Object.keys(world.music).length > 0 ? SCENE_MOOD_IDS : undefined,
          // Wardrobe (`outfits.ts`), on the same "only ask for what the app can actually use"
          // rule as mood above: a character with no outfit art gets a single-entry list, which
          // `buildSceneInstruction` treats as no choice and omits from the tag entirely.
          outfitIds: selectableOutfitIds(character.outfits, character.sprites, affection, new Set(freshChat.sceneFlags ?? [])),
          currentOutfitId: currentOutfitFrom(messages),
        },
        affection,
        participants: roster.length
          ? roster.map((c) => ({ name: c.card.name, description: c.card.description, personality: c.card.personality }))
          : undefined,
        nextSpeakerName: speaker.card.name,
      })
    },
    [
      activeFacts,
      activeObjective,
      autoTrackRelationship,
      avoidEmDashes,
      character,
      chat,
      countTokens,
      // Was missing before the world-level override existed, so changing the content rating in
      // Settings left this callback closed over the previous value until some other dependency
      // happened to change. Self-corrected almost immediately in practice (`messages`/`chat` move
      // constantly), but it meant the one setting where being a turn late actually matters was the
      // one not listed.
      globalIntimacyLevel,
      globalPostHistory,
      globalSystemPrompt,
      messages,
      persona,
      promptSections,
      regexScripts,
      resolveSpeaker,
      sampler,
      slowBurnPacing,
      styleGuidanceNote,
      template,
      world,
      worldInfoBooks,
    ],
  )

  const updateMemorySummary = useCallback(
    async (opts?: { force?: boolean }): Promise<string | null> => {
      if (!chat || !character || summarizingRef.current) return chat?.summary ?? null
      const eligible = messages.slice(0, Math.max(0, messages.length - keepRecentMessages))
      const already = chat.summaryUpToTimestamp ?? 0
      const newBatch = eligible.filter((m) => m.createdAt > already && m.text.trim())
      if (newBatch.length === 0) return chat.summary ?? null
      if (!opts?.force && newBatch.length < MIN_BATCH_FOR_AUTO_SUMMARY) return chat.summary ?? null

      summarizingRef.current = true
      try {
        const updated = await summarizeMessages({
          existingSummary: chat.summary ?? '',
          messages: newBatch.map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text })),
          charName: character.card.name,
          userName: persona?.name || 'You',
          detail: summaryDetail,
          voiceFingerprint: character.voiceFingerprint,
          generate: (prompt) =>
            client.generate({
              prompt,
              max_length: SUMMARY_MAX_LENGTH[summaryDetail],
              max_context_length: sampler.max_context_length,
              temperature: 0.4,
              top_p: 1,
              top_k: 0,
              min_p: 0,
              typical: 1,
              tfs: 1,
              rep_pen: 1.1,
              rep_pen_range: 1024,
              rep_pen_slope: 0.7,
            }),
        })
        const summaryUpToTimestamp = newBatch[newBatch.length - 1].createdAt
        await chatsApi.update(chat.id, { summary: updated, summaryUpToTimestamp })
        return updated
      } finally {
        summarizingRef.current = false
      }
    },
    [character, chat, client, keepRecentMessages, messages, persona, sampler.max_context_length, summaryDetail],
  )

  /**
   * Marks the given indices (into `pending`, the exact array a detector was offered) done on
   * `objective`. Shared by the standalone task-detection pass below and the merged
   * relationship+tasks pass in `runGeneration` (section 9(c)'s (a) item) so both write the same way.
   */
  const applyCompletedTasks = useCallback(async (objective: Objective, pending: ObjectiveTask[], completedIndices: number[]) => {
    const completedIds = new Set(completedIndices.map((i) => pending[i].id))
    const now = Date.now()
    const updatedTasks = objective.tasks.map((t) => (completedIds.has(t.id) ? { ...t, status: 'done' as const, completedAt: now } : t))
    await objectivesApi.update(objective.id, { tasks: updatedTasks })
  }, [])

  /**
   * Fire-and-forget: checks whether the reply that just landed accomplished any pending objective
   * tasks. Standalone path only — when relationship-tracking is also due the same turn, this check
   * rides along inside `updateAffectionFromReply`'s own call instead (see `runGeneration`).
   */
  const detectAndMarkTasks = useCallback(
    async (chatIdForTasks: string, replyText: string) => {
      const objective = await objectivesApi.getActive(chatIdForTasks)
      if (!objective) return
      const pending = objective.tasks.filter((t) => t.status === 'pending')
      if (pending.length === 0) return
      const completedIndices = await detectCompletedTasks(
        client,
        replyText,
        pending.map((t) => t.description),
      )
      if (completedIndices.length === 0) return
      await applyCompletedTasks(objective, pending, completedIndices)
    },
    [client, applyCompletedTasks],
  )

  /**
   * Scores relationship movement for whichever character actually just spoke (`speaker`), not
   * always the chat's primary — multi-character relationship tracking's core fix. `speaker`'s own
   * track (`getRelationshipTrack`/`patchRelationshipTrack` in `stage.ts`) resolves to the primary's
   * usual top-level `Chat` fields when they *are* the primary (byte-for-byte the same read/write
   * this function always did), or their own entry in `Chat.participantRelationships` otherwise —
   * every stat/warmth/stage/risk/gallery-unlock function below already took plain values rather
   * than reading `Chat` directly, so none of them needed to change, only what feeds them.
   *
   * `pendingTasks`, when passed, is folded into the same `assessRelationshipMoment` call as a
   * fourth thing checked (section 9(c)'s (a) item) — the returned indices are always handed back
   * to the caller, who applies them via `applyCompletedTasks`, since this function only owns
   * relationship state, not the objective. Omitted/empty when task-detection isn't due this turn,
   * matching every other assist here staying independently toggleable.
   */
  const updateAffectionFromReply = useCallback(
    async (
      chatIdForRelationship: string,
      history: ChatMessage[],
      latestReply: string,
      intent: MessageIntent | undefined,
      speaker: Character,
      pendingTasks?: ObjectiveTask[],
    ): Promise<number[]> => {
      const freshChat = await chatsApi.get(chatIdForRelationship)
      if (!freshChat) return []
      const isPrimary = speaker.id === freshChat.characterId
      const track = getRelationshipTrack(freshChat, speaker.id)
      const currentAffection = track.affection ?? 0
      const currentStats = getRelationshipStats(track)
      const existingFlags = new Set((freshChat.sceneFlags ?? []) as SceneFlag[])
      // The aftercare window closes on the first turn past its length (`aftercare.ts`). The
      // transcript of the window rides along inside the judge call that was already going to run
      // this turn, so a verdict costs no extra model round-trip — the same trick objective-task
      // detection uses. `history` is this turn's own prompt history, so slicing it gives exactly
      // the turns since the scene without a second fetch.
      const openAfterglow = track.afterglow ?? undefined
      const charRepliesNow = countCharReplies(messages)
      const aftercareDue = isAfterglowComplete(openAfterglow, charRepliesNow)
      const aftercareWindow = aftercareDue ? history.slice(-(AFTERGLOW_TURNS * 2 + 2)) : undefined
      // Open threads (unresolved facts) go to the judge in a stable index order so it can mark one
      // closed via `resolvedFactIndices` — same numbered-list / index-return shape as pending tasks.
      const openThreads = activeFacts.filter((f) => f.unresolved)
      // The character's standing plans go to the judge in the same stable numbered-list shape, so
      // its `planUpdates` can annotate or close one by index (and always add new ones).
      const activePlans = track.plans ?? []
      // Item 1's intimacy scene state machine — asked for in the same call, only while a scene is
      // currently active (same ride-along trick `aftercareTurns`/`pendingTasks` already use).
      const openScene = track.intimacyScene ?? undefined
      const sceneActive = isIntimacySceneActive(openScene, charRepliesNow)
      // Beliefs/expectations go to the judge in the same stable numbered-list shape as plans, so
      // their own updates can revise/resolve one by index (and always add new ones).
      const activeBeliefs = track.beliefsAboutUser ?? []
      const activeExpectations = track.expectationsOfUser ?? []
      const {
        deltas: rawDeltas,
        newFlags,
        reason,
        newFacts,
        resolvedFactIndices,
        completedTaskIndices,
        aftercareVerdict,
        mood,
        currentNeed,
        characterIntent,
        planUpdates,
        intimacyPhase,
        beliefUpdates,
        expectationUpdates,
        currentFear,
        currentDesire,
      } = await assessRelationshipMoment(client, {
        history,
        latestReply,
        charName: speaker.card.name,
        userName: persona?.name || 'You',
        current: { affection: currentAffection, ...currentStats },
        knownFacts: activeFacts.map((f) => f.text),
        unresolvedFacts: openThreads.map((f) => f.text),
        activePlans: planLinesForJudge(activePlans),
        customFlags: world?.customSceneFlags,
        intent,
        pendingTasks: pendingTasks?.map((t) => t.description),
        currentMood: track.mood,
        currentNeed: track.currentNeed,
        currentIntent: track.characterIntent,
        currentFear: track.currentFear,
        currentDesire: track.currentDesire,
        aftercareTurns: aftercareWindow,
        aftercarePaceContext: aftercareDue ? aftercarePaceContext(openAfterglow?.momentumAtStart) : undefined,
        currentIntimacyPhase: sceneActive ? openScene!.phase : undefined,
        activeBeliefs: beliefLinesForJudge(activeBeliefs),
        activeExpectations: expectationLinesForJudge(activeExpectations),
        // Item 6: everyone else actually in this scene besides whoever's speaking — a group chat's
        // other participants, present for a jealousy beat to land in front of rather than merely be
        // discussed. `[]`/undefined for the ordinary single-character chat, the common case.
        presentParticipants: [...(character ? [character] : []), ...participantCharacters]
          .filter((c) => c.id !== speaker.id)
          .map((c) => c.card.name),
      })
      // A due window always closes, even if the model declined to name a verdict — leaving it open
      // would keep the aftermath guidance running forever. An unusable answer is read as the
      // middle outcome rather than as "ask again next turn".
      const resolvedAftercare = aftercareDue ? (aftercareVerdict ?? 'awkward') : undefined
      // "Repeated same interaction → diminishing returns": the player playing the same intent chip
      // 3+ turns running scales this turn's positive warmth gains toward nothing (a repeated *bad*
      // move and rising friction pass through). `messages` may not yet carry this turn's user line,
      // so `intent` is folded in explicitly.
      const userIntents = messages.filter((m) => m.role === 'user').map((m) => m.intent as string | undefined)
      if (userIntents[userIntents.length - 1] !== intent) userIntents.push(intent)
      const scaledDeltas = scaleDeltasForDifficulty(
        resolvedAftercare
          ? (Object.fromEntries(
              (['affection', ...RELATIONSHIP_DIMENSIONS] as const).map((k) => [
                k,
                rawDeltas[k] + aftercareDeltas(resolvedAftercare)[k],
              ]),
            ) as typeof rawDeltas)
          : rawDeltas,
        relationshipDifficulty,
      )
      const deltas = trailingIntentRun(userIntents) >= 3 ? dampenRepeatedDeltas(scaledDeltas) : scaledDeltas
      newFlags.forEach((flag) => existingFlags.add(flag))
      if (newFacts.length > 0) {
        const sourceMessageId = history[history.length - 1]?.id
        for (const f of newFacts) {
          chatFactsApi
            .create({
              chatId: chatIdForRelationship,
              text: f.text,
              sourceMessageId,
              importance: f.importance,
              valence: f.valence,
              unresolved: f.unresolved || undefined,
            })
            .catch(() => {})
        }
      }
      for (const i of resolvedFactIndices) {
        const closed = openThreads[i]
        if (closed) chatFactsApi.update(closed.id, { unresolved: false }).catch(() => {})
      }
      const affection = clampAffection(currentAffection + deltas.affection)
      let nextStats = { ...currentStats }
      for (const dim of RELATIONSHIP_DIMENSIONS) nextStats[dim] = clampStat(currentStats[dim] + deltas[dim])
      const milestones = relationshipMilestonesFor(world?.relationshipThresholds)
      const previousStage = relationshipStageForWarmth(computeWarmth(currentAffection, currentStats), milestones)
      const risk = applyRelationshipRisk({
        charName: speaker.card.name,
        commitmentStatus: track.commitmentStatus ?? 'none',
        stats: nextStats,
        existingWarning: track.relationshipWarning ?? undefined,
        breakupCount: track.breakupCount ?? 0,
      })
      nextStats = risk.stats
      const warmth = computeWarmth(affection, nextStats)
      const relationshipStage = relationshipStageForWarmth(warmth, milestones)
      const unlockedSet = new Set(track.unlockedGalleryIds ?? [])
      const previouslyUnlockedIds = new Set(unlockedSet)
      // Endings unlock deterministically off the stage itself, not the AI CG-matching pass below —
      // excluded from `lockedGallery` so they're never sent to `detectGalleryUnlocks`.
      unlockedEndingIds(speaker.gallery, relationshipStage, unlockedSet).forEach((id) => unlockedSet.add(id))
      const lockedGallery = (speaker.gallery ?? []).filter(
        (g) => !g.isEnding && !unlockedSet.has(g.id) && hasRequiredFlags(g.requiredFlags, existingFlags),
      )
      if (lockedGallery.length > 0) {
        const unlockedIds = await detectGalleryUnlocks(client, {
          character: speaker,
          locked: lockedGallery,
          affection,
          latestReply,
        })
        unlockedIds.forEach((id) => unlockedSet.add(id))
      }
      // Author-defined world rules (`world/triggers.ts`), evaluated against the state this turn
      // just produced rather than the state it started from — a trigger keyed on "trust >= 70"
      // should fire on the turn trust actually reaches 70, not one turn later. Only for the
      // primary's own track: a world rule describes the player's relationship with the character
      // whose world it is, and firing one per participant would multiply every authored beat.
      const triggerResult = isPrimary
        ? evaluateTriggers(
            world?.triggers,
            {
              affection,
              warmth,
              stats: nextStats,
              flags: existingFlags,
              commitmentStatus: risk.commitmentStatus,
              day: world?.currentDay,
            },
            freshChat.firedTriggerIds ?? [],
          )
        : undefined
      if (triggerResult) {
        for (const action of triggerResult.actions) {
          if (action.kind === 'set_flag') existingFlags.add(action.flag)
          else if (action.kind === 'remember') {
            chatFactsApi.create({ chatId: chatIdForRelationship, text: action.text }).catch(() => {})
          } else if (action.kind === 'notify') toastInfo(action.text)
          else if (action.kind === 'social_reaction') {
            const reaction = selectSocialReaction({
              characterId: speaker.id,
              chatId: chatIdForRelationship,
              topic: action.topic,
              connections: speaker.socialConnections,
            })
            if (reaction) {
              chatFactsApi
                .create({ chatId: chatIdForRelationship, text: describeSocialReaction(speaker.card.name, reaction) })
                .catch(() => {})
            }
          }
        }
      }

      // Momentum: this turn's warmth movement folded into the decayed running value. Recomputed
      // even on an otherwise-flat turn so a burst actually fades (a stale +4 would keep the pacing
      // clause saying "moving fast" through a quiet stretch); the `noMomentumChange` check below
      // lets a meaningful decay force a small persist.
      const momentum = nextMomentum(track.momentum, warmthDeltaOf(deltas))
      const noMomentumChange = Math.abs(momentum - (track.momentum ?? 0)) < 0.15

      // Item 2's asymmetric-pacing signal: same decayed-running-value shape as momentum above, fed
      // a different per-turn read (who initiated, not how much warmth moved). `intent` is whichever
      // one the player tagged going into this exchange — any tag counts as a deliberate overture.
      const initiativeBalance = nextInitiativeBalance(track.initiativeBalance, initiativeContribution(!!intent, warmthDeltaOf(deltas)))
      const noInitiativeChange = Math.abs(initiativeBalance - (track.initiativeBalance ?? 0)) < 0.15

      // Persistent agency layer: fold this turn's `planUpdates` into the character's plan list
      // (`dating/plans.ts` caps it at 3 and ages stale ones out). `messages.length` is the turn
      // counter, same unit `worldInfoTurn` uses.
      const nextPlans = applyPlanUpdates(activePlans, planUpdates, messages.length)
      const noPlanChange = !plansChanged(activePlans, nextPlans)

      // Standing impressions of/expectations of {{user}} — same cap-and-age lifecycle as plans,
      // applied via their own small modules (`dating/beliefs.ts`/`dating/expectations.ts`).
      const nextBeliefs = applyBeliefUpdates(activeBeliefs, beliefUpdates, messages.length)
      const noBeliefChange = !beliefsChanged(activeBeliefs, nextBeliefs)
      // A violated expectation is memorable enough to earn a durable fact (negative valence) — read
      // off the *pre*-update list, since `applyExpectationUpdates` has already dropped a resolved
      // entry from the list it returns by the time this runs.
      const violatedTexts = violatedExpectationTexts(activeExpectations, expectationUpdates)
      const nextExpectations = applyExpectationUpdates(activeExpectations, expectationUpdates, messages.length)
      const noExpectationChange = !expectationsChanged(activeExpectations, nextExpectations)

      // Item 1's intimacy scene phase advance — only recomputed while a scene is actually active;
      // otherwise carried forward unchanged (including a stale one, which every reader already
      // treats as inactive via `isIntimacySceneActive`, so there's nothing to actively clear here).
      // Item 1's character-specificity signal, same computation `buildCurrentPrompt` uses for the
      // guidance text — read here too so the phase-gating itself (not just the wording) respects it.
      const pace = intimacyPaceFor(mood ?? track.mood, activePlans.some((p) => p.kind === 'distance'), speaker.boundaries?.length ?? 0)
      const nextIntimacyScene = sceneActive ? advanceIntimacyScene(openScene!, intimacyPhase, charRepliesNow, pace) : (openScene ?? null)
      const noSceneChange = JSON.stringify(nextIntimacyScene ?? null) === JSON.stringify(openScene ?? null)

      const noStatChange = Object.values(deltas).every((d) => d === 0)
      const noRiskChange = !risk.warnedJustNow && !risk.brokeUpJustNow && !risk.clearedJustNow
      const noMindChange =
        (!mood || mood === track.mood) &&
        (!currentNeed || currentNeed === track.currentNeed) &&
        (!characterIntent || characterIntent === track.characterIntent) &&
        (!currentFear || currentFear === track.currentFear) &&
        (!currentDesire || currentDesire === track.currentDesire)
      // Coins are NOT granted here — a flat per-turn trickle was tried and deliberately removed
      // (see the "Quiet, player-facing rewards" comment a few lines down): it was silent (no toast)
      // and gated only on `isPrimary`, nothing about whether this turn was actually eventful, so it
      // fired on literally every ordinary reply — exactly the "constant noise" this file already
      // argues against for stat deltas and scene flags. Coins are instead granted at discrete,
      // toasted moments elsewhere — `announceMilestone` (a warmth stage actually crossed),
      // `askForCommitment`'s accept branch (a commitment tier actually accepted),
      // `setObjectiveStatus` (an objective actually completed), and `endDateEvent`'s existing
      // affection-scaled date/hangout payout — so money always reads as a noticed, earned event
      // rather than a number quietly climbing in the background.
      if (
        noStatChange &&
        noRiskChange &&
        noMindChange &&
        noMomentumChange &&
        noInitiativeChange &&
        noPlanChange &&
        noSceneChange &&
        noBeliefChange &&
        noExpectationChange &&
        // A resolved window must always be written, even if its verdict happened to score flat —
        // otherwise `afterglow` stays set and the aftermath guidance runs forever.
        !resolvedAftercare &&
        // Same for a fired trigger: its flag and its spent id both need persisting even on a turn
        // that scored no relationship movement at all.
        !triggerResult?.fired.length &&
        newFlags.length === 0 &&
        unlockedSet.size === (track.unlockedGalleryIds ?? []).length
      ) {
        // Nothing relationship-related moved, but a task can still have completed on a turn that
        // otherwise scored flat — the caller still needs these indices either way.
        return completedTaskIndices
      }
      await chatsApi.update(chatIdForRelationship, {
        ...(triggerResult?.fired.length ? { firedTriggerIds: triggerResult.firedIds } : {}),
        ...patchRelationshipTrack(freshChat, speaker.id, {
          affection,
          relationshipStats: nextStats,
          relationshipStage,
          commitmentStatus: risk.commitmentStatus,
          relationshipWarning: risk.relationshipWarning ?? null,
          breakupCount: risk.breakupCount,
          unlockedGalleryIds: [...unlockedSet],
          mood: mood ?? track.mood,
          // A `cold` aftermath leaves an unmet need behind (`aftercareNeed`), so the consequence
          // keeps colouring the character past the window instead of stopping dead with it. The
          // judge's own read for this turn still wins when it has one — it's the fresher signal,
          // and it may already have noticed something better than "reassurance".
          currentNeed: currentNeed ?? (resolvedAftercare ? aftercareNeed(resolvedAftercare) : undefined) ?? track.currentNeed,
          characterIntent: characterIntent ?? track.characterIntent,
          currentFear: currentFear ?? track.currentFear,
          currentDesire: currentDesire ?? track.currentDesire,
          momentum,
          initiativeBalance,
          plans: nextPlans,
          beliefsAboutUser: nextBeliefs,
          expectationsOfUser: nextExpectations,
          // `null`, not `undefined` — `JSON.stringify` drops undefined-valued keys, so an
          // undefined here would silently leave the window open. Same trap `relationshipWarning`
          // one field up already documents.
          afterglow: resolvedAftercare ? null : (track.afterglow ?? null),
          intimacyScene: nextIntimacyScene,
        }),
        sceneFlags: [...existingFlags],
      })
      // A broken expectation is a real, memorable letdown, not a quiet removal — give it the same
      // durable-fact treatment a hard-landing event already gets, negative valence baked in.
      for (const text of violatedTexts) {
        chatFactsApi
          .create({
            chatId: chatIdForRelationship,
            text: `${speaker.card.name} had started expecting ${text}, and it didn't happen.`,
            importance: 0.6,
            valence: -0.5,
          })
          .catch(() => {})
      }
      if (resolvedAftercare) {
        const changed = Object.fromEntries(
          Object.entries(aftercareDeltas(resolvedAftercare)).filter(([, v]) => v !== 0),
        )
        relationshipEventsApi
          .create({
            chatId: chatIdForRelationship,
            characterId: speaker.id,
            reason: aftercareReason(resolvedAftercare),
            deltas: changed,
            sourceMessageId: history[history.length - 1]?.id,
          })
          .catch(() => {})
        const note = aftercareToast(speaker.card.name, resolvedAftercare)
        if (note) {
          if (resolvedAftercare === 'cold') toastInfo(note)
          else toastSuccess(note, { chime: true })
        }
      }
      // Append-only history alongside the overwritten running totals above — answers "why is
      // trust 62 now" instead of only ever showing the current number. Only log when a dimension
      // or flag genuinely moved; gallery/coin bookkeeping alone isn't relationship movement.
      // `characterId` is always stamped now (unset on every event from before multi-character
      // tracking existed, which `RelationshipPanel` reads as "the primary" for backward compat).
      if (!noStatChange || newFlags.length > 0) {
        const changedDeltas = Object.fromEntries(Object.entries(deltas).filter(([, v]) => v !== 0))
        relationshipEventsApi
          .create({
            chatId: chatIdForRelationship,
            characterId: speaker.id,
            reason: reason ?? 'The relationship shifted during this exchange',
            deltas: changedDeltas,
            newFlags: newFlags.length ? newFlags : undefined,
            sourceMessageId: history[history.length - 1]?.id,
          })
          .catch(() => {})
      }
      // Quiet, player-facing rewards — these are milestones worth surfacing, unlike the raw
      // scene flags (internal bookkeeping) or per-turn stat deltas (would be constant noise).
      await announceMilestone({
        charName: speaker.card.name,
        personaName: persona?.name || 'You',
        chatId: chatIdForRelationship,
        previousStage,
        relationshipStage,
        sourceMessageId: history[history.length - 1]?.id,
        characterId: speaker.id,
        turnCount: countCharReplies(messages),
      })
      for (const id of unlockedSet) {
        if (previouslyUnlockedIds.has(id)) continue
        const entry = speaker.gallery?.find((g) => g.id === id)
        toastSuccess(entry?.isEnding ? `An ending unlocked: ${entry.title}` : `New gallery scene unlocked: ${entry?.title ?? 'untitled'}`, { chime: true })
      }
      return completedTaskIndices
    },
    [activeFacts, character, client, participantCharacters, persona?.name, relationshipDifficulty, world],
  )

  // buyGift/buyItem/buyToy/useItem's currency branch, plus the coin writes in
  // `updateAffectionFromReply` and `endDateEvent`, all follow the same GET-compute-PUT shape
  // against the one shared `Chat.giftCoins` wallet. None of that round-trip is atomic on its own,
  // so two of these firing close together (two Shop purchases clicked back-to-back is all it
  // takes) can race: the second's GET reads the balance from *before* the first's PUT committed,
  // and whichever PUT lands last silently overwrites the other's coin delta while both purchases'
  // inventory writes (a different field each) still land — a real item, but its cost evaporates.
  // `getCoinMutex(chatId).run(...)` below serializes every one of these against the others for this
  // chat, so each one's "fresh" read is guaranteed to see the previous one's write. See
  // `coinMutex.ts` for the full repro this was found with.
  const buyGift = useCallback(
    async (giftId: string) => {
      if (!chatId) return
      const item = giftById(giftId, world)
      if (!item) return
      await getCoinMutex(chatId).run(async () => {
        const freshChat = await chatsApi.get(chatId)
        if (!freshChat) return
        const coins = freshChat.giftCoins ?? 0
        if (coins < item.price) return
        const inventory = { ...(freshChat.giftInventory ?? defaultGiftInventory(world)) }
        inventory[giftId] = (inventory[giftId] ?? 0) + 1
        await chatsApi.update(chatId, {
          giftCoins: coins - item.price,
          giftInventory: inventory,
        })
      })
    },
    [chatId, world],
  )

  const buyItem = useCallback(
    async (itemId: string) => {
      if (!chatId) return
      const def = itemById(itemId, world)
      if (!def) return
      await getCoinMutex(chatId).run(async () => {
        const freshChat = await chatsApi.get(chatId)
        if (!freshChat) return
        const coins = freshChat.giftCoins ?? 0
        if (coins < def.price) return
        const inventory = { ...(freshChat.itemInventory ?? {}) }
        inventory[itemId] = (inventory[itemId] ?? 0) + 1
        await chatsApi.update(chatId, {
          giftCoins: coins - def.price,
          itemInventory: inventory,
        })
      })
    },
    [chatId, world],
  )

  /** Byte-for-byte mirrors `buyGift`/`buyItem` — a toy is a purchase like either, just tracked in its own `toyInventory` (`intimacyCatalog.ts`'s own doc comment explains why toys, unlike every other intimacy-catalog category, need an actual ownership step). */
  const buyToy = useCallback(
    async (toyId: string) => {
      if (!chatId) return
      const def = intimacyItemById(toyId, world)
      if (!def?.price) return
      const price = def.price
      await getCoinMutex(chatId).run(async () => {
        const freshChat = await chatsApi.get(chatId)
        if (!freshChat) return
        const coins = freshChat.giftCoins ?? 0
        if (coins < price) return
        const inventory = { ...(freshChat.toyInventory ?? {}) }
        inventory[toyId] = (inventory[toyId] ?? 0) + 1
        await chatsApi.update(chatId, {
          giftCoins: coins - price,
          toyInventory: inventory,
        })
      })
    },
    [chatId, world],
  )

  /**
   * Applies an owned item's authored effect immediately and deterministically (10d) — no judge
   * call, unlike a gift's in-scene reaction, since an item's effect is authored, not reacted to.
   */
  const useItem = useCallback(
    async (itemId: string) => {
      if (!chatId || !character) return
      const def = itemById(itemId, world)
      if (!def) return
      // Only the 'currency' branch touches `giftCoins`, but the whole read-modify-write still runs
      // inside the mutex (see the note above `buyGift`) — cheap to serialize, and it means a coin
      // item used back-to-back with a Shop purchase can't race either.
      await getCoinMutex(chatId).run(async () => {
        const freshChat = await chatsApi.get(chatId)
        if (!freshChat) return
        const inStock = freshChat.itemInventory?.[itemId] ?? 0
        if (inStock <= 0) return
        const inventory = { ...freshChat.itemInventory }
        inventory[itemId] = inStock - 1
        if (inventory[itemId] <= 0) delete inventory[itemId]

        const patch: Record<string, unknown> = { itemInventory: inventory }
        let toastMessage = `Used ${def.name}.`
        if (def.effect.kind === 'currency') {
          patch.giftCoins = Math.max(0, (freshChat.giftCoins ?? 0) + def.effect.amount)
          toastMessage = `Used ${def.name} — gained ${def.effect.amount} coins.`
        } else if (def.effect.kind === 'flag') {
          const flags = new Set((freshChat.sceneFlags ?? []) as SceneFlag[])
          flags.add(def.effect.flag)
          patch.sceneFlags = [...flags]
          toastMessage = `Used ${def.name}.`
        } else {
          const dim = def.effect.dimension
          if (dim === 'affection') {
            patch.affection = clampAffection((freshChat.affection ?? 0) + def.effect.amount)
          } else {
            const stats = getRelationshipStats(freshChat)
            patch.relationshipStats = { ...stats, [dim]: clampStat(stats[dim] + def.effect.amount) }
          }
          toastMessage = `Used ${def.name} — ${def.effect.amount > 0 ? '+' : ''}${def.effect.amount} ${dim}.`
        }
        await chatsApi.update(chatId, patch)
        toastSuccess(toastMessage)
      })
    },
    [character, chatId, world],
  )

  // `askForCommitment` (just below) needs to call `startDateEvent` for its married/living_together
  // auto-drafted milestone scene, but `startDateEvent` is declared much further down this same hook
  // body (it depends on `runGeneration`/`createObjective`, both defined later still) — a direct
  // reference would be a genuine TypeScript "used before its declaration" error, since the compiler
  // can't see that the closure referencing it is only ever *called* well after the whole hook body
  // has finished evaluating for this render. A plain variable reassigned each render wouldn't be
  // enough on its own: if `askForCommitment`'s *own* memoized closure survives from an earlier
  // render (its dependency array not having changed) while `startDateEvent`'s identity moved on
  // (e.g. `chat?.affection` changed), that stale closure would keep calling whatever
  // `startDateEvent` looked like back when it was created. A ref sidesteps both problems: declared
  // here (before `askForCommitment`, so no ordering error), its `.current` reassigned to the real
  // function on every render right after `startDateEvent`'s own declaration — and because a
  // `useRef` object's identity never changes across renders, even a stale `askForCommitment`
  // closure reading `.current` at call time always sees the *latest* render's `startDateEvent`.
  const startDateEventRef = useRef<(event: DateEventCard) => Promise<void>>(async () => {})

  /**
   * A single Define-the-Relationship ask (10c) — whichever tier the button offers is already
   * gated on warmth by the caller (`RelationshipPanel`'s `canAskForCommitment`), so this only ever
   * needs to judge how the character actually reacts to being asked right now. `characterId`
   * defaults to the primary — multi-character relationship tracking extends this to any tracked
   * participant, resolved through the same `getRelationshipTrack`/`patchRelationshipTrack` pair
   * `updateAffectionFromReply` uses.
   */
  const askForCommitment = useCallback(
    async (tier: Exclude<CommitmentStatus, 'none'>, characterId?: string) => {
      if (!chatId) return
      const { active: target } = resolveSpeaker(characterId)
      if (!target) return
      const freshChat = await chatsApi.get(chatId)
      if (!freshChat) return
      const track = getRelationshipTrack(freshChat, target.id)
      const currentStatus = track.commitmentStatus ?? 'none'
      const currentStats = getRelationshipStats(track)
      const currentAffection = track.affection ?? 0
      const historyForAssist: ChatMessage[] = messages.map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
      let outcome
      try {
        outcome = await assessCommitmentAsk(client, {
          history: historyForAssist,
          charName: target.card.name,
          charPersonality: target.card.personality,
          userName: persona?.name || 'You',
          tierLabel: formatCommitmentStatus(tier),
          currentStatusLabel: formatCommitmentStatus(currentStatus),
          current: { affection: currentAffection, ...currentStats },
        })
      } catch (e) {
        toastError(errorMessage(e))
        return
      }
      const deltas = scaleDeltasForDifficulty(outcome.deltas, relationshipDifficulty)
      const affection = clampAffection(currentAffection + deltas.affection)
      let nextStats = { ...currentStats }
      for (const dim of RELATIONSHIP_DIMENSIONS) nextStats[dim] = clampStat(currentStats[dim] + deltas[dim])
      const milestones = relationshipMilestonesFor(world?.relationshipThresholds)
      const previousStage = relationshipStageForWarmth(computeWarmth(currentAffection, currentStats), milestones)
      const statusAfterAsk = outcome.decision === 'accept' ? tier : currentStatus
      const risk = applyRelationshipRisk({
        charName: target.card.name,
        commitmentStatus: statusAfterAsk,
        stats: nextStats,
        existingWarning: track.relationshipWarning ?? undefined,
        breakupCount: track.breakupCount ?? 0,
      })
      nextStats = risk.stats
      const warmth = computeWarmth(affection, nextStats)
      const relationshipStage = relationshipStageForWarmth(warmth, milestones)
      // Item 2's "missed opportunity" cost: a real deflection/backfire opens (or re-opens) a
      // still-live, decaying cue that colors the next few turns; an accept always clears it, since
      // there's nothing left to be gun-shy about once the answer was yes.
      const nextRebuff: RecentRebuff | null =
        outcome.decision === 'accept'
          ? null
          : { startedAtTurn: countCharReplies(messages), kind: 'commitment', severity: outcome.decision === 'backfire' ? 'backfire' : 'deflect' }

      await chatsApi.update(chatId, patchRelationshipTrack(freshChat, target.id, {
        affection,
        relationshipStats: nextStats,
        relationshipStage,
        commitmentStatus: risk.commitmentStatus,
        relationshipWarning: risk.relationshipWarning ?? null,
        breakupCount: risk.breakupCount,
        recentRebuff: nextRebuff,
      }))

      const changedDeltas = Object.fromEntries(Object.entries(deltas).filter(([, v]) => v !== 0))
      relationshipEventsApi
        .create({
          chatId,
          characterId: target.id,
          reason: `Asked to be ${formatCommitmentStatus(tier)}: ${outcome.reason}`,
          deltas: changedDeltas,
          sourceMessageId: messages[messages.length - 1]?.id,
        })
        .catch(() => {})

      if (outcome.decision === 'accept') {
        // 10a's "Economy" bullet: a real commitment tier accepted is a discrete, rare, meaningful
        // moment worth a real reward (see `COMMITMENT_ACCEPTED_COIN_BONUS`'s own doc comment) —
        // granted inside the coin mutex like every other `giftCoins` touch (`coinMutex.ts`), and
        // folded into this same toast rather than firing a second one right on top of it.
        const coinsGranted = await getCoinMutex(chatId).run(async () => {
          const liveChat = await chatsApi.get(chatId)
          if (!liveChat) return 0
          await chatsApi.update(chatId, { giftCoins: Math.max(0, (liveChat.giftCoins ?? 0) + COMMITMENT_ACCEPTED_COIN_BONUS) })
          return COMMITMENT_ACCEPTED_COIN_BONUS
        })
        toastSuccess(
          `${target.card.name} said yes — you're ${formatCommitmentStatus(tier)} now. ${outcome.reason}${coinsGranted ? ` (+${coinsGranted} coins)` : ''}`,
          { chime: true },
        )
        chatFactsApi
          .create({
            chatId,
            text: `${persona?.name || 'You'} and ${target.card.name} are officially ${formatCommitmentStatus(tier)}.`,
          })
          .catch(() => {})
        // A married/living_together accept is big enough to deserve an actual scene, not just a
        // status label flipping with nothing generated — a wedding day, or a moving-in day. Reuses
        // the exact same date-event machinery a normal "Suggest event with AI" click already goes
        // through (`suggestDateEvent` → `startDateEvent`), so this surfaces through the identical
        // path `DateEventPanel` already reads (`Chat.activeEvent`) rather than inventing a parallel
        // one. Primary-only: `startDateEvent`/its auto-opening `runGeneration` call are written
        // against this hook's own `character`/`world`, not an arbitrary tracked participant, so a
        // non-primary's accepted proposal still lands the status change above but doesn't try to
        // stage a scene in the wrong character's body/world.
        //
        // Deliberately NOT awaited: drafting a card and then starting its live opening scene is two
        // real model round-trips, and this ask's own promise (what `RelationshipPanel`'s "Asking…"
        // button waits on) should resolve as soon as the ask itself is settled, not block on a
        // best-effort scene that can fail or run long without that reading as the ask having failed.
        if ((tier === 'married' || tier === 'living_together') && target.id === character?.id) {
          suggestDateEvent(client, {
            characterName: target.card.name,
            characterDescription: target.card.description,
            personaName: persona?.name || 'You',
            worldDescription: world?.description,
            availableBackgrounds: getUnlockedBackgroundIds(world, affection),
            affection,
            commitmentStatus: tier,
            milestoneOccasion: tier,
            recentGiftName: recentMeaningfulGiftName(track.giftLog, target.giftPreferences, world),
          })
            .then((milestoneEvent) => (milestoneEvent ? startDateEventRef.current(milestoneEvent) : undefined))
            .catch((e) =>
              toastError(`Accepted, but couldn't put together the ${tier === 'married' ? 'wedding' : 'moving-in'} scene: ${errorMessage(e)}`),
            )
        }
      } else if (outcome.decision === 'backfire') {
        toastError(`That didn't land well. ${outcome.reason}`)
      } else {
        toastInfo(`Not the right moment. ${outcome.reason}`)
      }
      await announceMilestone({
        charName: target.card.name,
        personaName: persona?.name || 'You',
        chatId,
        previousStage,
        relationshipStage,
        characterId: target.id,
        turnCount: countCharReplies(messages),
      })
    },
    [character, chatId, client, messages, persona?.name, relationshipDifficulty, resolveSpeaker, world],
  )

  /**
   * A deliberate "first time together" ask — the user's own direct follow-up to the intimacy
   * catalog ("we should be able to choose... lose virginity"). Byte-for-byte mirrors
   * `askForCommitment`'s shape (eligibility already gated by the caller's `canInitiateFirstTime`,
   * same judge-call/deltas/risk/toast structure) with two differences: there's no tier to actually
   * transition into, just `firstIntimateSceneAt` set once on accept; and deliberately no
   * auto-sent narrative line afterward — this beat is big enough that the player's own next
   * message should carry it, same restraint the commitment-ask flow already shows.
   */
  const initiateFirstTime = useCallback(
    async (characterId?: string) => {
      if (!chatId) return
      const { active: target } = resolveSpeaker(characterId)
      if (!target) return
      const freshChat = await chatsApi.get(chatId)
      if (!freshChat) return
      const track = getRelationshipTrack(freshChat, target.id)
      const currentStats = getRelationshipStats(track)
      const currentAffection = track.affection ?? 0
      const historyForAssist: ChatMessage[] = messages.map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
      let outcome
      try {
        outcome = await assessIntimacyMilestone(client, {
          history: historyForAssist,
          charName: target.card.name,
          charPersonality: target.card.personality,
          userName: persona?.name || 'You',
          current: { affection: currentAffection, ...currentStats },
        })
      } catch (e) {
        toastError(errorMessage(e))
        return
      }
      const deltas = scaleDeltasForDifficulty(outcome.deltas, relationshipDifficulty)
      const affection = clampAffection(currentAffection + deltas.affection)
      let nextStats = { ...currentStats }
      for (const dim of RELATIONSHIP_DIMENSIONS) nextStats[dim] = clampStat(currentStats[dim] + deltas[dim])
      const milestones = relationshipMilestonesFor(world?.relationshipThresholds)
      const previousStage = relationshipStageForWarmth(computeWarmth(currentAffection, currentStats), milestones)
      const risk = applyRelationshipRisk({
        charName: target.card.name,
        commitmentStatus: track.commitmentStatus ?? 'none',
        stats: nextStats,
        existingWarning: track.relationshipWarning ?? undefined,
        breakupCount: track.breakupCount ?? 0,
      })
      nextStats = risk.stats
      const warmth = computeWarmth(affection, nextStats)
      const relationshipStage = relationshipStageForWarmth(warmth, milestones)
      // Item 2's "missed opportunity" cost — same rule as `askForCommitment`: a real deflection/
      // backfire opens a still-live, decaying cue; an accept clears it.
      const nextRebuff: RecentRebuff | null =
        outcome.decision === 'accept'
          ? null
          : { startedAtTurn: countCharReplies(messages), kind: 'intimacy_milestone', severity: outcome.decision === 'backfire' ? 'backfire' : 'deflect' }

      await chatsApi.update(chatId, patchRelationshipTrack(freshChat, target.id, {
        affection,
        relationshipStats: nextStats,
        relationshipStage,
        commitmentStatus: risk.commitmentStatus,
        relationshipWarning: risk.relationshipWarning ?? null,
        breakupCount: risk.breakupCount,
        firstIntimateSceneAt: outcome.decision === 'accept' ? (track.firstIntimateSceneAt ?? Date.now()) : track.firstIntimateSceneAt,
        // Only an accepted first time opens an aftercare window — a deflected or backfired ask has
        // no aftermath to judge, and scoring one would punish the player twice for the same no.
        afterglow:
          outcome.decision === 'accept'
            ? { startedAtTurn: countCharReplies(messages), sourceLabel: 'their first time together', momentumAtStart: track.momentum ?? 0 }
            : (track.afterglow ?? null),
        recentRebuff: nextRebuff,
      }))

      const changedDeltas = Object.fromEntries(Object.entries(deltas).filter(([, v]) => v !== 0))
      relationshipEventsApi
        .create({
          chatId,
          characterId: target.id,
          reason: `Initiated their first time together: ${outcome.reason}`,
          deltas: changedDeltas,
          sourceMessageId: messages[messages.length - 1]?.id,
        })
        .catch(() => {})

      if (outcome.decision === 'accept') {
        toastSuccess(`${target.card.name} wants this too. ${outcome.reason}`, { chime: true })
        if (!track.firstIntimateSceneAt) {
          chatFactsApi
            .create({
              chatId,
              text: `${persona?.name || 'You'} and ${target.card.name} were intimate together for the first time.`,
            })
            .catch(() => {})
        }
      } else if (outcome.decision === 'backfire') {
        toastError(`That didn't land well. ${outcome.reason}`)
      } else {
        toastInfo(`Not the right moment. ${outcome.reason}`)
      }
      await announceMilestone({
        charName: target.card.name,
        personaName: persona?.name || 'You',
        chatId,
        previousStage,
        relationshipStage,
        characterId: target.id,
        turnCount: countCharReplies(messages),
      })
    },
    [chatId, client, messages, persona?.name, relationshipDifficulty, resolveSpeaker, world],
  )

  /**
   * The player deliberately ending a committed relationship (10c) — behind a confirmation in the
   * UI so a joke line can't blow one up by accident. Applies the same one-time scar a strain-driven
   * breakup does, via the shared `applyRelationshipRisk` plumbing, so a deliberate and an
   * unresolved-strain breakup leave the same kind of mark rather than two different mechanisms.
   * `characterId` defaults to the primary, same precedence as `askForCommitment`.
   */
  const endRelationship = useCallback(
    async (characterId?: string) => {
      if (!chatId) return
      const { active: target } = resolveSpeaker(characterId)
      if (!target) return
      const freshChat = await chatsApi.get(chatId)
      if (!freshChat) return
      const track = getRelationshipTrack(freshChat, target.id)
      if ((track.commitmentStatus ?? 'none') === 'none') return
      const scarredStats = applyBreakupScar(getRelationshipStats(track))
      // The scar can drop warmth enough to cross back over a milestone boundary (e.g. sweethearts
      // → close) — every other write path in this file (`updateAffectionFromReply`,
      // `askForCommitment`, `endDateEvent`'s close-out) recomputes and saves `relationshipStage`
      // alongside a stats change for exactly this reason; this one didn't, leaving the stored stage
      // stale at whatever it was before the breakup. Affection itself is untouched by a breakup —
      // only trust/chemistry/comfort take the scar — so it's `track.affection` unchanged, not a
      // separately computed value.
      const warmth = computeWarmth(track.affection ?? 0, scarredStats)
      const relationshipStage = relationshipStageForWarmth(warmth, relationshipMilestonesFor(world?.relationshipThresholds))
      await chatsApi.update(chatId, patchRelationshipTrack(freshChat, target.id, {
        commitmentStatus: 'none',
        relationshipStats: scarredStats,
        relationshipStage,
        relationshipWarning: null,
        breakupCount: (track.breakupCount ?? 0) + 1,
      }))
      chatFactsApi
        .create({ chatId, text: `${persona?.name || 'You'} and ${target.card.name} broke things off.` })
        .catch(() => {})
      toastInfo(`You and ${target.card.name} are no longer together.`)
    },
    [chatId, persona?.name, resolveSpeaker, world],
  )

  const previewPrompt = useCallback(async () => {
    const historyForPrompt: ChatMessage[] = messages.map((m) => ({
      id: m.id,
      role: m.role,
      name: m.name,
      text: m.text,
    }))
    return buildCurrentPrompt(historyForPrompt, { speakerId: replyAsCharacterId })
  }, [buildCurrentPrompt, messages, replyAsCharacterId])

  /**
   * Save (or clear) this chat's Author's Note. A blank note is stored as `null`, not an empty
   * object — `JSON.stringify` drops `undefined` keys before the request is sent, so clearing has
   * to send an explicit `null` for the server's merge to actually overwrite the old value (same
   * guard as `activeEvent`; see ROADMAP §9 / changelog #28).
   */
  const updateAuthorNote = useCallback(
    async (note: AuthorNote | null) => {
      if (!chatId) return
      await chatsApi.update(chatId, { authorNote: note && note.text.trim() ? note : null })
    },
    [chatId],
  )

  /**
   * Section 4/12's Scene entity: location/atmosphere framing plus the group-chat turn policy.
   * `null` clears it entirely (back to manual, no framing — today's exact behavior); a partial
   * patch merges onto whatever's already set, defaulting to `'manual'` the first time a chat gets
   * a scene at all. `scene: null`, not `undefined` — the usual `JSON.stringify` drops-`undefined`
   * reason (see `activeEvent`/`authorNote`).
   */
  const updateScene = useCallback(
    async (patch: Partial<Scene> | null) => {
      if (!chatId) return
      if (patch === null) {
        await chatsApi.update(chatId, { scene: null })
        return
      }
      const current: Scene = chat?.scene ?? { turnPolicy: 'manual' }
      await chatsApi.update(chatId, { scene: { ...current, ...patch } })
    },
    [chat?.scene, chatId],
  )

  /** Best-effort: proposes a few next-move options for the user, attached to the char message they follow from. Never blocks the reply. */
  const suggestChoicesForMessage = useCallback(
    async (messageId: string, historyForChoices: ChatMessage[]) => {
      if (!character || !chatId) return
      try {
        const freshChat = await chatsApi.get(chatId)
        const inventory = freshChat?.giftInventory ?? {}
        const availableGifts = getGiftCatalog(world).map((item) => ({
          id: item.id,
          name: item.name,
          quantity: inventory[item.id] ?? 0,
        })).filter((g) => g.quantity > 0)
        const choiceCards = await generateChoices(client, {
          history: historyForChoices,
          charName: character.card.name,
          userName: persona?.name || 'You',
          availableGifts,
        })
        await messagesApi.update(messageId, {
          choiceCards,
          choices: choiceCards.map((c) => c.text),
        })
      } catch {
        // a failed suggestion just means no choice buttons render — never surfaced as a chat error
      }
    },
    [character, chatId, client, persona, world],
  )

  const regenerateChoices = useCallback(
    async (messageId: string) => {
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return
      const historyUpTo: ChatMessage[] = messages
        .slice(0, idx + 1)
        .map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
      await suggestChoicesForMessage(messageId, historyUpTo)
    },
    [messages, suggestChoicesForMessage],
  )

  /**
   * §8 vision scene detection — a backup for the model's blind `<<scene:>>` self-tag, run only
   * when Settings → Appearance → "Vision scene detection" is on. Looks at the character's actual
   * unlocked expression sprites to correct the tagged expression, and at any photo the player
   * attached this turn to derive a background/mood. Writes the refined `scene` back onto the
   * just-generated message (active swipe); a no-op when nothing changed or the model declined.
   * Fire-and-forget like every other post-reply assist — a slow or failed vision pass never
   * touches the reply that already landed.
   */
  const refineSceneWithVision = useCallback(
    async (messageId: string, speaker: Character, replyText: string, userImages: string[]) => {
      if (!replyText.trim()) return
      const spriteMap = speaker.sprites ?? {}
      const affection = chat?.affection ?? 0
      const unlockedExpressions = getUnlockedExpressionIds(speaker, affection)
      const unlockedBackgrounds = getUnlockedBackgroundIds(world, affection)
      // Needed here purely so re-sanitizing the *existing* tag below can't strip an outfit the
      // reply already established — without it, a vision refine would quietly undress the
      // character, since `sanitizeSceneTag` drops an outfit it wasn't told is selectable.
      const selectableOutfits = selectableOutfitIds(speaker.outfits, spriteMap, affection, new Set(chat?.sceneFlags ?? []))
      const currentOutfit = currentOutfitFrom(messages)

      const spriteExpressionIds = Object.keys(spriteMap).filter((id) => unlockedExpressions.includes(id))
      const canDetectExpression = spriteExpressionIds.length >= 2
      if (!canDetectExpression && userImages.length === 0) return

      const freshMsg = await messagesApi.get(messageId)
      if (!freshMsg) return
      const activeSwipe = freshMsg.activeSwipe ?? 0
      const currentScene: SceneTag = freshMsg.swipeScenes?.[activeSwipe] ?? freshMsg.scene ?? {}
      const next: SceneTag = { ...currentScene }

      if (canDetectExpression) {
        const labelById = new Map<string, string>([
          ...DEFAULT_EXPRESSIONS.map((e) => [e.id, e.label] as const),
          ...(speaker.customExpressions ?? []).map((c) => [c.id, c.label] as const),
        ])
        const candidates = spriteExpressionIds.map((id) => ({ id, label: labelById.get(id) ?? id }))

        // A fully-spritted character has 20+ expressions — far too many images to send the vision
        // model at once. A cheap text pass narrows it to the few that could plausibly fit the line,
        // then only those sprites are fetched and shown.
        const shortlist = await shortlistExpressions(client, {
          charName: speaker.card.name,
          replyText,
          candidates,
          taggedExpression: currentScene.expression,
          limit: 6,
        })

        const cache = spriteBase64Ref.current
        const sprites = (
          await Promise.all(
            shortlist.map(async (id) => {
              // Show the vision model the outfit that's actually on screen, falling back to base
              // art for an expression this outfit doesn't have — it's judging which expression the
              // line reads as, and comparing against art the player isn't looking at just makes
              // that call harder.
              const url = spriteMap[spriteKey(currentOutfit, id)] ?? spriteMap[id]
              if (!url) return null
              if (!cache.has(url)) {
                const b64 = await downscaleImageToBase64(url)
                if (b64) cache.set(url, b64)
              }
              const base64 = cache.get(url)
              return base64 ? { id, label: labelById.get(id) ?? id, base64 } : null
            }),
          )
        ).filter((s): s is { id: string; label: string; base64: string } => !!s)

        const detected = await detectExpressionFromSprites(client, {
          charName: speaker.card.name,
          replyText,
          sprites,
          taggedExpression: currentScene.expression,
        })
        if (detected) next.expression = detected
      }

      if (userImages.length > 0) {
        const cls = await classifyAttachedImageScene(client, {
          images: userImages,
          backgroundIds: unlockedBackgrounds,
          moodIds: [...SCENE_MOOD_IDS],
        })
        if (cls.background) next.background = cls.background
        if (cls.mood) next.mood = cls.mood
      }

      const sanitized = sanitizeSceneTag(next, unlockedExpressions, unlockedBackgrounds, selectableOutfits)
      if (
        JSON.stringify(sanitized ?? null) ===
        JSON.stringify(sanitizeSceneTag(currentScene, unlockedExpressions, unlockedBackgrounds, selectableOutfits) ?? null)
      ) {
        return
      }
      const swipeScenes = freshMsg.swipeScenes ? [...freshMsg.swipeScenes] : []
      swipeScenes[activeSwipe] = sanitized
      await messagesApi.update(messageId, { scene: sanitized, swipeScenes })
    },
    [chat?.affection, client, world],
  )

  /**
   * Text-only sibling to `refineSceneWithVision`: corrects the expression tag using nothing but the
   * text that was just written (`detectExpressionTextMismatch`, `vn/sceneVision.ts`) — the fallback
   * for the much more common case where no vision-capable model is loaded, so a stale tag left over
   * from a few turns ago ("blush") can still be caught even when the model's own reply clearly reads
   * as something else ("scowled, slammed the door"). Never touches background/outfit/mood, only
   * expression, and only writes back on an actual change (same idempotent "diff before writing"
   * guard `refineSceneWithVision` uses).
   */
  const refineExpressionFromText = useCallback(
    async (messageId: string, speaker: Character, replyText: string) => {
      if (!replyText.trim()) return
      const affection = chat?.affection ?? 0
      const unlockedExpressions = getUnlockedExpressionIds(speaker, affection)
      const unlockedBackgrounds = getUnlockedBackgroundIds(world, affection)
      const selectableOutfits = selectableOutfitIds(speaker.outfits, speaker.sprites, affection, new Set(chat?.sceneFlags ?? []))

      const freshMsg = await messagesApi.get(messageId)
      if (!freshMsg) return
      const activeSwipe = freshMsg.activeSwipe ?? 0
      const currentScene: SceneTag = freshMsg.swipeScenes?.[activeSwipe] ?? freshMsg.scene ?? {}
      if (!currentScene.expression) return

      const candidates = expressionCandidatesFor(unlockedExpressions, speaker.customExpressions)
      const corrected = await detectExpressionTextMismatch(client, {
        charName: speaker.card.name,
        replyText,
        taggedExpression: currentScene.expression,
        candidates,
      })
      if (!corrected) return

      const next: SceneTag = { ...currentScene, expression: corrected }
      const sanitized = sanitizeSceneTag(next, unlockedExpressions, unlockedBackgrounds, selectableOutfits)
      if (
        JSON.stringify(sanitized ?? null) ===
        JSON.stringify(sanitizeSceneTag(currentScene, unlockedExpressions, unlockedBackgrounds, selectableOutfits) ?? null)
      ) {
        return
      }
      const swipeScenes = freshMsg.swipeScenes ? [...freshMsg.swipeScenes] : []
      swipeScenes[activeSwipe] = sanitized
      await messagesApi.update(messageId, { scene: sanitized, swipeScenes })
    },
    [chat?.affection, chat?.sceneFlags, client, world],
  )

  const runGeneration = useCallback(
    async (
      historyForPrompt: ChatMessage[],
      targetMessageId: string,
      images: string[] = [],
      opts?: { continuing?: boolean; speakerId?: string | null; intent?: MessageIntent; extraStyleGuidance?: string },
    ) => {
      // Every caller claims `generatingRef` before reaching here and releases it in a `finally`
      // around its own awaited body — this function only mirrors that into React state for the
      // UI, and deliberately doesn't claim it itself: several callers write placeholder messages
      // before calling in, and those writes need to be inside the lock, not in front of it.
      if (!character || !chat) return
      const { active: speaker } = resolveSpeaker(opts?.speakerId)
      if (!speaker) return
      // Relationship tracking, objective-progress-driven choices, and gift-aware choice
      // suggestions are all scoped to the primary's relationship — skip them for a turn a
      // non-primary participant spoke, rather than silently attributing their lines to it.
      const isPrimarySpeaker = speaker.id === character.id
      // This speaker's reply-length band, turned into a hard `max_length` ceiling for every round
      // below — so a terse character stays terse even if the model ignores the prose instruction
      // (`replyLengthInstruction` in `buildCurrentPrompt`). Only ever tightens the user's own
      // Settings cap, never raises it. `bandCapsBelowUserMax` gates auto-continue: a reply that
      // stopped because it hit the user's real budget should extend, one that hit this band on
      // purpose should not.
      const replyBand = resolveReplyLength(speaker.replyLength, speaker.card).band
      const effectiveMaxLength = replyMaxTokens(replyBand, sampler.max_length)
      const bandCapsBelowUserMax = effectiveMaxLength < sampler.max_length
      // `continuing` starts as whatever the caller asked for (a fresh reply, or a manual
      // "Continue" click) but becomes true partway through the loop below once an auto-continue
      // round kicks in — from that point on every remaining round behaves exactly like a manual
      // continue (same prompt shape, same "replace the last swipe" write), it just wasn't the
      // user who asked for it.
      let continuing = !!opts?.continuing
      const wasOriginallyContinuing = continuing
      let currentHistory = historyForPrompt
      let accumulated = continuing ? (historyForPrompt[historyForPrompt.length - 1]?.text ?? '') : ''
      setIsGenerating(true)
      setStreamingText(accumulated)
      setGeneratingMessageId(targetMessageId)
      setGenStats(null)
      const genkey = makeGenKey()
      genKeyRef.current = genkey
      const abort = new AbortController()
      abortRef.current = abort

      let combined = ''
      let scene: ReturnType<typeof sanitizeSceneTag>
      let wroteAnything = false
      // Set when the loop breaks on a reply that still ends mid-sentence and has no continuation
      // coming (a reply-length band cap stopped it short, or it stayed ragged through the last
      // auto-continue round) — trimmed back to its last complete sentence after the loop.
      let needsSentenceTrim = false

      try {
        // A reply that used its entire token budget without reaching a natural stop almost
        // always means it was cut off mid-thought, not that the model happened to finish exactly
        // on the last token — auto-continue transparently rather than leaving a visibly unfinished
        // message for the user to notice and manually click "Continue" on. Capped so a model that
        // never emits a stop sequence at all can't turn one reply into an unbounded loop.
        for (let round = 0; round <= MAX_AUTO_CONTINUE_ROUNDS; round++) {
          let built = await buildCurrentPrompt(currentHistory, {
            continueLastTurn: continuing,
            speakerId: opts?.speakerId,
            intent: opts?.intent,
            extraStyleGuidance: opts?.extraStyleGuidance,
          })
          if (!built) throw new Error('Could not build prompt: missing character or chat.')

          // The budget was already tight for THIS turn, not just future ones — fold the
          // overflow into the summary now and rebuild, instead of waiting until after the
          // reply lands. Keeps the roleplay going instead of silently truncating history
          // right when it matters most.
          if (autoSummarize && built.excludedMessageCount > 0) {
            await updateMemorySummary({ force: true })
            const rebuilt = await buildCurrentPrompt(currentHistory, {
              continueLastTurn: continuing,
              speakerId: opts?.speakerId,
              extraStyleGuidance: opts?.extraStyleGuidance,
            })
            if (rebuilt) built = rebuilt
          }

          // The template's own turn-boundary tokens (e.g. ChatML's <|im_end|>) must reach
          // the sampler or the model has no signal to stop at its own turn — merged with
          // whatever the user additionally set in Settings, not replacing it. Also merged with a
          // couple of dynamic, always-safe stops: many imported character cards' `mes_example`
          // uses SillyTavern's own `<START>` / `{{user}}:` / `{{char}}:` example-dialogue
          // delimiters (verbatim in the prompt via `exampleBlock`), and a model that's uncertain
          // about turn boundaries can fall back to imitating that pattern instead of stopping
          // after its own single turn — seen live, producing a reply that trails off into a
          // fabricated `<START>`/persona-name-prefixed "next" turn. No legitimate single-turn
          // reply needs to emit a literal `<START>` or restate the persona's or its own
          // name-prefix mid-message, so stopping there is safe for every template, not just ones
          // that already define their own stop sequences.
          const personaName = persona?.name || 'You'
          const dynamicStops = ['<START>', `\n${personaName}:`, `\n${speaker.card.name}:`]
          const stopSequence = [...new Set([...template.stopSequences, ...(sampler.stop_sequence ?? []), ...dynamicStops])]

          // The KoboldCpp sampler shape (top_k/min_p/rep_pen/DRY/mirostat/...) has no meaning for a
          // chat-completion backend — swap in the chat-completion-native params instead
          // (temperature/top_p/penalties/reasoning_effort/verbosity, from their own separately
          // tuned settings object). `max_context_length` stays from `sampler` either way: it's what
          // sized `buildCurrentPrompt`'s context budget above, even though only KoboldCpp's own
          // request actually reads the field itself.
          const generationParams =
            chatBackend === 'openai-compatible'
              ? { max_context_length: sampler.max_context_length, ...chatCompletionSamplerToRequest(chatCompletionSampler) }
              : sampler

          const genStartedAt = performance.now()
          let firstTokenAt: number | null = null
          let streamedTokenCount = 0
          const builtForStats = built
          let newText = ''
          try {
            newText = await client.generateStream(
              {
                ...generationParams,
                max_length: effectiveMaxLength,
                stop_sequence: stopSequence,
                prompt: built.prompt,
                // Section 8's "additional model backends": KoboldClient ignores this entirely
                // (it only ever reads `prompt`); OpenAICompatibleClient uses it instead of
                // wrapping `prompt` as a single user turn, giving a hosted chat-completion
                // backend a proper system/user split for the one call site worth the effort —
                // the main generation loop, not every background judge/assist call.
                messages: [
                  { role: 'system', content: built.systemText },
                  { role: 'user', content: built.conversationText },
                ],
                genkey,
                images: images.length ? images : undefined,
              },
              (_token, full) => {
                const now = performance.now()
                if (firstTokenAt === null) firstTokenAt = now
                streamedTokenCount++
                setStreamingText(accumulated + stripSceneTagForDisplay(full))
                const elapsedSec = (now - firstTokenAt) / 1000
                setGenStats({
                  tokensPerSec: elapsedSec > 0 ? streamedTokenCount / elapsedSec : 0,
                  firstTokenMs: firstTokenAt - genStartedAt,
                  contextUsed: builtForStats.tokensUsed,
                  contextBudget: builtForStats.contextBudget,
                  measured: false,
                })
              },
              abort.signal,
            )
          } catch (streamErr) {
            // Fall back to non-streaming generate (some builds/proxies block SSE).
            console.warn('Streaming generation failed, falling back to non-streaming:', streamErr)
            newText = await client.generate(
              {
                ...generationParams,
                max_length: effectiveMaxLength,
                stop_sequence: stopSequence,
                prompt: built.prompt,
                messages: [
                  { role: 'system', content: built.systemText },
                  { role: 'user', content: built.conversationText },
                ],
                genkey,
                images: images.length ? images : undefined,
              },
              abort.signal,
            )
          }

          // Finalize this round's stats client-side rather than reconciling against KoboldCpp's
          // own `/api/extra/perf` — tried that first, and live-caught a real attribution bug: with
          // post-reply assists (relationship scoring, choice suggestions) sharing the same server,
          // `/api/extra/perf` reports the single most recent generation of ANY kind, so by the time
          // this round's `getPerf()` call resolves it can just as easily describe an unrelated
          // background assist call as this reply — one live run showed a nonsensical 300s
          // "time to first token" this way. Every token in `streamedTokenCount` is scoped to
          // exactly this round's own SSE stream, so it can't be misattributed the same way.
          if (streamedTokenCount > 0 && firstTokenAt !== null) {
            const finalElapsedSec = (performance.now() - firstTokenAt) / 1000
            setGenStats({
              tokensPerSec: finalElapsedSec > 0 ? streamedTokenCount / finalElapsedSec : 0,
              firstTokenMs: firstTokenAt - genStartedAt,
              contextUsed: builtForStats.tokensUsed,
              contextBudget: builtForStats.contextBudget,
              measured: true,
            })
          }

          const combinedRaw = (accumulated + newText).trimEnd()
          const unlockedExpressions = getUnlockedExpressionIds(character, chat.affection ?? 0)
          const unlockedBackgrounds = getUnlockedBackgroundIds(world, chat.affection ?? 0)
          const selectableOutfits = selectableOutfitIds(
            character.outfits,
            character.sprites,
            chat.affection ?? 0,
            new Set(chat.sceneFlags ?? []),
          )
          const { text: extractedText, scene: parsedScene } = extractSceneTag(combinedRaw)
          // Deterministic scrub before this reply is stored: it fixes both what's displayed and
          // what's fed back into every later prompt (a tell left in history is one the model
          // imitates next turn). Idempotent, so the auto-continue rounds below re-running it over
          // already-cleaned text is harmless. `combinedRaw` keeps the untouched original for the
          // Prompt Inspector's raw/processed toggle.
          combined = cleanModelOutput(extractedText, { charName: speaker.card.name, personaName: persona?.name || 'You' })
          scene = sanitizeSceneTag(parsedScene, unlockedExpressions, unlockedBackgrounds, selectableOutfits)
          // A reply that's nothing but a recognized `<<scene:>>` tag (or otherwise scrubs down to
          // nothing), or that's just the immediately-preceding message parroted back (bare, or with
          // a stray speaker label glued on — see `isVerbatimEcho`), is a real generation failure,
          // not a success with an empty or repeated message — without this, it saved as
          // `failed: false` and rendered as a blank or duplicate-looking bubble with no "Generation
          // failed" affordance, while still feeding the bad text to the choice/relationship assists
          // below as the latest reply. `historyForPrompt`'s last entry (not `currentHistory`, which
          // an auto-continue round has already overwritten with this same reply's own earlier text)
          // is always whatever genuinely came before this generation attempt started, whoever said
          // it. `combined` only ever grows round to round (each round re-derives it from the full
          // accumulated text, never just its own delta), so once a round produces real, non-echoed
          // text this can't flip back on a later round.
          const isUsableReply = combined.trim().length > 0 && !isVerbatimEcho(combined, historyForPrompt[historyForPrompt.length - 1]?.text)

          if (continuing) {
            const freshMsg = await messagesApi.get(targetMessageId)
            const swipes = freshMsg?.swipes?.length ? [...freshMsg.swipes] : [accumulated]
            const activeSwipe = freshMsg?.activeSwipe ?? 0
            swipes[activeSwipe] = combined
            const swipeScenes = freshMsg?.swipeScenes ? [...freshMsg.swipeScenes] : []
            swipeScenes[activeSwipe] = scene
            const swipeRawTexts = freshMsg?.swipeRawTexts ? [...freshMsg.swipeRawTexts] : []
            swipeRawTexts[activeSwipe] = combinedRaw
            await messagesApi.update(targetMessageId, {
              text: combined,
              swipes,
              swipeScenes,
              swipeRawTexts,
              rawText: combinedRaw,
              activeSwipe,
              scene,
              tokenCount: await countTokens(combined),
              failed: !isUsableReply,
            })
          } else {
            const freshMsg = await messagesApi.get(targetMessageId)
            const existingSwipes = freshMsg?.swipes?.length ? [...freshMsg.swipes] : [combined]
            const activeSwipe = Math.min(freshMsg?.activeSwipe ?? 0, Math.max(0, existingSwipes.length - 1))
            existingSwipes[activeSwipe] = combined
            const swipeScenes = freshMsg?.swipeScenes ? [...freshMsg.swipeScenes] : []
            swipeScenes[activeSwipe] = scene
            const swipeRawTexts = freshMsg?.swipeRawTexts ? [...freshMsg.swipeRawTexts] : []
            swipeRawTexts[activeSwipe] = combinedRaw
            await messagesApi.update(targetMessageId, {
              text: combined,
              swipes: existingSwipes,
              swipeScenes,
              swipeRawTexts,
              rawText: combinedRaw,
              activeSwipe,
              scene,
              tokenCount: await countTokens(combined),
              failed: !isUsableReply,
            })
          }
          // Only a round that actually produced a real, non-echoed reply counts — an empty or
          // echoed round shouldn't mask a genuine failure if this is also the round the loop ends
          // on (see `isUsableReply` above).
          wroteAnything = wroteAnything || isUsableReply
          // Also rolls the sticky/cooldown bookkeeping forward for next turn (built once per round;
          // the final round's state is the one that sticks). Bumps updatedAt regardless.
          await chatsApi.update(chat.id, { worldInfoState: built.worldInfoState ?? {} })

          // Stopping the generation by hand (or the model genuinely finishing early) both mean
          // "don't keep going" regardless of how close to the token cap it landed.
          const generatedTokens = !abort.signal.aborted && newText.trim() ? await countTokens(newText) : 0
          const hitCap = !abort.signal.aborted && generatedTokens >= effectiveMaxLength - 1
          // A round that stopped well under the cap but leaves the reply mid-sentence was cut by a
          // stop sequence firing early (an over-eager end-of-turn token, a card's example-dialogue
          // delimiter, a stray persona-name line) — the same visibly-unfinished outcome as hitting
          // max_length, just a different cause. A reply that stops early *on a complete sentence* is
          // a legitimate short turn and is left alone.
          // Only worth *one* recovery round: a stop sequence that fires a second time (a card's
          // `<START>` in its examples, say) won't be fixed by generating into it again, and a model
          // that just punctuates poorly shouldn't cost three generations every reply.
          const endedMidThought =
            round === 0 && !abort.signal.aborted && !!newText.trim() && !hitCap && !endsCleanly(combined)
          // Extend a reply that ran into the user's real token budget, or one a stray stop cut off
          // mid-sentence — never one this character's reply-length band deliberately kept short.
          const looksTruncated = !bandCapsBelowUserMax && (hitCap || endedMidThought)
          if (!looksTruncated || round === MAX_AUTO_CONTINUE_ROUNDS) {
            // Band-capped, or still ragged after the last allowed round: tidy the tail below.
            needsSentenceTrim = !abort.signal.aborted && !endsCleanly(combined)
            break
          }

          continuing = true
          accumulated = combined
          currentHistory =
            round === 0
              ? [...historyForPrompt, { id: targetMessageId, role: 'char' as const, name: speaker.card.name, text: combined }]
              : [...currentHistory.slice(0, -1), { ...currentHistory[currentHistory.length - 1], text: combined }]
        }

        // A reply that broke out of the loop still ending mid-sentence (band cap, or ragged past
        // the last auto-continue round) gets trimmed back to its last complete sentence
        // (trimToLastSentence bails itself if that would lose too much of a single long run-on),
        // then any action beat / line of dialogue a stop sequence cut off mid-mark is closed off.
        // Only the display text and active swipe change; the untouched `rawText` stays as-is.
        if (needsSentenceTrim && !abort.signal.aborted) {
          const tidied = balanceTrailingMarkup(trimToLastSentence(combined))
          if (tidied && tidied !== combined) {
            combined = tidied
            const freshMsg = await messagesApi.get(targetMessageId)
            const swipes = freshMsg?.swipes?.length ? [...freshMsg.swipes] : [combined]
            const activeSwipe = Math.min(freshMsg?.activeSwipe ?? 0, Math.max(0, swipes.length - 1))
            swipes[activeSwipe] = combined
            await messagesApi.update(targetMessageId, { text: combined, swipes, tokenCount: await countTokens(combined) })
          }
        }

        // Item 4's deterministic "hard rail": a cheap, synchronous, non-AI lexical check against
        // this character's own authored `boundaries` PLUS — item 7 — anything the player's own
        // persona description states as a limit (`dating/boundaryGuard.ts`'s `detectAnyBoundaryCrossing`),
        // the one piece of real enforcement on top of either field's existing prompt-only treatment
        // everywhere else. Informational only (a toast), never an auto-reroll or a silent rewrite —
        // a false positive discarding a good reply with no way to verify that live would be worse
        // than an occasional missed catch. See that file's own doc comment for why this stays conservative.
        if (!abort.signal.aborted && combined.trim()) {
          const crossed = detectAnyBoundaryCrossing(speaker.boundaries, persona?.description, combined)
          if (crossed) {
            toastInfo(`This reply may have crossed a stated limit: "${crossed}". Worth a regenerate if it reads wrong.`)
          }
          // Item 8: durable, not just the toast above — see `boundaryFlag`'s own doc comment
          // (`types.ts`) for why a message-level marker is the safer alternative to an automatic
          // reroll. `crossed ?? null`, not left conditionally omitted, so an old flag is actually
          // cleared when a later attempt reads clean, not left stale from a previous round.
          messagesApi.update(targetMessageId, { boundaryFlag: crossed ?? null }).catch(() => {})
        }

        // Post-reply assists. Each is fire-and-forget (never blocks the reply that just landed) but
        // routed through `runAssist` so the chat can show which ones are still running — on a local
        // single-GPU server they queue up on the model, and their results otherwise appear with no
        // warning that they were coming.
        const relationshipHistory = wasOriginallyContinuing
          ? [...historyForPrompt.slice(0, -1), { id: targetMessageId, role: 'char' as const, name: speaker.card.name, text: combined }]
          : [...historyForPrompt, { id: targetMessageId, role: 'char' as const, name: speaker.card.name, text: combined }]
        // A live scene (10b: date or its lower-stakes hangout sibling) suppresses the normal
        // per-turn drip-feed — its outcome is resolved once, at the end, by endDateEvent's own
        // assessDateOutcome pass instead.
        const inLiveDate = isLiveScene(chat.activeEvent)

        // Multi-character relationship tracking: scores whichever character actually just spoke,
        // not only the primary — `updateAffectionFromReply` resolves the right track either way.
        // A live date still suppresses this entirely regardless of speaker (dates stay primary-only
        // and end-of-scene-scored; see `inLiveDate` above).
        //
        // Section 9(c)'s last open (a) item: when task-detection is ALSO due this turn, its check
        // rides along inside this same judge call (`updateAffectionFromReply` → `assessRelationshipMoment`)
        // instead of firing as a second, separately-queued request — the same "fold it into the one
        // call already running" idea item 18 used for scene flags and fact extraction.
        // `tasksHandledByMerge` tells the standalone `autoDetectTasks` block below to skip its own
        // call when that happened. The merge only applies here (relationship tracking is due, not
        // suppressed by a live date) — during a live date, or with relationship-tracking off,
        // task-detection still runs standalone exactly as before.
        let tasksHandledByMerge = false
        if (effectiveAssistFlag(chat.assistOverrides?.autoTrackRelationship, autoTrackRelationship) && !inLiveDate) {
          // Intent from the just-sent message (opts), or from the latest stored user turn on a
          // regenerate/swipe where no fresh message was sent.
          const latestIntent = opts?.intent ?? [...messages].reverse().find((m) => m.role === 'user')?.intent
          if (autoDetectTasks) {
            tasksHandledByMerge = true
            runAssist('relationship', 'Updating relationship', async () => {
              // Fresh fetch, not the closure-captured `activeObjective` — this runs fire-and-forget
              // after the reply already landed, so a stale read here would risk marking tasks done
              // against an objective that's since moved on (same reasoning `detectAndMarkTasks` below
              // already followed).
              const objective = await objectivesApi.getActive(chat.id)
              const pending = objective?.tasks.filter((t) => t.status === 'pending') ?? []
              const completedIndices = await updateAffectionFromReply(chat.id, relationshipHistory, combined, latestIntent, speaker, pending)
              if (objective && completedIndices.length > 0) await applyCompletedTasks(objective, pending, completedIndices)
            })
          } else {
            runAssist('relationship', 'Updating relationship', () =>
              updateAffectionFromReply(chat.id, relationshipHistory, combined, latestIntent, speaker),
            )
          }
        }
        // 10b live rapport: during a live date, no stat scoring runs, so instead read how the scene
        // is trending and show that qualitatively. Cheap, stateless — never touches affection/stats.
        if (inLiveDate && isPrimarySpeaker) {
          const startedAt = chat.activeEvent?.startedAt ?? 0
          const rapportTail = [
            ...messages
              .filter((m) => m.createdAt >= startedAt && m.text.trim())
              .slice(-7)
              .map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text })),
            { id: targetMessageId, role: 'char' as const, name: speaker.card.name, text: combined },
          ]
          runAssist('rapport', 'Reading the room', async () => {
            const read = await assessRapport(client, {
              transcript: rapportTail,
              charName: character.card.name,
              userName: persona?.name || 'You',
              charPersonality: character.card.personality,
            })
            if (!read) return
            // 10b's "real stakes": a genuine dealbreaker ends the date for real, right now — not a
            // quiet score-only consequence the player only sees when they get around to ending it
            // themselves. `endDateEvent` re-checks `activeEvent` itself, so this is safe even if it
            // races with the player hitting "End date" at the same moment. Hangouts are deliberately
            // stakes-free (see `DateEventCard.kind` doc), so a walkOut read is never acted on there —
            // the rapport judge is still asked for one, it's just ignored.
            if (read.walkOut && chat.activeEvent?.kind === 'date') {
              await endDateEvent({ walkedOut: true })
              return
            }
            await chatsApi.update(chat.id, { rapport: { ...read, updatedAt: Date.now() } })
          })
        }
        if (effectiveAssistFlag(chat.assistOverrides?.autoSuggestChoices, autoSuggestChoices) && isPrimarySpeaker) {
          runAssist('choices', 'Suggesting replies', () => suggestChoicesForMessage(targetMessageId, relationshipHistory))
        }
        if (autoDetectTasks && !tasksHandledByMerge) {
          runAssist('tasks', 'Checking objective', () => detectAndMarkTasks(chat.id, combined))
        }
        if (autoSummarize) {
          runAssist('summary', 'Updating memory', () => updateMemorySummary())
        }
        if (visionSceneDetection) {
          runAssist('vision', 'Reading the scene', () => refineSceneWithVision(targetMessageId, speaker, combined, images))
        } else {
          runAssist('vision', 'Reading the scene', () => refineExpressionFromText(targetMessageId, speaker, combined))
        }
      } catch (e) {
        toastError(errorMessage(e))
        // `wroteAnything` covers an auto-continue round failing after an earlier round already
        // persisted real content — that content stays rather than getting wiped just because a
        // later extension attempt errored out.
        if (!wasOriginallyContinuing && !wroteAnything) {
          // Empty text, not an error string baked into the message — that string would otherwise
          // get fed back into every future prompt as something the character genuinely said. The
          // UI shows the failure itself, driven by `failed`, not by message content.
          await messagesApi.update(targetMessageId, { text: '', failed: true })
        }
      } finally {
        setIsGenerating(false)
        setStreamingText('')
        setGeneratingMessageId(null)
      }
    },
    [
      applyCompletedTasks,
      autoDetectTasks,
      autoSummarize,
      autoSuggestChoices,
      autoTrackRelationship,
      buildCurrentPrompt,
      character,
      chat,
      client,
      countTokens,
      detectAndMarkTasks,
      messages,
      refineExpressionFromText,
      refineSceneWithVision,
      resolveSpeaker,
      runAssist,
      sampler,
      suggestChoicesForMessage,
      template,
      updateAffectionFromReply,
      updateMemorySummary,
      visionSceneDetection,
    ],
  )

  const sendUserMessage = useCallback(
    async (
      text: string,
      attachments: PendingAttachment[] = [],
      opts?: { choice?: ChoiceOption; intent?: MessageIntent; intimacyOptionId?: string },
    ) => {
      if (!chatId || !beginGeneration()) return
      try {
        // Read fresh rather than trusting the hook's own (possibly one-render-stale) `chat` — both
        // the gift block below and the scene-policy resolution after it need this, so it's fetched
        // once here instead of twice.
        const freshChat = await chatsApi.get(chatId)
        if (!freshChat) return
        // Resolved once, up front, and reused below for who the gift goes to — multi-character
        // relationship tracking's gift half: giving a gift moves *this* target's own track, not
        // always the primary's, using the exact same "reply as" choice the composer already exposes
        // for a group chat rather than adding a second, separate "give to" picker. Deliberately
        // independent of the scene's turn policy below: a deliberate "give this to them" action
        // shouldn't get silently redirected by round-robin or an AI director.
        const { active: giftTarget } = resolveSpeaker(replyAsCharacterId)
        let giftId: string | undefined
        // Item 3's one-shot reaction steer for the character's very next reply turn — combined with
        // `intimacyDirective` below at the `runGeneration` call site, same one-shot channel.
        let giftReactionDirective: string | undefined
        if (opts?.choice?.kind === 'gift' && opts.choice.giftId && giftTarget) {
          const inventory = { ...(freshChat.giftInventory ?? defaultGiftInventory(world)) }
          const inStock = inventory[opts.choice.giftId] ?? 0
          if (inStock <= 0) {
            toastError('That gift is out of stock. Buy another from the relationship panel.')
            return
          }
          inventory[opts.choice.giftId] = inStock - 1
          if (inventory[opts.choice.giftId] <= 0) delete inventory[opts.choice.giftId]
          const gift = giftById(opts.choice.giftId, world)
          const preferenceScore = Math.max(-2, Math.min(3, Number(giftTarget.giftPreferences?.[opts.choice.giftId] ?? 0)))
          const track = getRelationshipTrack(freshChat, giftTarget.id)
          // Item 3: recency (not just lifetime count) of this exact gift, so a re-gift and an
          // obvious no-variety pattern read differently from a first-time gift — both in the stat
          // math below and in `giftReactionDirective`'s prose steer.
          const priorTimesGivenThisGift = track.giftsGiven?.[opts.choice.giftId] ?? 0
          const sameGiftRun = trailingSameGiftRun(track.giftLog, opts.choice.giftId)
          const isMismatch = preferenceScore <= -0.5
          const baseDelta = giftImpactBase(opts.choice.giftId, world) + preferenceScore
          const giftDelta = Math.round(
            (baseDelta > 0 ? baseDelta * giftRepetitionMultiplier(sameGiftRun) : baseDelta) +
              giftMismatchPenalty(preferenceScore, priorTimesGivenThisGift),
          )
          const affection = clampAffection((track.affection ?? 0) + giftDelta)
          const warmth = computeWarmth(affection, getRelationshipStats(track))
          const giftsGiven = { ...(track.giftsGiven ?? {}) }
          giftsGiven[opts.choice.giftId] = (giftsGiven[opts.choice.giftId] ?? 0) + 1
          // Item 6: a gift that genuinely lands (the same `>= 2` bar the durable-fact hook below
          // already uses) opens a short reciprocity window — see `gifts.ts`'s `ReciprocityCue`.
          // Milestone-crossing reciprocity is set separately in `announceMilestone`'s callers.
          const reciprocityCue: ReciprocityCue | undefined =
            preferenceScore >= 2 ? { startedAtTurn: countCharReplies(messages), reason: 'gift_received' } : undefined
          await chatsApi.update(chatId, {
            ...patchRelationshipTrack(freshChat, giftTarget.id, {
              affection,
              relationshipStage: relationshipStageForWarmth(warmth, relationshipMilestonesFor(world?.relationshipThresholds)),
              giftsGiven,
              giftLog: appendGiftLog(track.giftLog, opts.choice.giftId, messages.length),
              ...(reciprocityCue ? { reciprocityCue } : {}),
            }),
            // The owned-stock side of a gift stays a shared wallet, not tied to one relationship.
            giftInventory: inventory,
          })
          giftId = opts.choice.giftId
          if (gift) {
            text = `*I give ${giftTarget.card.name} ${withIndefiniteArticle(gift.name)}.* ${text}`
            giftReactionDirective = giftReactionGuidance(
              giftTarget.card.name,
              persona?.name || 'You',
              gift.name,
              sameGiftRun,
              isMismatch,
              priorTimesGivenThisGift,
              isMismatch ? undefined : { rarity: gift.rarity, preferenceScore },
            )
            // Item 3(c): a genuinely meaningful gift (a real authored love, not just "not disliked"),
            // the first couple of times it's given, earns a durable, emotionally-coloured memory —
            // hooked into the existing remembered-facts system (reaches the prompt every turn via
            // `buildFactsLorebook`) rather than a parallel reference-tracking system of its own, so a
            // character can plausibly call back to it later ("you still have that charm I gave you")
            // with no new machinery.
            if (preferenceScore >= 2 && priorTimesGivenThisGift < 2) {
              chatFactsApi
                .create({
                  chatId,
                  text: `${persona?.name || 'You'} gave ${giftTarget.card.name} ${withIndefiniteArticle(gift.name)}, and it really meant something to them.`,
                  importance: 0.6,
                  valence: 0.7,
                })
                .catch(() => {})
            }
          }
        }
        // Normalise the player's own markup the same way the model's is on store: `<i>` and `**` both
        // become `*action*`, so stored text, prompt history, and display all agree. Only the typed
        // line, never `composeMessageText`'s appended file contents.
        const composedText = composeMessageText(normalizeRpMarkup(text), attachments).trim()
        const apiImages = collectImageBase64(attachments)
        if (!composedText && apiImages.length === 0) return
        if (!reducedAudio) playSendBlip()

        // Stored as full data: URLs (renderable as-is); the API only ever sees the base64 payload.
        const storedImages = attachments.filter((a) => a.kind === 'image').map((a) => a.dataUrl)

        // An explicit-tier intimacy action (a position/toy/activity from the Relationship panel,
        // never a kissing spot) puts the character into their designated intimate outfit — decided
        // here rather than left to the model, since this is a discrete, deliberate, player-initiated
        // act, and the outfit it implies is usually `manualOnly` precisely so the model can't pick
        // it on its own. Stamped onto the player's own message so it takes effect from this moment
        // (see `currentOutfitFrom`), not only once the reply agrees. One-way by design: the story
        // tags its own way back out.
        const usedIntimacyOption = opts?.intimacyOptionId ? intimacyItemById(opts.intimacyOptionId, world) : undefined
        const startsIntimateScene = !!usedIntimacyOption && isExplicitCategory(usedIntimacyOption.category) && !!giftTarget
        const intimateOutfit =
          startsIntimateScene && giftTarget
            ? intimateOutfitFor(giftTarget.outfits, giftTarget.sprites, getRelationshipTrack(freshChat, giftTarget.id).affection ?? 0, new Set(freshChat.sceneFlags ?? []))
            : undefined
        // Opens the aftercare window (`dating/aftercare.ts`) on the same signal that changes the
        // outfit: the app knows an intimate scene is starting because the player deliberately
        // started one, so neither needs inferring from the prose. Re-opening while one is already
        // live just restarts the clock, which is the right reading of a second scene.
        if (startsIntimateScene && giftTarget) {
          await chatsApi.update(chatId, {
            ...patchRelationshipTrack(freshChat, giftTarget.id, {
              afterglow: {
                startedAtTurn: countCharReplies(messages),
                sourceLabel: usedIntimacyOption!.label,
                momentumAtStart: getRelationshipTrack(freshChat, giftTarget.id).momentum ?? 0,
              },
              // Item 1's intimacy scene state machine: starts (or re-centers, if one was already
              // live — the consent-checkpoint/renegotiation case, gated by the exact same catalog
              // click as any other intimacy action) at `'building'`, tracking what's now physically
              // happening so later turns can be told rather than having to infer it from scrollback.
              intimacyScene: startOrShiftIntimacyScene(
                resolveIntimacyPromptNote(usedIntimacyOption!, giftTarget.card.name),
                usedIntimacyOption!.category,
                countCharReplies(messages),
              ),
            }),
          })
        }
        // A `kissing_spot` action is a deterministic, player-initiated kiss — the commitment
        // ladder's physical-reality gate (`stage.ts`'s `commitmentLockReason`/`FIRST_KISS_FLAG`)
        // should unlock the instant this is clicked, not wait on next turn's AI classifier to
        // (maybe) notice it in prose. That classifier still separately covers a kiss written out in
        // freeform roleplay instead of through this button — see `assessRelationshipMoment`'s own
        // `first_kiss` glossary entry in `relationshipAssist.ts`. `kissing_spot` never satisfies
        // `isExplicitCategory`, so this never overlaps with the `startsIntimateScene` branch above.
        if (usedIntimacyOption?.category === 'kissing_spot' && !(freshChat.sceneFlags ?? []).includes(FIRST_KISS_FLAG)) {
          await chatsApi.update(chatId, { sceneFlags: [...(freshChat.sceneFlags ?? []), FIRST_KISS_FLAG] })
        }

        const now = Date.now()
        const userMsg: StoredMessage = {
          id: newId(),
          chatId,
          role: 'user',
          name: persona?.name || 'You',
          text: composedText,
          giftId,
          intent: opts?.intent,
          scene: intimateOutfit ? { outfit: intimateOutfit } : undefined,
          images: storedImages.length ? storedImages : undefined,
          createdAt: now,
        }
        await messagesApi.create(userMsg)

        // Section 4/12's "proper Scene entity": who actually replies, per the chat's turn policy —
        // `'manual'` (or no scene at all) keeps today's exact behavior, the same "reply as" choice
        // gifting uses above. The other three only ever engage once there's an actual roster to
        // choose among; each falls back to `giftTarget` (manual resolution) on its own terms rather
        // than ever leaving `speaker` unset.
        let speaker = giftTarget
        const turnPolicy = freshChat.scene?.turnPolicy ?? 'manual'
        if (turnPolicy !== 'manual' && character && participantCharacters.length > 0) {
          const roster = rosterFrom(character, participantCharacters)
          if (turnPolicy === 'round_robin') {
            const next = nextRoundRobinSpeaker(roster, freshChat.scene?.roundRobinIndex)
            if (next) {
              speaker = resolveSpeaker(next.id).active
              // Advanced immediately rather than after the reply lands, so the bookkeeping can't be
              // reused by a rapid second send while this one is still generating.
              await chatsApi.update(chatId, { scene: { ...freshChat.scene!, roundRobinIndex: next.nextIndex } })
            }
          } else if (turnPolicy === 'mention') {
            const mention = parseMention(text, roster)
            if (mention) speaker = resolveSpeaker(mention.id).active
          } else if (turnPolicy === 'director') {
            const historyForDirector: ChatMessage[] = messages.map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
            const pickedId = await pickDirectorSpeaker(client, {
              roster,
              history: historyForDirector,
              userName: persona?.name || 'You',
              sceneLocation: freshChat.scene?.location ?? undefined,
            })
            if (pickedId) speaker = resolveSpeaker(pickedId).active
          }
        }

        // createdAt is offset by 1ms and sent explicitly so this reply always sorts after the
        // user's turn even though both are created in the same synchronous burst.
        const charMsg: StoredMessage = {
          id: newId(),
          chatId,
          role: 'char',
          name: speaker?.card.name || character?.card.name || 'Character',
          speakerId: speaker && speaker.id !== character?.id ? speaker.id : undefined,
          text: '',
          createdAt: now + 1,
          swipes: [],
          activeSwipe: 0,
        }
        await messagesApi.create(charMsg)

        const historyForPrompt: ChatMessage[] = [...messages, userMsg].map((m) => ({
          id: m.id,
          role: m.role,
          name: m.name,
          text: m.text,
        }))
        // When the player used a Relationship-panel intimacy action, hand the reply turn an explicit
        // directive naming what was just initiated — a terse `*I ease {char} onto their back*` alone
        // reads like a stage direction the model can skip past (the user's own report).
        const intimacyDirective =
          usedIntimacyOption && speaker
            ? intimacyActionDirective(usedIntimacyOption, persona?.name || 'You', speaker.card.name)
            : undefined
        await runGeneration(historyForPrompt, charMsg.id, apiImages, {
          speakerId: speaker?.id ?? null,
          intent: opts?.intent,
          // Item 3's one-shot gift-reaction steer rides alongside the intimacy directive — both are
          // one-shot corrections for this exact reply turn only, never persisted anywhere.
          extraStyleGuidance: [intimacyDirective, giftReactionDirective].filter(Boolean).join(' ') || undefined,
        })
      } finally {
        endGeneration()
      }
    },
    [beginGeneration, character, chatId, client, endGeneration, messages, participantCharacters, persona, reducedAudio, replyAsCharacterId, resolveSpeaker, runGeneration, world],
  )

  const regenerate = useCallback(
    async (messageId: string) => {
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return
      // Claimed after the lookup, so a regenerate aimed at a message that no longer exists never
      // takes the lock — and before the blanking write below, which a second rapid click would
      // otherwise land on top of a run already streaming into that same row.
      if (!beginGeneration()) return
      try {
        const priorMessages = messages.slice(0, idx)
        const historyForPrompt: ChatMessage[] = priorMessages.map((m) => ({
          id: m.id,
          role: m.role,
          name: m.name,
          text: m.text,
        }))
        await messagesApi.update(messageId, { text: '', failed: false, boundaryFlag: null })
        // Regenerating keeps whoever originally said it, rather than letting a regenerate silently
        // switch the speaker — that's a distinct, explicit action (editing the message).
        await runGeneration(historyForPrompt, messageId, latestImages(priorMessages), { speakerId: messages[idx].speakerId })
      } finally {
        endGeneration()
      }
    },
    [beginGeneration, endGeneration, messages, runGeneration],
  )

  /**
   * Item 4's player-facing "steer" control — separate from both intent chips (which color the
   * player's own next line) and Author's Note (a standing, persistent steer). Re-generates one
   * specific reply with a strong, explicit, one-shot correction (`dating/steer.ts`) folded into
   * `extraStyleGuidance` for just this call — nothing is written to the chat, the character card, or
   * any persistent prompt section. Byte-for-byte mirrors `regenerate` otherwise (same lock, same
   * "keep whoever originally said it" rule); a blank `steerText` just falls back to a plain
   * regenerate rather than silently doing nothing.
   */
  const regenerateWithSteer = useCallback(
    async (messageId: string, steerText: string) => {
      const trimmed = steerText.trim()
      if (!trimmed) return regenerate(messageId)
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return
      if (!beginGeneration()) return
      try {
        const priorMessages = messages.slice(0, idx)
        const historyForPrompt: ChatMessage[] = priorMessages.map((m) => ({
          id: m.id,
          role: m.role,
          name: m.name,
          text: m.text,
        }))
        await messagesApi.update(messageId, { text: '', failed: false, boundaryFlag: null })
        const speakerId = messages[idx].speakerId
        const charName = (speakerId ? participantCharacters.find((c) => c.id === speakerId) : character)?.card.name ?? character?.card.name ?? 'the character'
        await runGeneration(historyForPrompt, messageId, latestImages(priorMessages), {
          speakerId,
          extraStyleGuidance: buildSteerDirective(trimmed, charName),
        })
      } finally {
        endGeneration()
      }
    },
    [beginGeneration, character, endGeneration, messages, participantCharacters, regenerate, runGeneration],
  )

  const swipe = useCallback(
    async (messageId: string, direction: 'left' | 'right') => {
      const msg = messages.find((m) => m.id === messageId)
      if (!msg) return
      const swipes = msg.swipes ?? [msg.text]
      const current = msg.activeSwipe ?? 0
      if (direction === 'right' && current === swipes.length - 1) {
        // Only this branch generates; stepping between existing swipes is a pure read and stays
        // usable while a reply is in flight, exactly as before. The lock covers the `swipes`
        // append too — two fast clicks used to push two empty swipes and generate into only one,
        // leaving a permanently blank swipe stranded in the message.
        if (!beginGeneration()) return
        try {
          const idx = messages.findIndex((m) => m.id === messageId)
          const priorMessages = messages.slice(0, idx)
          const historyForPrompt: ChatMessage[] = priorMessages.map((m) => ({
            id: m.id,
            role: m.role,
            name: m.name,
            text: m.text,
          }))
          const newSwipes = [...swipes, '']
          await messagesApi.update(messageId, {
            swipes: newSwipes,
            activeSwipe: newSwipes.length - 1,
            text: '',
            boundaryFlag: null,
          })
          await runGeneration(historyForPrompt, messageId, latestImages(priorMessages), { speakerId: msg.speakerId })
        } finally {
          endGeneration()
        }
        return
      }
      const nextIndex = direction === 'left' ? Math.max(0, current - 1) : Math.min(swipes.length - 1, current + 1)
      await messagesApi.update(messageId, {
        activeSwipe: nextIndex,
        text: swipes[nextIndex],
        scene: msg.swipeScenes?.[nextIndex],
        rawText: msg.swipeRawTexts?.[nextIndex],
        // `boundaryFlag` isn't tracked per-swipe (unlike `scene`) — a flag from whichever swipe was
        // previously active describes text that's no longer showing, so it's cleared here rather
        // than left attached to different content.
        boundaryFlag: null,
      })
    },
    [beginGeneration, endGeneration, messages, runGeneration],
  )

  const continueMessage = useCallback(async () => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'char' || !last.text.trim()) return
    if (!beginGeneration()) return
    try {
      const historyForPrompt: ChatMessage[] = messages.map((m) => ({
        id: m.id,
        role: m.role,
        name: m.name,
        text: m.text,
      }))
      await runGeneration(historyForPrompt, last.id, latestImages(messages), { continuing: true, speakerId: last.speakerId })
    } finally {
      endGeneration()
    }
  }, [beginGeneration, endGeneration, messages, runGeneration])

  const canContinue =
    messages.length > 0 &&
    messages[messages.length - 1].role === 'char' &&
    !!messages[messages.length - 1].text.trim()

  /** Suggests what the persona might say next, in their voice — returned for the caller to drop into the composer, never auto-sent. */
  const impersonate = useCallback(async (): Promise<string> => {
    if (!character || !chat) return ''
    const historyForPrompt: ChatMessage[] = messages.map((m) => ({
      id: m.id,
      role: m.role,
      name: m.name,
      text: m.text,
    }))
    const built = await buildCurrentPrompt(historyForPrompt, { impersonateAsUser: true })
    if (!built) return ''
    const text = await generateWithTimeout(
      client,
      { ...sampler, prompt: built.prompt, genkey: makeGenKey() },
      'Suggest a reply',
    )
    // The generation cue already ends with "{{user}}:", so a model that opens with "Kai: " is
    // echoing the label, not naming itself — the same scrub the character reply path gets. Passing
    // the persona name as `charName` (the expected speaker of *this* text) strips that leading
    // label; passing the character name as `personaName` truncates the suggestion if the model runs
    // on past {{user}}'s line into {{char}}'s reply.
    return cleanModelOutput(text, { charName: persona?.name || 'You', personaName: character.card.name })
  }, [buildCurrentPrompt, character, chat, client, messages, persona?.name, sampler])

  /**
   * Writes the player's action line for a Relationship-panel intimacy option, adapted to the scene
   * as it stands right now instead of the one fixed sentence every time (the user's ask: "a
   * different message each time, depending on scenario and the messages before"). Returns text for
   * the composer — reviewed and sent by hand, never auto-sent, same as `impersonate`. On any
   * failure the caller falls back to the entry's own `composeIntimacyActionText`.
   */
  const draftIntimacyAction = useCallback(
    async (optionId: string): Promise<string> => {
      if (!character || !chat) return ''
      const option = intimacyItemById(optionId, world)
      if (!option) return ''
      const personaName = persona?.name || 'You'
      const charName = character.card.name
      const historyForPrompt: ChatMessage[] = messages.map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
      const directive = [
        `${personaName} is initiating this now: ${resolveIntimacyPromptNote(option, charName)}.`,
        `Write ${personaName}'s move into it: one to three sentences, present tense, in ${personaName}'s voice, fitting exactly where the scene already is (what was just said, the mood, what everyone is or isn't wearing). Actions in *asterisks*, anything said aloud in "quotes".`,
        `A starting point, only if it helps: ${composeIntimacyActionText(option, charName)}`,
      ].join(' ')
      const built = await buildCurrentPrompt(historyForPrompt, { impersonateAsUser: true, extraStyleGuidance: directive })
      if (!built) return ''
      const text = await generateWithTimeout(
        client,
        { ...sampler, prompt: built.prompt, genkey: makeGenKey() },
        'Adapt intimacy action',
      )
      return cleanModelOutput(text, { charName: personaName, personaName: charName })
    },
    [buildCurrentPrompt, character, chat, client, messages, persona?.name, sampler, world],
  )

  const createObjective = useCallback(
    async (title: string, description: string, createdBy: 'user' | 'ai' = 'user') => {
      if (!chatId || !title.trim()) return
      // Only one objective can be active per chat — retire whatever was active before.
      const existing = await objectivesApi.listByChat(chatId, 'active')
      for (const o of existing) await objectivesApi.update(o.id, { status: 'abandoned' })
      await objectivesApi.create({
        chatId,
        title: title.trim(),
        description: description.trim(),
        tasks: [],
        status: 'active',
        createdBy,
      })
    },
    [chatId],
  )

  const generateTasksForActiveObjective = useCallback(async () => {
    if (!activeObjective || !character) return
    const tasks = await generateTasks(
      client,
      activeObjective.title,
      activeObjective.description ?? '',
      character.card,
    )
    const newTasks: ObjectiveTask[] = tasks.map((description) => ({
      id: newId(),
      description,
      status: 'pending',
    }))
    await objectivesApi.update(activeObjective.id, { tasks: [...activeObjective.tasks, ...newTasks] })
  }, [activeObjective, character, client])

  const addManualTask = useCallback(
    async (description: string) => {
      if (!activeObjective || !description.trim()) return
      const task: ObjectiveTask = { id: newId(), description: description.trim(), status: 'pending' }
      await objectivesApi.update(activeObjective.id, { tasks: [...activeObjective.tasks, task] })
    },
    [activeObjective],
  )

  const toggleTask = useCallback(
    async (taskId: string) => {
      if (!activeObjective) return
      const now = Date.now()
      const tasks = activeObjective.tasks.map((t) =>
        t.id === taskId
          ? { ...t, status: t.status === 'done' ? ('pending' as const) : ('done' as const), completedAt: now }
          : t,
      )
      await objectivesApi.update(activeObjective.id, { tasks })
    },
    [activeObjective],
  )

  const setObjectiveStatus = useCallback(
    async (status: 'completed' | 'abandoned') => {
      if (!activeObjective) return
      await objectivesApi.update(activeObjective.id, { status })
      // `null`, not `undefined` — JSON.stringify drops undefined-valued keys entirely, so the
      // server would never see this field in the PATCH body and the stale activeEvent would stick.
      if (chatId) await chatsApi.update(chatId, { activeEvent: null })
      // 10a's "Economy" bullet: completing an objective is the one earning moment available to a
      // player who mostly just talks through ordinary roleplay instead of deliberately starting
      // formal dates/hangouts (which already earn their own payout via `endDateEvent`). Only a
      // deliberate 'completed' grants this — 'abandoned' earns nothing. See
      // `OBJECTIVE_COMPLETE_COIN_BONUS`'s own doc comment for why this amount.
      if (status === 'completed' && chatId) {
        const coinsGranted = await getCoinMutex(chatId).run(async () => {
          const liveChat = await chatsApi.get(chatId)
          if (!liveChat) return 0
          await chatsApi.update(chatId, { giftCoins: Math.max(0, (liveChat.giftCoins ?? 0) + OBJECTIVE_COMPLETE_COIN_BONUS) })
          return OBJECTIVE_COMPLETE_COIN_BONUS
        })
        if (coinsGranted) toastSuccess(`Objective complete — +${coinsGranted} coins`, { chime: true })
      }
    },
    [activeObjective, chatId],
  )

  /** Proposes a plausible objective from the character + persona — returned for the caller to review before creating it. */
  const suggestObjectiveIdea = useCallback(async (): Promise<{ title: string; description: string }> => {
    if (!character) return { title: '', description: '' }
    return suggestObjective(
      client,
      character.card,
      { name: persona?.name || 'You', description: persona?.description || '' },
    )
  }, [character, client, persona])

  const suggestDateEventIdea = useCallback(async (): Promise<DateEventCard | null> => {
    if (!character || !chat) return null
    const availableBackgrounds = getUnlockedBackgroundIds(world, chat.affection ?? 0)
    return suggestDateEvent(client, {
      characterName: character.card.name,
      characterDescription: character.card.description,
      personaName: persona?.name || 'You',
      worldDescription: world?.description,
      availableBackgrounds,
      affection: chat.affection ?? 0,
      commitmentStatus: chat.commitmentStatus ?? 'none',
      recentGiftName: recentMeaningfulGiftName(chat.giftLog, character.giftPreferences, world),
    })
  }, [character, chat, client, persona?.name, world])

  /**
   * Starting a `kind: 'date'` or `'hangout'` card spends one of the world's daily actions (10a's
   * "Energy/action economy") — gift/milestone cards aren't a "spend a chunk of the day doing
   * something" activity the way a live scene is, so they're left free. No world assigned to this
   * character means no clock to spend against, so energy simply doesn't apply (unlimited, same as
   * before this existed).
   */
  const startDateEvent = useCallback(
    async (event: DateEventCard) => {
      if (!chatId || !event.title.trim() || !event.objectiveTitle.trim()) return
      // Captured before any energy spend below rolls the world clock forward — once a day's last
      // action forces a rollover, the *persisted* clock jumps straight to next morning and no
      // longer represents the moment the activity is actually happening in (see `activityPhase`'s
      // own doc comment). The opener below grounds its opening line on this snapshot instead of
      // reading the live (by then already-advanced) world state.
      let openingMomentNote: string | undefined
      if ((event.kind === 'date' || event.kind === 'hangout') && world) {
        const freshWorld = await worldsApi.get(world.id)
        const day = freshWorld?.currentDay ?? 0
        const phaseIndex = freshWorld?.currentPhaseIndex ?? 0
        if (getEnergyRemaining(day, phaseIndex) <= 0) {
          toastError(`No energy left today — get some rest before starting another ${event.kind === 'hangout' ? 'hangout' : 'date'}.`)
          return
        }
        if (character) {
          const moment = activityPhase(day, phaseIndex)
          // `describeWorldMoment` writes `{{char}}` as a literal macro (correct for `worldDescription`,
          // which is macro-substituted) — `styleGuidance` isn't, so it's resolved by hand here rather
          // than leaking a literal `{{char}}` into the actual prompt sent to the model.
          openingMomentNote = describeWorldMoment({
            worldId: world.id,
            characterId: character.id,
            day: moment.day,
            phaseIndex: moment.phaseIndex,
            weatherPreferences: character.weatherPreferences,
          }).replace(/\{\{char\}\}/g, character.card.name)
        }
        const result = spendEnergy(day, phaseIndex)
        await worldsApi.update(world.id, { currentDay: result.day, currentPhaseIndex: result.phaseIndex })
        if (result.slept) {
          const weather = getWeather(world.id, result.day)
          toastSuccess(`Tired after a full day, you call it a night. A new morning dawns — ${describeWeather(weather)}.`)
        }
      }
      await createObjective(event.objectiveTitle, event.objectiveDescription ?? event.description ?? '', 'ai')
      // 10b's "real stakes": draft what the character secretly wants from this scene, from their
      // own card. Best-effort and never blocks starting the date — a card too thin to draft one
      // from, or a judge call that fails, just leaves it unset.
      let hiddenAgenda: string | undefined
      if (event.kind === 'date' && character) {
        const warmthLabel = formatRelationshipStage(
          relationshipStageForWarmth(
            computeWarmth(chat?.affection ?? 0, getRelationshipStats({ relationshipStats: chat?.relationshipStats })),
            relationshipMilestonesFor(world?.relationshipThresholds),
          ),
        )
        hiddenAgenda =
          (await draftHiddenAgenda(client, {
            charName: character.card.name,
            charPersonality: character.card.personality,
            charGoals: character.goals,
            charBoundaries: character.boundaries,
            eventTitle: event.title,
            warmthLabel,
          }).catch(() => null)) ?? undefined
      }
      // Stamped on every event regardless of kind — harmless metadata for gift/milestone cards,
      // which never read it — but for a `kind: 'date'` card its presence is what marks this as a
      // live, scored date (10b) rather than the original lightweight event-card flow, and its
      // value is the cutoff `endDateEvent` uses to gather this date's own transcript.
      // Clear any rapport read left over from a previous date so the indicator starts blank.
      await chatsApi.update(chatId, { activeEvent: { ...event, startedAt: Date.now(), hiddenAgenda }, rapport: null })

      // "Breaking the ice" (10b's top-of-section ask): a live date/hangout is a real streamed
      // scene, not a checklist the player messages a stranger into — so the character opens it,
      // the same instant it starts, rather than leaving an empty composer waiting on the player.
      // Built exactly like a fresh reply (a new empty char message, `runGeneration` over the
      // existing history) with one difference: `extraStyleGuidance` tells the model this is an
      // opening, not a response, since the history it's reading may end on the character's OWN
      // last line from before the scene began — a shape nothing else in the app produces.
      if ((event.kind === 'date' || event.kind === 'hangout') && character) {
        const sceneNoun = event.kind === 'hangout' ? 'hangout' : 'date'
        // Narrow but real: another generation (a regular reply, a swipe) can still be in flight the
        // instant this fires, and runGeneration's shared refs (abort controller, gen key,
        // streaming-text state) genuinely can't run two at once — skip rather than corrupt that
        // state, but say so, since silently skipping would recreate the exact "empty composer,
        // waiting on the player" gap this feature exists to close.
        //
        // The claim doubles as that check (it fails exactly when something else holds the lock),
        // which also closes the gap the old `isGenerating` read left: everything above this point
        // awaits, so by the time the branch was reached the captured state could be several
        // renders stale — precisely the case a scene opener firing next to a live reply hits.
        if (!beginGeneration()) {
          toastInfo(`${event.title} has started — ${character.card.name} will pick it up as soon as the current reply finishes, or send a message yourself.`)
        } else {
          try {
            const openerId = newId()
            await messagesApi.create({
              id: openerId,
              chatId,
              role: 'char',
              name: character.card.name,
              text: '',
              createdAt: Date.now(),
              swipes: [],
              activeSwipe: 0,
            })
            const historyForPrompt: ChatMessage[] = messages.map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
            await runGeneration(historyForPrompt, openerId, [], {
              extraStyleGuidance: [
                `This is the very start of the ${sceneNoun} — ${character.card.name} arrives and opens the moment themselves (a greeting, a glance, a first line or gesture), rather than waiting for ${persona?.name || 'them'} to speak first. Do not narrate that you are waiting, and do not ask what happens next.`,
                openingMomentNote,
              ]
                .filter(Boolean)
                .join(' '),
            })
          } finally {
            endGeneration()
          }
        }
      }
    },
    [beginGeneration, character, chat?.affection, chat?.relationshipStats, chatId, client, createObjective, endGeneration, messages, persona?.name, runGeneration, world],
  )
  // Kept current every render — see `startDateEventRef`'s own doc comment, above `askForCommitment`.
  startDateEventRef.current = startDateEvent

  /**
   * Ends an active live scene (`kind: 'date'` or its `'hangout'` sibling) with a single validated
   * judge pass over the whole scene's transcript (10b's "save-safe end-of-date scoring") rather
   * than the per-turn drip-feed ordinary chat gets — see `assessDateOutcome`. A scene with no
   * messages since it started just closes quietly, no judge call and no relationship movement:
   * starting one and never speaking shouldn't count for or against anything.
   */
  const endDateEvent = useCallback(async (opts?: { walkedOut?: boolean }) => {
    if (!chatId || !character) return
    const freshChat = await chatsApi.get(chatId)
    const event = freshChat?.activeEvent
    if (!freshChat || !event?.startedAt) return
    const startedAt = event.startedAt

    const closeOutEvent = async () => {
      // `null`, not `undefined` — see the note on the other clearing call site above. Rapport is
      // scene-scoped, so it clears with the date it belonged to.
      await chatsApi.update(chatId, { activeEvent: null, rapport: null })
      if (activeObjective) await objectivesApi.update(activeObjective.id, { status: 'completed' })
    }

    const dateMessages = messages.filter((m) => m.createdAt >= startedAt && m.text.trim())
    const transcript: ChatMessage[] = dateMessages.map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
    const intents = dateMessages.filter((m) => m.role === 'user' && m.intent).map((m) => m.intent as string)
    if (transcript.length === 0) {
      await closeOutEvent()
      toastSuccess(`${event.title} ended without anything happening.`)
      return
    }

    const currentAffection = freshChat.affection ?? 0
    const currentStats = getRelationshipStats(freshChat)
    const existingFlags = new Set((freshChat.sceneFlags ?? []) as SceneFlag[])
    const outcome = await assessDateOutcome(client, {
      transcript,
      eventTitle: event.title,
      charName: character.card.name,
      userName: persona?.name || 'You',
      current: { affection: currentAffection, ...currentStats },
      knownFacts: activeFacts.map((f) => f.text),
      customFlags: world?.customSceneFlags,
      intents,
      hiddenAgenda: event.hiddenAgenda,
      walkedOut: opts?.walkedOut,
      sceneKind: event.kind === 'hangout' ? 'hangout' : 'date',
    })
    const deltas = scaleDeltasForDifficulty(outcome.deltas, relationshipDifficulty)
    outcome.newFlags.forEach((flag) => existingFlags.add(flag))
    if (outcome.newFacts.length > 0) {
      const sourceMessageId = transcript[transcript.length - 1]?.id
      for (const f of outcome.newFacts) {
        chatFactsApi
          .create({ chatId, text: f.text, sourceMessageId, importance: f.importance, valence: f.valence, unresolved: f.unresolved || undefined })
          .catch(() => {})
      }
    }
    const affection = clampAffection(currentAffection + deltas.affection)
    let nextStats = { ...currentStats }
    for (const dim of RELATIONSHIP_DIMENSIONS) nextStats[dim] = clampStat(currentStats[dim] + deltas[dim])
    const milestones = relationshipMilestonesFor(world?.relationshipThresholds)
    const previousStage = relationshipStageForWarmth(computeWarmth(currentAffection, currentStats), milestones)
    const risk = applyRelationshipRisk({
      charName: character.card.name,
      commitmentStatus: freshChat.commitmentStatus ?? 'none',
      stats: nextStats,
      existingWarning: freshChat.relationshipWarning,
      breakupCount: freshChat.breakupCount ?? 0,
    })
    nextStats = risk.stats
    const warmth = computeWarmth(affection, nextStats)
    const relationshipStage = relationshipStageForWarmth(warmth, milestones)

    const unlockedSet = new Set(freshChat.unlockedGalleryIds ?? [])
    const previouslyUnlockedIds = new Set(unlockedSet)
    unlockedEndingIds(character.gallery, relationshipStage, unlockedSet).forEach((id) => unlockedSet.add(id))
    const lockedGallery = (character.gallery ?? []).filter(
      (g) => !g.isEnding && !unlockedSet.has(g.id) && hasRequiredFlags(g.requiredFlags, existingFlags),
    )
    if (lockedGallery.length > 0) {
      const unlockedIds = await detectGalleryUnlocks(client, {
        character,
        locked: lockedGallery,
        affection,
        latestReply: outcome.recap,
      })
      unlockedIds.forEach((id) => unlockedSet.add(id))
    }

    // 10a's "Economy" bullet, first slice: coins earned from how the date actually went, not
    // handed out flat — a date that lands earns real money, a flat or hurtful one earns none.
    // Still chat-scoped (`Chat.giftCoins`) like every other coin flow today, not the shared
    // per-world wallet the roadmap ultimately wants — that's a bigger migration, left open.
    //
    // The payout write runs inside the coin mutex, re-reading the balance *inside* the lock rather
    // than the `freshChat` snapshot fetched before `assessDateOutcome`'s AI call — by the time a
    // multi-turn date ends, that snapshot is easily stale enough for a Shop purchase made mid-date
    // to race it and lose its deduction. See `coinMutex.ts`.
    const coinsEarned = Math.max(0, Math.round(deltas.affection * 2))
    await getCoinMutex(chatId).run(async () => {
      const liveChat = (await chatsApi.get(chatId)) ?? freshChat
      const nextCoins = (liveChat.giftCoins ?? 0) + coinsEarned
      await chatsApi.update(chatId, {
        affection,
        relationshipStats: nextStats,
        relationshipStage,
        sceneFlags: [...existingFlags],
        unlockedGalleryIds: [...unlockedSet],
        giftCoins: nextCoins,
        commitmentStatus: risk.commitmentStatus,
        relationshipWarning: risk.relationshipWarning ?? null,
        breakupCount: risk.breakupCount,
      })
    })
    await closeOutEvent()

    const changedDeltas = Object.fromEntries(Object.entries(deltas).filter(([, v]) => v !== 0))
    relationshipEventsApi
      .create({
        chatId,
        reason: `${event.title}: ${outcome.recap}`,
        deltas: changedDeltas,
        newFlags: outcome.newFlags.length ? outcome.newFlags : undefined,
        sourceMessageId: transcript[transcript.length - 1]?.id,
      })
      .catch(() => {})

    // A walkout is a real, bad outcome — read it back as one (a red toast), not the same
    // congratulatory tone as an ordinary date ending.
    if (opts?.walkedOut) toastError(outcome.recap)
    else toastSuccess(outcome.recap)
    if (coinsEarned > 0) toastSuccess(`Earned ${coinsEarned} coins from the ${event.kind === 'hangout' ? 'hangout' : 'date'}`)
    await announceMilestone({
      charName: character.card.name,
      personaName: persona?.name || 'You',
      chatId,
      previousStage,
      relationshipStage,
      sourceMessageId: transcript[transcript.length - 1]?.id,
      characterId: character.id,
      turnCount: countCharReplies(messages),
    })
    for (const id of unlockedSet) {
      if (previouslyUnlockedIds.has(id)) continue
      const entry = character.gallery?.find((g) => g.id === id)
      toastSuccess(entry?.isEnding ? `An ending unlocked: ${entry.title}` : `New gallery scene unlocked: ${entry?.title ?? 'untitled'}`)
    }
  }, [activeFacts, activeObjective, character, chatId, client, messages, persona?.name, relationshipDifficulty, world])

  const forkChat = useCallback(
    async (messageId?: string) => {
      if (!chatId) return
      try {
        const forked = await chatsApi.fork(chatId, messageId)
        setActiveChatId(forked.id)
        toastSuccess('Forked into a new chat — the original is untouched.')
      } catch (e) {
        toastError(errorMessage(e))
      }
    },
    [chatId, setActiveChatId],
  )

  const editMessage = useCallback(async (messageId: string, text: string) => {
    const msg = await messagesApi.get(messageId)
    const swipes = msg?.swipes ? [...msg.swipes] : [text]
    if (msg?.activeSwipe !== undefined && swipes[msg.activeSwipe] !== undefined) {
      swipes[msg.activeSwipe] = text
    }
    // A hand-edit is the player's own words now, not the flagged generation — the old flag no
    // longer describes what's actually there, so it's cleared rather than left stale.
    await messagesApi.update(messageId, { text, swipes, boundaryFlag: null })
  }, [])

  const deleteMessage = useCallback(async (messageId: string) => {
    await messagesApi.remove(messageId)
  }, [])

  /**
   * Section 15's "Rewind" — the bulk case one-at-a-time delete doesn't cover: back out of a scene
   * that went several turns in an unwanted direction by deleting a message and everything after
   * it, in one action. Deliberately not a new server endpoint — `messages` (already loaded,
   * already in order) tells us exactly which ids that is; no bulk-delete route exists or is needed
   * for a local single-user app's message counts. Unlike forking (section 4), which is for
   * *keeping* both branches, this discards the tail outright.
   */
  const rewindToMessage = useCallback(
    async (messageId: string) => {
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return
      await Promise.all(messages.slice(idx).map((m) => messagesApi.remove(m.id)))
    },
    [messages],
  )

  const togglePinMessage = useCallback(async (messageId: string) => {
    const msg = await messagesApi.get(messageId)
    await messagesApi.update(messageId, { pinned: !msg?.pinned })
  }, [])

  const abortGeneration = useCallback(async () => {
    abortRef.current?.abort()
    if (genKeyRef.current) await client.abort(genKeyRef.current)
    setIsGenerating(false)
  }, [client])

  return {
    chat,
    character,
    persona,
    world,
    activeObjective,
    participantCharacters,
    replyAsCharacterId,
    setReplyAsCharacterId,
    messages,
    isGenerating,
    streamingText,
    generatingMessageId,
    genStats,
    assistActivity,
    sendUserMessage,
    regenerate,
    regenerateWithSteer,
    swipe,
    editMessage,
    deleteMessage,
    rewindToMessage,
    togglePinMessage,
    abortGeneration,
    previewPrompt,
    updateAuthorNote,
    updateScene,
    updateMemorySummary,
    continueMessage,
    canContinue,
    impersonate,
    draftIntimacyAction,
    createObjective,
    generateTasksForActiveObjective,
    addManualTask,
    toggleTask,
    setObjectiveStatus,
    suggestObjectiveIdea,
    suggestDateEventIdea,
    startDateEvent,
    endDateEvent,
    regenerateChoices,
    buyGift,
    buyItem,
    buyToy,
    useItem,
    askForCommitment,
    initiateFirstTime,
    endRelationship,
    forkChat,
    client,
  }
}
