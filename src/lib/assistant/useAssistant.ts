import { useCallback, useMemo, useRef, useState } from 'react'
import { assistantThreadsApi, charactersApi, instructTemplatesApi } from '@/lib/api/client'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { createChatBackend } from '@/lib/api/createChatBackend'
import { cleanModelOutput } from '@/lib/text/slop'
import { newId } from '@/lib/id'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { resolveInstructTemplate } from '@/lib/prompt/instructTemplates'
import { draftFullCharacter, isAbortError } from '@/lib/characters/generateFullCharacter'
import { assistantStopSequences, buildAssistantPrompt } from '@/lib/assistant/prompt'
import { detectProducer, type ProducerKind } from '@/lib/assistant/requests'
import { DEFAULT_CHAPTER_COUNT, planStory, requestedChapterCount, writeChapter } from '@/lib/assistant/story'
import { generatedToCharacterInput } from '@/lib/assistant/saveCharacter'
import { promptTurnsOf, threadTitleFrom, type AssistantMessage, type AssistantThread } from '@/lib/assistant/thread'

/**
 * The assistant thread's own session: send, stream, and the two producers.
 *
 * Deliberately not `useChatSession`. That hook is ~3500 lines of relationship track, scene state,
 * intimacy engine, objectives, day planner and world clock, all keyed to a character. The view this
 * replaced routed a plain chat through it and inherited the lot, which is why it never felt like
 * talking to a model. This talks to the backend and persists a thread, and nothing else.
 */

/** Reserved for the reply, so the prompt never eats the whole context window. */
const REPLY_RESERVE = 900

export interface AssistantProgress {
  /** What is being produced right now, for the progress line. */
  kind: ProducerKind
  label: string
}

