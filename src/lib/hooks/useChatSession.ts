import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatFactsApi, chatsApi, instructTemplatesApi, messagesApi, objectivesApi, personasApi, relationshipEventsApi, worldInfoBooksApi, worldsApi } from '@/lib/api/client'
import { newId } from '@/lib/id'
import type { AuthorNote, Chat, CommitmentStatus, DateEventCard, ObjectiveTask, RelationshipStage, StoredMessage, WorldCard } from '@/lib/types'
import { collectImageBase64, composeMessageText, type PendingAttachment } from '@/lib/attachments'
import { KoboldClient, makeGenKey } from '@/lib/api/kobold'
import { buildPrompt, estimateTokens, type ChatMessage } from '@/lib/prompt/builder'
import { SUMMARY_MAX_LENGTH, summarizeMessages } from '@/lib/prompt/summarize'
import { generateChoices } from '@/lib/prompt/choices'
import { detectCompletedTasks, generateTasks, suggestObjective } from '@/lib/objectives/objectiveAssist'
import {
  assessCommitmentAsk,
  assessDateOutcome,
  assessRelationshipMoment,
  detectGalleryUnlocks,
  scaleDeltasForDifficulty,
  suggestDateEvent,
} from '@/lib/dating/relationshipAssist'
import {
  describePresence,
  describeWeather,
  describeWorldMoment,
  getCurrentActivity,
  getEnergyRemaining,
  getWeather,
  spendEnergy,
} from '@/lib/world/calendar'
import {
  applyBreakupScar,
  clampAffection,
  clampStat,
  computeWarmth,
  crossedMilestone,
  evaluateRelationshipRisk,
  formatCommitmentStatus,
  formatRelationshipStage,
  getRelationshipStats,
  nextCommitmentTier,
  RELATIONSHIP_DIMENSIONS,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
  unlockedEndingIds,
} from '@/lib/dating/stage'
import { defaultGiftInventory, getGiftCatalog, giftById, giftImpactBase } from '@/lib/dating/gifts'
import { itemById } from '@/lib/dating/items'
import { resolveInstructTemplate } from '@/lib/prompt/instructTemplates'
import { extractSceneTag, stripSceneTagForDisplay, type SceneTag } from '@/lib/vn/sceneTag'
import { SCENE_MOOD_IDS } from '@/lib/vn/moods'
import { DEFAULT_EXPRESSION_IDS } from '@/lib/vn/expressions'
import { DEFAULT_BACKGROUND_IDS } from '@/lib/vn/backgrounds'
import { bookAppliesToChat } from '@/lib/worldinfo/scope'
import { buildFactsLorebook } from '@/lib/worldinfo/facts'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { errorMessage, toastError, toastInfo, toastSuccess } from '@/lib/store/useToastStore'
import { playSendBlip } from '@/lib/audio/sfx'
import type { Character, Lorebook } from '@/lib/characters/cardSpec'
import { buildCharacterProfileNote } from '@/lib/characters/profile'
import type { ChoiceOption, RelationshipDimension, RelationshipWarning, SceneFlag } from '@/lib/types'

/** Minimum number of newly-eligible messages before auto-summarize bothers running (avoids a summarization call on every single turn). */
const MIN_BATCH_FOR_AUTO_SUMMARY = 6

/** Extra generation rounds `runGeneration` allows itself when a reply looks cut off by hitting max_length, before giving up and leaving it as-is. */
const MAX_AUTO_CONTINUE_ROUNDS = 2

/** A chat-level override (`Chat.assistOverrides`) wins over the global Settings → Generation default — unset falls back to it, same precedence style as `Character.instructTemplateId`. */
function effectiveAssistFlag(chatOverride: boolean | undefined, globalDefault: boolean): boolean {
  return chatOverride ?? globalDefault
}

/** KoboldCpp's `images` field describes the current context, not per-turn — resend whatever the most recent user turn attached. */
function latestImages(history: StoredMessage[]): string[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const images = history[i].role === 'user' ? history[i].images : undefined
    if (images?.length) return images.map((dataUrl) => dataUrl.slice(dataUrl.indexOf(',') + 1))
  }
  return []
}

function getUnlockedExpressionIds(character: Character, affection: number): string[] {
  const spriteIds = Object.keys(character.sprites ?? {})
  if (spriteIds.length === 0) return DEFAULT_EXPRESSION_IDS
  const unlocks = character.spriteUnlocks ?? {}
  const unlocked = spriteIds.filter((id) => affection >= Number(unlocks[id] ?? 0))
  return unlocked.length ? unlocked : ['neutral']
}

