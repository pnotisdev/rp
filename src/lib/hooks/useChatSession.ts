import { useCallback, useMemo, useRef, useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi, messagesApi, objectivesApi, personasApi, worldInfoBooksApi, worldsApi } from '@/lib/api/client'
import { newId } from '@/lib/id'
import type { DateEventCard, ObjectiveTask, StoredMessage, WorldCard } from '@/lib/types'
import { collectImageBase64, composeMessageText, type PendingAttachment } from '@/lib/attachments'
import { KoboldClient, makeGenKey } from '@/lib/api/kobold'
import { buildPrompt, estimateTokens, type ChatMessage } from '@/lib/prompt/builder'
import { SUMMARY_MAX_LENGTH, summarizeMessages } from '@/lib/prompt/summarize'
import { generateChoices } from '@/lib/prompt/choices'
import { detectCompletedTasks, generateTasks, suggestObjective } from '@/lib/objectives/objectiveAssist'
import { assessRelationshipDeltas, detectGalleryUnlocks, detectSceneFlags, suggestDateEvent } from '@/lib/dating/relationshipAssist'
import {
  clampAffection,
  clampStat,
  computeWarmth,
  getRelationshipStats,
  RELATIONSHIP_DIMENSIONS,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import { defaultGiftInventory, getGiftCatalog, giftById, giftImpactBase } from '@/lib/dating/gifts'
import { getInstructTemplate } from '@/lib/prompt/instructTemplates'
import { extractSceneTag, stripSceneTagForDisplay, type SceneTag } from '@/lib/vn/sceneTag'
import { DEFAULT_EXPRESSION_IDS } from '@/lib/vn/expressions'
import { DEFAULT_BACKGROUND_IDS } from '@/lib/vn/backgrounds'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import type { Character } from '@/lib/characters/cardSpec'
import type { ChoiceOption, RelationshipDimension, SceneFlag } from '@/lib/types'

/** Minimum number of newly-eligible messages before auto-summarize bothers running (avoids a summarization call on every single turn). */
const MIN_BATCH_FOR_AUTO_SUMMARY = 6

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

function sanitizeSceneTag(
  scene: SceneTag | undefined,
  unlockedExpressions: string[],
  unlockedBackgrounds: string[],
): SceneTag | undefined {
  if (!scene) return undefined
  const cleaned: SceneTag = {}
  if (scene.expression && unlockedExpressions.includes(scene.expression)) cleaned.expression = scene.expression
  if (scene.background && unlockedBackgrounds.includes(scene.background)) cleaned.background = scene.background
  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

function hasRequiredFlags(required: string[] | undefined, flags: Set<SceneFlag>): boolean {
  if (!required?.length) return true
  return required.every((f) => flags.has(f as SceneFlag))
}

export function useChatSession(chatId: string | null) {
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const sampler = useSettingsStore((s) => s.sampler)
  const instructTemplateId = useSettingsStore((s) => s.instructTemplateId)
  const autoSummarize = useSettingsStore((s) => s.autoSummarize)
  const keepRecentMessages = useSettingsStore((s) => s.keepRecentMessages)
  const summaryDetail = useSettingsStore((s) => s.summaryDetail)
  const autoDetectTasks = useSettingsStore((s) => s.autoDetectTasks)
  const autoSuggestChoices = useSettingsStore((s) => s.autoSuggestChoices)
  const setActiveChatId = useSettingsStore((s) => s.setActiveChatId)
  const client = useMemo(() => new KoboldClient(baseUrl), [baseUrl])
  const template = getInstructTemplate(instructTemplateId)

  const chat = useApiQuery('chats', () => (chatId ? chatsApi.get(chatId) : Promise.resolve(undefined)), [chatId])
  const character = useApiQuery(
    'characters',
    () => (chat ? charactersApi.get(chat.characterId) : Promise.resolve(undefined)),
    [chat?.characterId],
  )
  const persona = useApiQuery(
    'personas',
    () => (chat ? personasApi.get(chat.personaId) : Promise.resolve(undefined)),
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
  const activeObjective = useApiQuery(
    'objectives',
    () => (chatId ? objectivesApi.getActive(chatId) : Promise.resolve(undefined)),
    [chatId],
  )

  const [isGenerating, setIsGenerating] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [generatingMessageId, setGeneratingMessageId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const genKeyRef = useRef<string>('')
  const summarizingRef = useRef(false)

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
      opts?: { continueLastTurn?: boolean; impersonateAsUser?: boolean },
    ) => {
      if (!character || !chat) return null
      // Read the chat record fresh rather than trusting the reactive `chat` closure, which can
      // be one render behind a summary update that just landed (this fn may be called in the
      // same tick as that write, before useApiQuery's subscription has re-rendered us).
      const freshChat = (await chatsApi.get(chat.id)) ?? chat
      const lorebooks = character.card.character_book ? [character.card.character_book] : []
      const boundBooks = worldInfoBooks
        .filter((b) => b.boundChatIds.length === 0 || b.boundChatIds.includes(freshChat.id))
        .map((b) => b.book)
      const worldLorebook = world?.lorebook ? [world.lorebook] : []
      const affection = freshChat.affection ?? 0
      const worldDescription = world
        ? [
            world.description?.trim(),
            world.rules?.trim() ? `World rules: ${world.rules.trim()}` : '',
            freshChat.activeEvent?.title
              ? `Current event: ${freshChat.activeEvent.title}${freshChat.activeEvent.description ? ` — ${freshChat.activeEvent.description}` : ''}`
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

      const contextBudget = sampler.max_context_length - sampler.max_length - 32
      return buildPrompt({
        character: character.card,
        personaName: persona?.name || 'You',
        personaDescription: persona?.description || '',
        history: recentHistory,
        chatSummary: freshChat.summary,
        worldDescription,
        lorebooks: [...worldLorebook, ...lorebooks, ...boundBooks],
        template,
        contextBudget: Math.max(contextBudget, 256),
        scanDepth: 8,
        countTokens,
        continueLastTurn: opts?.continueLastTurn,
        impersonateAsUser: opts?.impersonateAsUser,
        activeObjective: objectiveForPrompt,
        sceneOptions: {
          expressionIds: getUnlockedExpressionIds(character, affection),
          backgroundIds: getUnlockedBackgroundIds(world, affection),
        },
        affection,
      })
    },
    [activeObjective, character, chat, countTokens, messages, persona, sampler, template, world, worldInfoBooks],
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
      const deltas = await assessRelationshipDeltas(client, {
        history,
        latestReply,
        charName: character.card.name,
        userName: persona?.name || 'You',
        current: { affection: currentAffection, ...currentStats },
      })
      const newFlags = await detectSceneFlags(client, {
        history,
        latestReply,
        charName: character.card.name,
        userName: persona?.name || 'You',
      })
      newFlags.forEach((flag) => existingFlags.add(flag))
      const affection = clampAffection(currentAffection + deltas.affection)
      const nextStats = { ...currentStats }
      for (const dim of RELATIONSHIP_DIMENSIONS) nextStats[dim] = clampStat(currentStats[dim] + deltas[dim])
      const warmth = computeWarmth(affection, nextStats)
      const relationshipStage = relationshipStageForWarmth(warmth, relationshipMilestonesFor(world?.relationshipThresholds))
      const unlockedSet = new Set(freshChat.unlockedGalleryIds ?? [])
      const lockedGallery = (character.gallery ?? []).filter(
        (g) => !unlockedSet.has(g.id) && hasRequiredFlags(g.requiredFlags, existingFlags),
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
      if (noStatChange && newFlags.length === 0 && unlockedSet.size === (freshChat.unlockedGalleryIds ?? []).length && nextCoins === (freshChat.giftCoins ?? 0)) {
        return
      }
      await chatsApi.update(chatIdForRelationship, {
        affection,
        relationshipStats: nextStats,
        relationshipStage,
        sceneFlags: [...existingFlags],
        giftCoins: nextCoins,
        unlockedGalleryIds: [...unlockedSet],
      })
    },
    [character, client, persona?.name, world],
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

  const previewPrompt = useCallback(async () => {
    const historyForPrompt: ChatMessage[] = messages.map((m) => ({
      id: m.id,
      role: m.role,
      name: m.name,
      text: m.text,
    }))
    return buildCurrentPrompt(historyForPrompt)
  }, [buildCurrentPrompt, messages])

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
      opts?: { continuing?: boolean },
    ) => {
      if (!character || !chat) return
      const continuing = !!opts?.continuing
      const existingText = continuing ? (historyForPrompt[historyForPrompt.length - 1]?.text ?? '') : ''
      setIsGenerating(true)
      setStreamingText(existingText)
      setGeneratingMessageId(targetMessageId)
      const genkey = makeGenKey()
      genKeyRef.current = genkey
      const abort = new AbortController()
      abortRef.current = abort

      try {
        let built = await buildCurrentPrompt(historyForPrompt, { continueLastTurn: continuing })
        if (!built) throw new Error('Could not build prompt: missing character or chat.')

        // The budget was already tight for THIS turn, not just future ones — fold the
        // overflow into the summary now and rebuild, instead of waiting until after the
        // reply lands. Keeps the roleplay going instead of silently truncating history
        // right when it matters most.
        if (autoSummarize && built.excludedMessageCount > 0) {
          await updateMemorySummary({ force: true })
          const rebuilt = await buildCurrentPrompt(historyForPrompt, { continueLastTurn: continuing })
          if (rebuilt) built = rebuilt
        }

        // The template's own turn-boundary tokens (e.g. ChatML's <|im_end|>) must reach
        // the sampler or the model has no signal to stop at its own turn — merged with
        // whatever the user additionally set in Settings, not replacing it.
        const stopSequence = [...new Set([...template.stopSequences, ...(sampler.stop_sequence ?? [])])]

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
            (_token, full) => setStreamingText(existingText + stripSceneTagForDisplay(full)),
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

        const combinedRaw = (existingText + newText).trimEnd()
        const unlockedExpressions = getUnlockedExpressionIds(character, chat.affection ?? 0)
        const unlockedBackgrounds = getUnlockedBackgroundIds(world, chat.affection ?? 0)
        const { text: combined, scene: parsedScene } = extractSceneTag(combinedRaw)
        const scene = sanitizeSceneTag(parsedScene, unlockedExpressions, unlockedBackgrounds)
        if (continuing) {
          const freshMsg = await messagesApi.get(targetMessageId)
          const swipes = freshMsg?.swipes?.length ? [...freshMsg.swipes] : [existingText]
          const activeSwipe = freshMsg?.activeSwipe ?? 0
          swipes[activeSwipe] = combined
          const swipeScenes = freshMsg?.swipeScenes ? [...freshMsg.swipeScenes] : []
          swipeScenes[activeSwipe] = scene
          await messagesApi.update(targetMessageId, {
            text: combined,
            swipes,
            swipeScenes,
            activeSwipe,
            scene,
            tokenCount: await countTokens(combined),
          })
        } else {
          const freshMsg = await messagesApi.get(targetMessageId)
          const existingSwipes = freshMsg?.swipes?.length ? [...freshMsg.swipes] : [combined]
          const activeSwipe = Math.min(freshMsg?.activeSwipe ?? 0, Math.max(0, existingSwipes.length - 1))
          existingSwipes[activeSwipe] = combined
          const swipeScenes = freshMsg?.swipeScenes ? [...freshMsg.swipeScenes] : []
          swipeScenes[activeSwipe] = scene
          await messagesApi.update(targetMessageId, {
            text: combined,
            swipes: existingSwipes,
            swipeScenes,
            activeSwipe,
            scene,
            tokenCount: await countTokens(combined),
          })
        }
        await chatsApi.update(chat.id, {}) // bumps updatedAt so the chat resorts to the top
        if (autoSummarize) {
          // Fire-and-forget: keeps long-term memory warm without blocking the reply that just landed.
          updateMemorySummary().catch(() => {})
        }
        if (autoDetectTasks) {
          detectAndMarkTasks(chat.id, combined).catch(() => {})
        }
        const relationshipHistory = continuing
          ? [...historyForPrompt.slice(0, -1), { id: targetMessageId, role: 'char' as const, name: character.card.name, text: combined }]
          : [...historyForPrompt, { id: targetMessageId, role: 'char' as const, name: character.card.name, text: combined }]
        updateAffectionFromReply(chat.id, relationshipHistory, combined).catch(() => {})
        if (autoSuggestChoices) {
          suggestChoicesForMessage(targetMessageId, relationshipHistory).catch(() => {})
        }
      } catch (e) {
        toastError(errorMessage(e))
        if (!continuing) {
          await messagesApi.update(targetMessageId, { text: '⚠ Generation failed. See notification for details.' })
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
      buildCurrentPrompt,
      character,
      chat,
      client,
      countTokens,
      detectAndMarkTasks,
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
      // user's turn even though both are created in the same synchronous burst.
      const charMsg: StoredMessage = {
        id: newId(),
        chatId,
        role: 'char',
        name: character?.card.name || 'Character',
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
      await runGeneration(historyForPrompt, charMsg.id, apiImages)
    },
    [character, chatId, isGenerating, messages, persona, runGeneration, world],
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
      await messagesApi.update(messageId, { text: '' })
      await runGeneration(historyForPrompt, messageId, latestImages(priorMessages))
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
        await runGeneration(historyForPrompt, messageId, latestImages(priorMessages))
        return
      }
      const nextIndex = direction === 'left' ? Math.max(0, current - 1) : Math.min(swipes.length - 1, current + 1)
      await messagesApi.update(messageId, {
        activeSwipe: nextIndex,
        text: swipes[nextIndex],
        scene: msg.swipeScenes?.[nextIndex],
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
    await runGeneration(historyForPrompt, last.id, latestImages(messages), { continuing: true })
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
      if (chatId) await chatsApi.update(chatId, { activeEvent: undefined })
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

  const startDateEvent = useCallback(
    async (event: DateEventCard) => {
      if (!chatId || !event.title.trim() || !event.objectiveTitle.trim()) return
      await createObjective(event.objectiveTitle, event.objectiveDescription ?? event.description ?? '', 'ai')
      await chatsApi.update(chatId, { activeEvent: event })
    },
    [chatId, createObjective],
  )

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
    messages,
    isGenerating,
    streamingText,
    generatingMessageId,
    sendUserMessage,
    regenerate,
    swipe,
    editMessage,
    deleteMessage,
    abortGeneration,
    previewPrompt,
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
    regenerateChoices,
    buyGift,
    forkChat,
    client,
  }
}
