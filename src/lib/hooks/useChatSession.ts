import { useCallback, useMemo, useRef, useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi, messagesApi, objectivesApi, personasApi, worldInfoBooksApi, worldsApi } from '@/lib/api/client'
import { newId } from '@/lib/id'
import type { ObjectiveTask, StoredMessage } from '@/lib/types'
import { collectImageBase64, composeMessageText, type PendingAttachment } from '@/lib/attachments'
import { KoboldClient, makeGenKey } from '@/lib/api/kobold'
import { buildPrompt, estimateTokens, type ChatMessage } from '@/lib/prompt/builder'
import { SUMMARY_MAX_LENGTH, summarizeMessages } from '@/lib/prompt/summarize'
import { detectCompletedTasks, generateTasks, suggestObjective } from '@/lib/objectives/objectiveAssist'
import { getInstructTemplate } from '@/lib/prompt/instructTemplates'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

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

export function useChatSession(chatId: string | null) {
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const sampler = useSettingsStore((s) => s.sampler)
  const instructTemplateId = useSettingsStore((s) => s.instructTemplateId)
  const autoSummarize = useSettingsStore((s) => s.autoSummarize)
  const keepRecentMessages = useSettingsStore((s) => s.keepRecentMessages)
  const summaryDetail = useSettingsStore((s) => s.summaryDetail)
  const autoDetectTasks = useSettingsStore((s) => s.autoDetectTasks)
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
  const [error, setError] = useState<string | null>(null)
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
      const worldDescription = world
        ? [world.description?.trim(), world.rules?.trim() ? `World rules: ${world.rules.trim()}` : '']
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

  const previewPrompt = useCallback(async () => {
    const historyForPrompt: ChatMessage[] = messages.map((m) => ({
      id: m.id,
      role: m.role,
      name: m.name,
      text: m.text,
    }))
    return buildCurrentPrompt(historyForPrompt)
  }, [buildCurrentPrompt, messages])

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
      setError(null)
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
            (_token, full) => setStreamingText(existingText + full),
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

        const combined = (existingText + newText).trimEnd()
        if (continuing) {
          const freshMsg = await messagesApi.get(targetMessageId)
          const swipes = freshMsg?.swipes?.length ? [...freshMsg.swipes] : [existingText]
          const activeSwipe = freshMsg?.activeSwipe ?? 0
          swipes[activeSwipe] = combined
          await messagesApi.update(targetMessageId, {
            text: combined,
            swipes,
            activeSwipe,
            tokenCount: await countTokens(combined),
          })
        } else {
          await messagesApi.update(targetMessageId, {
            text: combined,
            swipes: [combined],
            activeSwipe: 0,
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
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        if (!continuing) {
          await messagesApi.update(targetMessageId, { text: '⚠ Generation failed. See error banner.' })
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
      buildCurrentPrompt,
      character,
      chat,
      client,
      countTokens,
      detectAndMarkTasks,
      sampler,
      template,
      updateMemorySummary,
    ],
  )

  const sendUserMessage = useCallback(
    async (text: string, attachments: PendingAttachment[] = []) => {
      if (!chatId || isGenerating) return
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
    [character, chatId, isGenerating, messages, persona, runGeneration],
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
      await messagesApi.update(messageId, { activeSwipe: nextIndex, text: swipes[nextIndex] })
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
    },
    [activeObjective],
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
    error,
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
    client,
  }
}