function getUnlockedBackgroundIds(world: WorldCard | undefined, affection: number): string[] {
  const ids = Object.keys(world?.backgrounds ?? {})
  if (ids.length === 0) return DEFAULT_BACKGROUND_IDS
  const unlocks = world?.backgroundUnlocks ?? {}
  const unlocked = ids.filter((id) => affection >= Number(unlocks[id] ?? 0))
  return unlocked.length ? unlocked : DEFAULT_BACKGROUND_IDS
}

/**
 * Fires the player-facing toast for a warmth-band crossing (10c's "Milestones" — the banner half;
 * a next-morning text and a social-circle ripple stay open, both needing machinery this doesn't
 * have yet) and, new here, records it as a `ChatFact` "keepsake memory" — so the model actually
 * knows the relationship deepened rather than only the unlock gates silently changing underneath
 * it. Reuses the exact same synthetic-lorebook plumbing every other fact already rides through.
 */
function announceMilestone(opts: {
  charName: string
  personaName: string
  chatId: string
  previousStage: RelationshipStage
  relationshipStage: RelationshipStage
  sourceMessageId?: string
}): void {
  if (!crossedMilestone(opts.previousStage, opts.relationshipStage)) return
  const label = formatRelationshipStage(opts.relationshipStage)
  toastSuccess(`${opts.charName}'s relationship with you is now "${label}"`, { chime: true })
  chatFactsApi
    .create({
      chatId: opts.chatId,
      text: `${opts.personaName} and ${opts.charName}'s relationship recently deepened to "${label}."`,
      sourceMessageId: opts.sourceMessageId,
    })
    .catch(() => {})
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
function buildGiftTasteNote(character: Character): string | undefined {
  const { giftLikes, giftDislikes, loveLanguage } = character
  const parts: string[] = []
  if (loveLanguage?.trim()) parts.push(`feels most loved through ${loveLanguage.trim()}`)
  if (giftLikes?.length) parts.push(`tends to genuinely love gifts like ${giftLikes.join(', ')}`)
  if (giftDislikes?.length) parts.push(`isn't really moved by gifts like ${giftDislikes.join(', ')}`)
  if (parts.length === 0) return undefined
  return `${character.card.name} ${parts.join('; ')}. React to any gift given accordingly, in character, without reciting this as a checklist.`
}


function buildRelationshipDescription(
  chat: Pick<Chat, 'affection' | 'relationshipStats' | 'commitmentStatus' | 'relationshipWarning' | 'breakupCount'>,
  world: WorldCard | undefined,
  character: Character,
): string | undefined {
  if (chat.affection === undefined) return undefined
  const primaryName = character.card.name
  const stats = getRelationshipStats(chat)
  const stage = relationshipStageForWarmth(computeWarmth(chat.affection, stats), relationshipMilestonesFor(world?.relationshipThresholds))
  const notes: string[] = []
  if (stats.trust >= 70) notes.push('a deep mutual trust has built up')
  if (stats.chemistry >= 70) notes.push('there is a strong romantic spark')
  if (stats.tension >= 60) notes.push('real unresolved tension between them')
  if (stats.comfort <= 20 && stage !== 'near_strangers') notes.push('things still feel a little unsettled between them')
  const giftTasteNote = buildGiftTasteNote(character)
  // Only stated when there's an actual explicit status (10c's DTR ladder) — an unset/'none'
  // commitment is the ordinary default for most chats and isn't worth a line every single turn.
  const commitmentNote =
    chat.commitmentStatus && chat.commitmentStatus !== 'none'
      ? `{{user}} and ${primaryName} are officially ${formatCommitmentStatus(chat.commitmentStatus)}.`
      : undefined
  // 10c's "Breakups & reconciliation" — a standing warning is the model's cue to actually play the
  // strain, not just have the numbers move; a past breakup colors things even once patched up.
  const warningNote = chat.relationshipWarning
    ? `The relationship is genuinely on the rocks right now (${chat.relationshipWarning.reason}). Let that show; don't just narrate past it.`
    : undefined
  const breakupNote =
    chat.breakupCount && chat.breakupCount > 0
      ? `${primaryName} and {{user}} have broken up before. Some caution or guardedness is earned here, whether or not that's fully behind them now.`
      : undefined
  // `primaryName` is spelled out rather than left as a `{{char}}` macro — this stays about the
  // scene's primary/relationship-tracked character even in a group chat, where `{{char}}` would
  // otherwise resolve to whoever's currently speaking instead (see resolveSpeaker/buildCurrentPrompt).
  return [
    `Relationship: {{user}} and ${primaryName} are at the "${formatRelationshipStage(stage)}" stage${notes.length ? `: ${notes.join('; ')}` : ''}.`,
    '(Let this colour tone, warmth, and what feels earned right now. Never state a number, "affection", or "stage" out loud.)',
    commitmentNote,
    warningNote,
    breakupNote,
    giftTasteNote,
  ]
    .filter(Boolean)
    .join('\n')
}

function sanitizeSceneTag(
  scene: SceneTag | undefined,
  unlockedExpressions: string[],
  unlockedBackgrounds: string[],
): SceneTag | undefined {
  if (!scene) return undefined
  const cleaned: SceneTag = {}
  if (scene.expression && unlockedExpressions.includes(scene.expression)) cleaned.expression = scene.expression
  if (scene.background && unlockedBackgrounds.includes(scene.background)) cleaned.background = scene.background
  // Mood isn't unlock-gated (music isn't affection-locked), just checked against the known set.
  if (scene.mood && SCENE_MOOD_IDS.includes(scene.mood)) cleaned.mood = scene.mood
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
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const sampler = useSettingsStore((s) => s.sampler)
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
  const globalSystemPrompt = useSettingsStore((s) => s.systemPrompt)
  const globalPostHistory = useSettingsStore((s) => s.postHistoryInstructions)
  const promptSections = useSettingsStore((s) => s.promptSections)
  const setActiveChatId = useSettingsStore((s) => s.setActiveChatId)
  const client = useMemo(() => new KoboldClient(baseUrl), [baseUrl])
  const customInstructTemplates = useApiQuery('instruct-templates', () => instructTemplatesApi.list(), []) ?? []

  const chat = useApiQuery('chats', () => (chatId ? chatsApi.get(chatId) : Promise.resolve(undefined)), [chatId])
  const character = useApiQuery(
    'characters',
    () => (chat ? charactersApi.get(chat.characterId) : Promise.resolve(undefined)),
    [chat?.characterId],
  )
  // A character's own override wins over the global Settings -> Generation default; empty/unset falls back.
  const template = resolveInstructTemplate(character?.instructTemplateId || instructTemplateId, customInstructTemplates)
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
  // Who a freshly-sent user message's reply gets generated as — null/primary for every ordinary
  // chat. Only meaningful when `chat.participants` is non-empty (group chats); manual, not
  // AI-directed, by design (see ROADMAP.md's group-chat scope notes).
  const [replyAsCharacterId, setReplyAsCharacterId] = useState<string | null>(null)
  useEffect(() => {
    setReplyAsCharacterId(null)
  }, [chatId])

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
  const assistActivity = ['relationship', 'choices', 'tasks', 'summary']
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
      opts?: { continueLastTurn?: boolean; impersonateAsUser?: boolean; speakerId?: string | null },
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
      const worldDescription = world
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
            freshChat.activeEvent?.title
              ? `Current event: ${freshChat.activeEvent.title}${freshChat.activeEvent.description ? `. ${freshChat.activeEvent.description}` : ''}`
              : '',
          ]
            .filter(Boolean)
            .join('\n')
        : undefined

      // Messages already folded into chat.summary are represented there, not sent verbatim.
      const cutoff = freshChat.summaryUpToTimestamp ?? 0
      const createdAtById = new Map(messages.map((m) => [m.id, m.createdAt]))
      const recentHistory = cutoff
        ? historyForPrompt.filter((m) => (createdAtById.get(m.id) ?? Infinity) > cutoff)
        : historyForPrompt

      const pendingTasks = activeObjective?.tasks.filter((t) => t.status === 'pending') ?? []
      const objectiveForPrompt =
        activeObjective && pendingTasks.length > 0
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
        effectiveAssistFlag(freshChat.assistOverrides?.autoTrackRelationship, autoTrackRelationship) && speaker.id === character.id
          ? buildRelationshipDescription(freshChat, world, character)
          : undefined
      const styleGuidance =
        [
          avoidEmDashes ? 'Never use em dashes (the — character) in your writing. Use a comma, period, or parentheses instead.' : '',
          slowBurnPacing
            ? "Pace intimacy like a slow burn. Earn it through many small moments; don't grant it just because it was asked for. If pushed toward more affection, a kiss, or closeness faster than the relationship has earned, react the way your character actually would. Hesitation, deflection, or a flat no are often the right call, especially early on. Don't cave just to be agreeable."
            : '',
          styleGuidanceNote.trim(),
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

  /** Fire-and-forget: checks whether the reply that just landed accomplished any pending objective tasks. */
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
      const completedIds = new Set(completedIndices.map((i) => pending[i].id))
      const now = Date.now()
      const updatedTasks = objective.tasks.map((t) =>
        completedIds.has(t.id) ? { ...t, status: 'done' as const, completedAt: now } : t,
      )
      await objectivesApi.update(objective.id, { tasks: updatedTasks })
    },
    [client],
  )

  const updateAffectionFromReply = useCallback(
    async (chatIdForRelationship: string, history: ChatMessage[], latestReply: string) => {
      if (!character) return
      const freshChat = await chatsApi.get(chatIdForRelationship)
      if (!freshChat) return
      const currentAffection = freshChat.affection ?? 0
      const currentStats = getRelationshipStats(freshChat)
      const existingFlags = new Set((freshChat.sceneFlags ?? []) as SceneFlag[])
      const { deltas: rawDeltas, newFlags, reason, newFacts } = await assessRelationshipMoment(client, {
        history,
        latestReply,
        charName: character.card.name,
        userName: persona?.name || 'You',
        current: { affection: currentAffection, ...currentStats },
        knownFacts: activeFacts.map((f) => f.text),
        customFlags: world?.customSceneFlags,
      })
      const deltas = scaleDeltasForDifficulty(rawDeltas, relationshipDifficulty)
      newFlags.forEach((flag) => existingFlags.add(flag))
      if (newFacts.length > 0) {
        const sourceMessageId = history[history.length - 1]?.id
        for (const text of newFacts) {
          chatFactsApi.create({ chatId: chatIdForRelationship, text, sourceMessageId }).catch(() => {})
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
      // Endings unlock deterministically off the stage itself, not the AI CG-matching pass below —
      // excluded from `lockedGallery` so they're never sent to `detectGalleryUnlocks`.
      unlockedEndingIds(character.gallery, relationshipStage, unlockedSet).forEach((id) => unlockedSet.add(id))
      const lockedGallery = (character.gallery ?? []).filter(
        (g) => !g.isEnding && !unlockedSet.has(g.id) && hasRequiredFlags(g.requiredFlags, existingFlags),
      )
      if (lockedGallery.length > 0) {
        const unlockedIds = await detectGalleryUnlocks(client, {
          character,
          locked: lockedGallery,
          affection,
          latestReply,
        })
        unlockedIds.forEach((id) => unlockedSet.add(id))
      }
      const nextCoins = Math.max(0, (freshChat.giftCoins ?? 0) + 2)
      const noStatChange = Object.values(deltas).every((d) => d === 0)
      const noRiskChange = !risk.warnedJustNow && !risk.brokeUpJustNow && !risk.clearedJustNow
      if (
        noStatChange &&
        noRiskChange &&
        newFlags.length === 0 &&
        unlockedSet.size === (freshChat.unlockedGalleryIds ?? []).length &&
        nextCoins === (freshChat.giftCoins ?? 0)
      ) {
        return
      }
      await chatsApi.update(chatIdForRelationship, {
        affection,
        relationshipStats: nextStats,
        relationshipStage,
        sceneFlags: [...existingFlags],
        giftCoins: nextCoins,
        unlockedGalleryIds: [...unlockedSet],
        commitmentStatus: risk.commitmentStatus,
        relationshipWarning: risk.relationshipWarning ?? null,
        breakupCount: risk.breakupCount,
      })
      // Append-only history alongside the overwritten running totals above — answers "why is
      // trust 62 now" instead of only ever showing the current number. Only log when a dimension
      // or flag genuinely moved; gallery/coin bookkeeping alone isn't relationship movement.
      if (!noStatChange || newFlags.length > 0) {
        const changedDeltas = Object.fromEntries(Object.entries(deltas).filter(([, v]) => v !== 0))
        relationshipEventsApi
          .create({
            chatId: chatIdForRelationship,
            reason: reason ?? 'The relationship shifted during this exchange',
            deltas: changedDeltas,
            newFlags: newFlags.length ? newFlags : undefined,
            sourceMessageId: history[history.length - 1]?.id,
          })
          .catch(() => {})
      }
      // Quiet, player-facing rewards — these are milestones worth surfacing, unlike the raw
      // scene flags (internal bookkeeping) or per-turn stat deltas (would be constant noise).
      announceMilestone({
        charName: character.card.name,
        personaName: persona?.name || 'You',
        chatId: chatIdForRelationship,
        previousStage,
        relationshipStage,
        sourceMessageId: history[history.length - 1]?.id,
      })
      for (const id of unlockedSet) {
        if (previouslyUnlockedIds.has(id)) continue
        const entry = character.gallery?.find((g) => g.id === id)
        toastSuccess(entry?.isEnding ? `An ending unlocked: ${entry.title}` : `New gallery scene unlocked: ${entry?.title ?? 'untitled'}`, { chime: true })
      }
    },
    [activeFacts, character, client, persona?.name, relationshipDifficulty, world],
  )

  const buyGift = useCallback(
    async (giftId: string) => {
      if (!chatId) return
      const item = giftById(giftId, world)
      if (!item) return
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
    },
    [chatId, world],
  )

  const buyItem = useCallback(
    async (itemId: string) => {
      if (!chatId) return
      const def = itemById(itemId, world)
      if (!def) return
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
    },
    [character, chatId, world],
  )

  /**
   * A single Define-the-Relationship ask (10c) — whichever tier the button offers is already
   * gated on warmth by the caller (`RelationshipPanel`'s `canAskForCommitment`), so this only ever
   * needs to judge how the character actually reacts to being asked right now.
   */
  const askForCommitment = useCallback(
    async (tier: Exclude<CommitmentStatus, 'none'>) => {
      if (!chatId || !character) return
      const freshChat = await chatsApi.get(chatId)
      if (!freshChat) return
      const currentStatus = freshChat.commitmentStatus ?? 'none'
      const currentStats = getRelationshipStats(freshChat)
      const currentAffection = freshChat.affection ?? 0
      const historyForAssist: ChatMessage[] = messages.map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
      let outcome
      try {
        outcome = await assessCommitmentAsk(client, {
          history: historyForAssist,
          charName: character.card.name,
          charPersonality: character.card.personality,
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
        charName: character.card.name,
        commitmentStatus: statusAfterAsk,
        stats: nextStats,
        existingWarning: freshChat.relationshipWarning,
        breakupCount: freshChat.breakupCount ?? 0,
      })
      nextStats = risk.stats
      const warmth = computeWarmth(affection, nextStats)
      const relationshipStage = relationshipStageForWarmth(warmth, milestones)

      await chatsApi.update(chatId, {
        affection,
        relationshipStats: nextStats,
        relationshipStage,
        commitmentStatus: risk.commitmentStatus,
        relationshipWarning: risk.relationshipWarning ?? null,
        breakupCount: risk.breakupCount,
      })

      const changedDeltas = Object.fromEntries(Object.entries(deltas).filter(([, v]) => v !== 0))
      relationshipEventsApi
        .create({
          chatId,
          reason: `Asked to be ${formatCommitmentStatus(tier)}: ${outcome.reason}`,
          deltas: changedDeltas,
          sourceMessageId: messages[messages.length - 1]?.id,
        })
        .catch(() => {})

      if (outcome.decision === 'accept') {
        toastSuccess(`${character.card.name} said yes — you're ${formatCommitmentStatus(tier)} now. ${outcome.reason}`, { chime: true })
        chatFactsApi
          .create({
            chatId,
            text: `${persona?.name || 'You'} and ${character.card.name} are officially ${formatCommitmentStatus(tier)}.`,
          })
          .catch(() => {})
      } else if (outcome.decision === 'backfire') {
        toastError(`That didn't land well. ${outcome.reason}`)
      } else {
        toastInfo(`Not the right moment. ${outcome.reason}`)
      }
      announceMilestone({
        charName: character.card.name,
        personaName: persona?.name || 'You',
        chatId,
        previousStage,
        relationshipStage,
      })
    },
    [character, chatId, client, messages, persona?.name, relationshipDifficulty, world],
  )

  /**
   * The player deliberately ending a committed relationship (10c) — behind a confirmation in the
   * UI so a joke line can't blow one up by accident. Applies the same one-time scar a strain-driven
   * breakup does, via the shared `applyRelationshipRisk` plumbing, so a deliberate and an
   * unresolved-strain breakup leave the same kind of mark rather than two different mechanisms.
   */
  const endRelationship = useCallback(async () => {
    if (!chatId || !character) return
    const freshChat = await chatsApi.get(chatId)
    if (!freshChat || (freshChat.commitmentStatus ?? 'none') === 'none') return
    const scarredStats = applyBreakupScar(getRelationshipStats(freshChat))
    await chatsApi.update(chatId, {
      commitmentStatus: 'none',
      relationshipStats: scarredStats,
      relationshipWarning: null,
      breakupCount: (freshChat.breakupCount ?? 0) + 1,
    })
    chatFactsApi
      .create({ chatId, text: `${persona?.name || 'You'} and ${character.card.name} broke things off.` })
      .catch(() => {})
    toastInfo(`You and ${character.card.name} are no longer together.`)
  }, [character, chatId, persona?.name])

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

  const runGeneration = useCallback(
    async (
      historyForPrompt: ChatMessage[],
      targetMessageId: string,
      images: string[] = [],
      opts?: { continuing?: boolean; speakerId?: string | null },
    ) => {
      if (!character || !chat) return
      const { active: speaker } = resolveSpeaker(opts?.speakerId)
      if (!speaker) return
      // Relationship tracking, objective-progress-driven choices, and gift-aware choice
      // suggestions are all scoped to the primary's relationship — skip them for a turn a
      // non-primary participant spoke, rather than silently attributing their lines to it.
      const isPrimarySpeaker = speaker.id === character.id
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

      try {
        // A reply that used its entire token budget without reaching a natural stop almost
        // always means it was cut off mid-thought, not that the model happened to finish exactly
        // on the last token — auto-continue transparently rather than leaving a visibly unfinished
        // message for the user to notice and manually click "Continue" on. Capped so a model that
        // never emits a stop sequence at all can't turn one reply into an unbounded loop.
        for (let round = 0; round <= MAX_AUTO_CONTINUE_ROUNDS; round++) {
          let built = await buildCurrentPrompt(currentHistory, { continueLastTurn: continuing, speakerId: opts?.speakerId })
          if (!built) throw new Error('Could not build prompt: missing character or chat.')

          // The budget was already tight for THIS turn, not just future ones — fold the
          // overflow into the summary now and rebuild, instead of waiting until after the
          // reply lands. Keeps the roleplay going instead of silently truncating history
          // right when it matters most.
          if (autoSummarize && built.excludedMessageCount > 0) {
            await updateMemorySummary({ force: true })
            const rebuilt = await buildCurrentPrompt(currentHistory, { continueLastTurn: continuing, speakerId: opts?.speakerId })
            if (rebuilt) built = rebuilt
          }

          // The template's own turn-boundary tokens (e.g. ChatML's <|im_end|>) must reach
          // the sampler or the model has no signal to stop at its own turn — merged with
          // whatever the user additionally set in Settings, not replacing it.
          const stopSequence = [...new Set([...template.stopSequences, ...(sampler.stop_sequence ?? [])])]

          const genStartedAt = performance.now()
          let firstTokenAt: number | null = null
          let streamedTokenCount = 0
          const builtForStats = built
          let newText = ''
          try {
            newText = await client.generateStream(
              {
                ...sampler,
                stop_sequence: stopSequence,
                prompt: built.prompt,
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
              { ...sampler, stop_sequence: stopSequence, prompt: built.prompt, genkey, images: images.length ? images : undefined },
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
          const { text: extractedText, scene: parsedScene } = extractSceneTag(combinedRaw)
          combined = extractedText
          scene = sanitizeSceneTag(parsedScene, unlockedExpressions, unlockedBackgrounds)

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
              failed: false,
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
              failed: false,
            })
          }
          wroteAnything = true
          // Also rolls the sticky/cooldown bookkeeping forward for next turn (built once per round;
          // the final round's state is the one that sticks). Bumps updatedAt regardless.
          await chatsApi.update(chat.id, { worldInfoState: built.worldInfoState ?? {} })

          // Stopping the generation by hand (or the model genuinely finishing early) both mean
          // "don't keep going" regardless of how close to the token cap it landed.
          const generatedTokens = !abort.signal.aborted && newText.trim() ? await countTokens(newText) : 0
          const looksTruncated = !abort.signal.aborted && generatedTokens >= sampler.max_length - 1
          if (!looksTruncated || round === MAX_AUTO_CONTINUE_ROUNDS) break

          continuing = true
          accumulated = combined
          currentHistory =
            round === 0
              ? [...historyForPrompt, { id: targetMessageId, role: 'char' as const, name: speaker.card.name, text: combined }]
              : [...currentHistory.slice(0, -1), { ...currentHistory[currentHistory.length - 1], text: combined }]
        }

        // Post-reply assists. Each is fire-and-forget (never blocks the reply that just landed) but
        // routed through `runAssist` so the chat can show which ones are still running — on a local
        // single-GPU server they queue up on the model, and their results otherwise appear with no
        // warning that they were coming.
        const relationshipHistory = wasOriginallyContinuing
          ? [...historyForPrompt.slice(0, -1), { id: targetMessageId, role: 'char' as const, name: speaker.card.name, text: combined }]
          : [...historyForPrompt, { id: targetMessageId, role: 'char' as const, name: speaker.card.name, text: combined }]
        // A live, scored date (10b) suppresses the normal per-turn drip-feed — its outcome is
        // resolved once, at the end, by endDateEvent's own assessDateOutcome pass instead.
        const inLiveDate = chat.activeEvent?.kind === 'date' && !!chat.activeEvent.startedAt

        if (effectiveAssistFlag(chat.assistOverrides?.autoTrackRelationship, autoTrackRelationship) && isPrimarySpeaker && !inLiveDate) {
          runAssist('relationship', 'Updating relationship', () =>
            updateAffectionFromReply(chat.id, relationshipHistory, combined),
          )
        }
        if (effectiveAssistFlag(chat.assistOverrides?.autoSuggestChoices, autoSuggestChoices) && isPrimarySpeaker) {
          runAssist('choices', 'Suggesting replies', () => suggestChoicesForMessage(targetMessageId, relationshipHistory))
        }
        if (autoDetectTasks) {
          runAssist('tasks', 'Checking objective', () => detectAndMarkTasks(chat.id, combined))
        }
        if (autoSummarize) {
          runAssist('summary', 'Updating memory', () => updateMemorySummary())
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
      resolveSpeaker,
      runAssist,
      sampler,
      suggestChoicesForMessage,
      template,
      updateAffectionFromReply,
      updateMemorySummary,
    ],
  )

  const sendUserMessage = useCallback(
    async (text: string, attachments: PendingAttachment[] = [], opts?: { choice?: ChoiceOption }) => {
      if (!chatId || isGenerating) return
      let giftId: string | undefined
      if (opts?.choice?.kind === 'gift' && opts.choice.giftId) {
        const freshChat = await chatsApi.get(chatId)
        if (!freshChat) return
        const inventory = { ...(freshChat.giftInventory ?? defaultGiftInventory(world)) }
        const inStock = inventory[opts.choice.giftId] ?? 0
        if (inStock <= 0) {
          toastError('That gift is out of stock. Buy another from the relationship panel.')
          return
        }
        inventory[opts.choice.giftId] = inStock - 1
        if (inventory[opts.choice.giftId] <= 0) delete inventory[opts.choice.giftId]
        const gift = giftById(opts.choice.giftId, world)
        const preferenceScore = Math.max(-2, Math.min(3, Number(character?.giftPreferences?.[opts.choice.giftId] ?? 0)))
        const giftDelta = Math.round(giftImpactBase(opts.choice.giftId, world) + preferenceScore)
        const affection = clampAffection((freshChat.affection ?? 0) + giftDelta)
        const warmth = computeWarmth(affection, getRelationshipStats(freshChat))
        const giftsGiven = { ...(freshChat.giftsGiven ?? {}) }
        giftsGiven[opts.choice.giftId] = (giftsGiven[opts.choice.giftId] ?? 0) + 1
        await chatsApi.update(chatId, {
          affection,
          relationshipStage: relationshipStageForWarmth(warmth, relationshipMilestonesFor(world?.relationshipThresholds)),
          giftInventory: inventory,
          giftsGiven,
        })
        giftId = opts.choice.giftId
        if (gift) {
          text = `*I give ${character?.card.name ?? 'you'} ${gift.name}.* ${text}`
        }
      }
      const composedText = composeMessageText(text, attachments).trim()
      const apiImages = collectImageBase64(attachments)
      if (!composedText && apiImages.length === 0) return
      if (!reducedAudio) playSendBlip()

      // Stored as full data: URLs (renderable as-is); the API only ever sees the base64 payload.
      const storedImages = attachments.filter((a) => a.kind === 'image').map((a) => a.dataUrl)

      const now = Date.now()
      const userMsg: StoredMessage = {
        id: newId(),
        chatId,
        role: 'user',
        name: persona?.name || 'You',
        text: composedText,
        giftId,
        images: storedImages.length ? storedImages : undefined,
        createdAt: now,
      }
      await messagesApi.create(userMsg)

      // createdAt is offset by 1ms and sent explicitly so this reply always sorts after the
      // user's turn even though both are created in the same synchronous burst. `replyAsCharacterId`
      // only ever differs from the primary in a group chat — every ordinary chat leaves it null.
      const { active: speaker } = resolveSpeaker(replyAsCharacterId)
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
      await runGeneration(historyForPrompt, charMsg.id, apiImages, { speakerId: replyAsCharacterId })
    },
    [character, chatId, isGenerating, messages, persona, reducedAudio, replyAsCharacterId, resolveSpeaker, runGeneration, world],
  )

  const regenerate = useCallback(
    async (messageId: string) => {
      if (isGenerating) return
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return
      const priorMessages = messages.slice(0, idx)
      const historyForPrompt: ChatMessage[] = priorMessages.map((m) => ({
        id: m.id,
        role: m.role,
        name: m.name,
        text: m.text,
      }))
      await messagesApi.update(messageId, { text: '', failed: false })
      // Regenerating keeps whoever originally said it, rather than letting a regenerate silently
      // switch the speaker — that's a distinct, explicit action (editing the message).
      await runGeneration(historyForPrompt, messageId, latestImages(priorMessages), { speakerId: messages[idx].speakerId })
    },
    [isGenerating, messages, runGeneration],
  )

  const swipe = useCallback(
    async (messageId: string, direction: 'left' | 'right') => {
      const msg = messages.find((m) => m.id === messageId)
      if (!msg) return
      const swipes = msg.swipes ?? [msg.text]
      const current = msg.activeSwipe ?? 0
      if (direction === 'right' && current === swipes.length - 1) {
        if (isGenerating) return
        // generate a brand new swipe
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
        })
        await runGeneration(historyForPrompt, messageId, latestImages(priorMessages), { speakerId: msg.speakerId })
        return
      }
      const nextIndex = direction === 'left' ? Math.max(0, current - 1) : Math.min(swipes.length - 1, current + 1)
      await messagesApi.update(messageId, {
        activeSwipe: nextIndex,
        text: swipes[nextIndex],
        scene: msg.swipeScenes?.[nextIndex],
        rawText: msg.swipeRawTexts?.[nextIndex],
      })
    },
    [isGenerating, messages, runGeneration],
  )

  const continueMessage = useCallback(async () => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'char' || !last.text.trim() || isGenerating) return
    const historyForPrompt: ChatMessage[] = messages.map((m) => ({
      id: m.id,
      role: m.role,
      name: m.name,
      text: m.text,
    }))
    await runGeneration(historyForPrompt, last.id, latestImages(messages), { continuing: true, speakerId: last.speakerId })
  }, [isGenerating, messages, runGeneration])

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
    const text = await client.generate({ ...sampler, prompt: built.prompt, genkey: makeGenKey() })
    return text.trim()
  }, [buildCurrentPrompt, character, chat, client, messages, sampler])

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
    })
  }, [character, chat, client, persona?.name, world])

  /**
   * Starting a `kind: 'date'` card spends one of the world's daily actions (10a's "Energy/action
   * economy") — gift/milestone cards aren't a "spend a chunk of the day doing something" activity
   * the way a date is, so they're left free. No world assigned to this character means no clock
   * to spend against, so energy simply doesn't apply (unlimited, same as before this existed).
   */
  const startDateEvent = useCallback(
    async (event: DateEventCard) => {
      if (!chatId || !event.title.trim() || !event.objectiveTitle.trim()) return
      if (event.kind === 'date' && world) {
        const freshWorld = await worldsApi.get(world.id)
        const day = freshWorld?.currentDay ?? 0
        const phaseIndex = freshWorld?.currentPhaseIndex ?? 0
        if (getEnergyRemaining(day, phaseIndex) <= 0) {
          toastError("No energy left today — get some rest before starting another date.")
          return
        }
        const result = spendEnergy(day, phaseIndex)
        await worldsApi.update(world.id, { currentDay: result.day, currentPhaseIndex: result.phaseIndex })
        if (result.slept) {
          const weather = getWeather(world.id, result.day)
          toastSuccess(`Tired after a full day, you call it a night. A new morning dawns — ${describeWeather(weather)}.`)
        }
      }
      await createObjective(event.objectiveTitle, event.objectiveDescription ?? event.description ?? '', 'ai')
      // Stamped on every event regardless of kind — harmless metadata for gift/milestone cards,
      // which never read it — but for a `kind: 'date'` card its presence is what marks this as a
      // live, scored date (10b) rather than the original lightweight event-card flow, and its
      // value is the cutoff `endDateEvent` uses to gather this date's own transcript.
      await chatsApi.update(chatId, { activeEvent: { ...event, startedAt: Date.now() } })
    },
    [chatId, createObjective, world],
  )

  /**
   * Ends an active `kind: 'date'` event with a single validated judge pass over the whole scene's
   * transcript (10b's "save-safe end-of-date scoring") rather than the per-turn drip-feed ordinary
   * chat gets — see `assessDateOutcome`. A date with no messages since it started just closes
   * quietly, no judge call and no relationship movement: starting a date and never speaking
   * shouldn't count for or against anything.
   */
  const endDateEvent = useCallback(async () => {
    if (!chatId || !character) return
    const freshChat = await chatsApi.get(chatId)
    const event = freshChat?.activeEvent
    if (!freshChat || !event?.startedAt) return
    const startedAt = event.startedAt

    const closeOutEvent = async () => {
      // `null`, not `undefined` — see the note on the other clearing call site above.
      await chatsApi.update(chatId, { activeEvent: null })
      if (activeObjective) await objectivesApi.update(activeObjective.id, { status: 'completed' })
    }

    const transcript: ChatMessage[] = messages
      .filter((m) => m.createdAt >= startedAt && m.text.trim())
      .map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
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
    })
    const deltas = scaleDeltasForDifficulty(outcome.deltas, relationshipDifficulty)
    outcome.newFlags.forEach((flag) => existingFlags.add(flag))
    if (outcome.newFacts.length > 0) {
      const sourceMessageId = transcript[transcript.length - 1]?.id
      for (const text of outcome.newFacts) {
        chatFactsApi.create({ chatId, text, sourceMessageId }).catch(() => {})
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
    const coinsEarned = Math.max(0, Math.round(deltas.affection * 2))
    const nextCoins = (freshChat.giftCoins ?? 0) + coinsEarned

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

    toastSuccess(outcome.recap)
    if (coinsEarned > 0) toastSuccess(`Earned ${coinsEarned} coins from the date`)
    announceMilestone({
      charName: character.card.name,
      personaName: persona?.name || 'You',
      chatId,
      previousStage,
      relationshipStage,
      sourceMessageId: transcript[transcript.length - 1]?.id,
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
    await messagesApi.update(messageId, { text, swipes })
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
    swipe,
    editMessage,
    deleteMessage,
    rewindToMessage,
    togglePinMessage,
    abortGeneration,
    previewPrompt,
    updateAuthorNote,
    updateMemorySummary,
    continueMessage,
    canContinue,
    impersonate,
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
    useItem,
    askForCommitment,
    endRelationship,
    forkChat,
    client,
  }
}