export function useAssistant(threadId: string | null, onThreadsChanged?: () => void) {
  const settings = useSettingsStore()
  const customInstructTemplates = useApiQuery('instruct-templates', () => instructTemplatesApi.list(), []) ?? []
  const [thread, setThread] = useState<AssistantThread | null>(null)
  const [streamingText, setStreamingText] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [progress, setProgress] = useState<AssistantProgress | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** The live thread, so a long producer run writes onto the newest state rather than a stale closure. */
  const threadRef = useRef<AssistantThread | null>(null)

  const client = useMemo(
    () =>
      createChatBackend({
        chatBackend: settings.chatBackend,
        baseUrl: settings.baseUrl,
        chatBackendBaseUrl: settings.chatBackendBaseUrl,
        chatBackendApiKey: settings.chatBackendApiKey,
        chatBackendModel: settings.chatBackendModel,
      }),
    [settings.chatBackend, settings.baseUrl, settings.chatBackendBaseUrl, settings.chatBackendApiKey, settings.chatBackendModel],
  )

  const load = useCallback(async (id: string) => {
    const found = await assistantThreadsApi.get(id)
    setThread(found ?? null)
    threadRef.current = found ?? null
  }, [])

  /** Persists the thread and keeps the local copy in step. Titles itself from the first user message. */
  const persist = useCallback(
    async (messages: AssistantMessage[], id: string) => {
      const current = threadRef.current
      const firstUser = messages.find((m) => m.role === 'user')
      const title =
        current?.title && current.title !== 'New conversation'
          ? current.title
          : firstUser
            ? threadTitleFrom(firstUser.text)
            : 'New conversation'
      const next: AssistantThread = {
        id,
        title,
        createdAt: current?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        messages,
      }
      setThread(next)
      threadRef.current = next
      await assistantThreadsApi.update(id, { title, messages })
      onThreadsChanged?.()
    },
    [onThreadsChanged],
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  /** One plain reply, streamed. */
  const sendMessage = useCallback(
    async (text: string) => {
      const id = threadId
      const trimmed = text.trim()
      if (!id || !trimmed || isBusy) return
      const controller = new AbortController()
      abortRef.current = controller
      setIsBusy(true)
      setStreamingText('')

      const userMessage: AssistantMessage = { id: newId(), role: 'user', text: trimmed, createdAt: Date.now() }
      const withUser = [...(threadRef.current?.messages ?? []), userMessage]
      await persist(withUser, id)

      try {
        const template = resolveInstructTemplate(settings.instructTemplateId, customInstructTemplates)
        const maxContext = await client.getEffectiveMaxContext(settings.sampler.max_context_length)
        const { prompt } = buildAssistantPrompt({
          turns: promptTurnsOf(withUser),
          template,
          systemPrompt: settings.assistantSystemPrompt,
          styleGuidance: settings.styleGuidance,
          contextBudget: Math.max(512, maxContext - REPLY_RESERVE),
        })
        const raw = await client.generateStream(
          {
            prompt,
            max_context_length: maxContext,
            max_length: REPLY_RESERVE,
            temperature: settings.sampler.temperature,
            top_p: settings.sampler.top_p,
            top_k: settings.sampler.top_k,
            min_p: settings.sampler.min_p,
            typical: settings.sampler.typical,
            tfs: settings.sampler.tfs,
            rep_pen: settings.sampler.rep_pen,
            rep_pen_range: settings.sampler.rep_pen_range,
            rep_pen_slope: settings.sampler.rep_pen_slope,
            stop_sequence: assistantStopSequences(template),
            trim_stop: true,
          },
          (_token, full) => setStreamingText(full),
          controller.signal,
        )
        // Same cleanup the roleplay path uses: models echo their own turn prefix back.
        const reply = cleanModelOutput(raw, { charName: 'Assistant', personaName: 'User' }).trim()
        await persist(
          [
            ...withUser,
            {
              id: newId(),
              role: 'assistant',
              text: reply,
              createdAt: Date.now(),
              ...(reply ? {} : { error: 'The model returned an empty reply.' }),
            },
          ],
          id,
        )
      } catch (e) {
        if (!isAbortError(e)) {
          await persist(
            [...withUser, { id: newId(), role: 'assistant', text: '', createdAt: Date.now(), error: errorMessage(e) }],
            id,
          )
        }
      } finally {
        setStreamingText('')
        setIsBusy(false)
        abortRef.current = null
      }
    },
    [client, isBusy, persist, settings, threadId],
  )

  /**
   * Builds a full character from a brief and attaches it to the thread. Reuses the character
   * library's own staged generator, so what lands here is exactly what the character editor
   * produces — card, profile, wardrobe and lore — rather than a second, worse implementation.
   */
  const produceCharacter = useCallback(
    async (brief: string) => {
      const id = threadId
      if (!id || isBusy) return
      const controller = new AbortController()
      abortRef.current = controller
      setIsBusy(true)
      setProgress({ kind: 'character', label: 'Writing the card' })
      try {
        const draft = await draftFullCharacter(
          client,
          { brief, styleGuidance: settings.styleGuidance },
          {
            signal: controller.signal,
            onStage: (stage, status) => {
              if (status === 'start') setProgress({ kind: 'character', label: `Writing the ${stage}` })
            },
          },
        )
        const failedStages = draft.failed.map((f) => f.stage)
        await persist(
          [
            ...(threadRef.current?.messages ?? []),
            {
              id: newId(),
              role: 'assistant',
              text: `**${draft.card.name}**\n\n${draft.card.description}`,
              createdAt: Date.now(),
              attachment: {
                kind: 'character',
                character: {
                  card: draft.card,
                  profile: draft.profile,
                  bonds: draft.bonds,
                  outfits: draft.outfits,
                  characterBook: draft.characterBook,
                  ...(failedStages.length ? { failedStages } : {}),
                },
              },
            },
          ],
          id,
        )
      } catch (e) {
        if (!isAbortError(e)) toastError(errorMessage(e))
      } finally {
        setProgress(null)
        setIsBusy(false)
        abortRef.current = null
      }
    },
    [client, isBusy, persist, settings.styleGuidance, threadId],
  )

  /** Plans a story, then writes each chapter in order, persisting as it goes so nothing is lost mid-run. */
  const produceStory = useCallback(
    async (brief: string) => {
      const id = threadId
      if (!id || isBusy) return
      const controller = new AbortController()
      abortRef.current = controller
      setIsBusy(true)
      setProgress({ kind: 'story', label: 'Planning the chapters' })
      const messageId = newId()
      try {
        const outline = await planStory(client, brief, {
          chapterCount: requestedChapterCount(brief) ?? DEFAULT_CHAPTER_COUNT,
          styleGuidance: settings.styleGuidance,
          signal: controller.signal,
        })
        let story = { ...outline, writingIndex: 0 }
        /** Rewrites the single attachment message in place, so the outline appears immediately and
         *  each finished chapter shows up as it lands rather than all at the end. */
        const flush = async () => {
          const others = (threadRef.current?.messages ?? []).filter((m) => m.id !== messageId)
          await persist(
            [
              ...others,
              {
                id: messageId,
                role: 'assistant',
                text: `**${story.title}**\n\n${story.premise}`,
                createdAt: Date.now(),
                attachment: { kind: 'story', story },
              },
            ],
            id,
          )
        }
        await flush()

        for (let i = 0; i < story.chapters.length; i += 1) {
          if (controller.signal.aborted) break
          setProgress({ kind: 'story', label: `Writing chapter ${i + 1} of ${story.chapters.length}` })
          const text = await writeChapter(client, story, i, {
            styleGuidance: settings.styleGuidance,
            signal: controller.signal,
          })
          const chapters = story.chapters.map((c, idx) => (idx === i ? { ...c, text } : c))
          story = { ...story, chapters, writingIndex: i + 1 }
          await flush()
        }
        // The key is dropped rather than set to undefined, which is what "finished" means here.
        const { writingIndex: _done, ...finished } = story
        story = finished as typeof story
        await flush()
      } catch (e) {
        if (!isAbortError(e)) toastError(errorMessage(e))
      } finally {
        setProgress(null)
        setIsBusy(false)
        abortRef.current = null
      }
    },
    [client, isBusy, persist, settings.styleGuidance, threadId],
  )

  /** Saves a generated character into the library, and stamps the message so it can't be saved twice. */
  const saveCharacter = useCallback(
    async (messageId: string) => {
      const id = threadId
      const message = threadRef.current?.messages.find((m) => m.id === messageId)
      const generated = message?.attachment?.character
      if (!id || !generated || generated.savedCharacterId) return
      try {
        const created = await charactersApi.create(generatedToCharacterInput(generated))
        toastSuccess(`Saved "${generated.card.name}" to your characters.`)
        await persist(
          (threadRef.current?.messages ?? []).map((m) =>
            m.id === messageId && m.attachment?.character
              ? { ...m, attachment: { ...m.attachment, character: { ...m.attachment.character, savedCharacterId: created.id } } }
              : m,
          ),
          id,
        )
      } catch (e) {
        toastError(errorMessage(e))
      }
    },
    [persist, threadId],
  )

  return {
    thread,
    load,
    isBusy,
    streamingText,
    progress,
    sendMessage,
    produceCharacter,
    produceStory,
    saveCharacter,
    abort,
    detectProducer,
  }
}
