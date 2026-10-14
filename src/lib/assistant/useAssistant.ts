import { useCallback, useMemo, useRef, useState } from 'react'
import { agentApi, assistantThreadsApi, charactersApi, instructTemplatesApi } from '@/lib/api/client'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { createChatBackend } from '@/lib/api/createChatBackend'
import { cleanModelOutput } from '@/lib/text/slop'
import { newId } from '@/lib/id'
import { errorMessage, toastError, toastInfo, toastSuccess } from '@/lib/store/useToastStore'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { resolveInstructTemplate } from '@/lib/prompt/instructTemplates'
import { resolveAssistShaping } from '@/lib/api/assistShaping'
import { STAGE_LABELS, StageSkipped, draftFullCharacter, isAbortError, runDraftStage, type OptionalStage } from '@/lib/characters/generateFullCharacter'
import { ASSISTANT_SYSTEM_PROMPT, assistantStopSequences, buildAssistantPrompt } from '@/lib/assistant/prompt'
import { withAgentContext } from '@/lib/assistant/agentContext'
import { buildToolbox } from '@/lib/assistant/toolbox'
import { generatedFromDraft } from '@/lib/assistant/characterTools'
import { patchBody } from '@/lib/assistant/characterSections'
import { pendingImages, runToolLoop, stepTurns, toolInstructions, type ToolStep } from '@/lib/assistant/tools'
import { summarizeTurns, summaryIsStale } from '@/lib/assistant/summary'
import { base64FromDataUrl } from '@/lib/api/binaryUtils'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { detectProducer, type ProducerKind } from '@/lib/assistant/requests'
import { DEFAULT_CHAPTER_COUNT, planStory, requestedChapterCount, writeChapter } from '@/lib/assistant/story'
import { generatedToCharacterInput } from '@/lib/assistant/saveCharacter'
import { promptTurnsOf, threadTitleFrom, type AssistantMessage, type AssistantThread } from '@/lib/assistant/thread'

/** The assistant thread's own session: send, stream, and the two producers. Deliberately not `useChatSession`. */

/** Reserved for the reply, so the prompt never eats the whole context window. */
const REPLY_RESERVE = 2000
/** Tool calls carry whole documents (a world with its lore) as arguments, so a step needs far more room. */
const TOOL_REPLY_RESERVE = 2600
const MAX_TOOL_STEPS = 24

export interface AssistantProgress {
  /** What is being produced right now, for the progress line. */
  kind: ProducerKind | 'tools'
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
        ...(current?.summary ? { summary: current.summary } : {}),
      }
      setThread(next)
      threadRef.current = next
      await assistantThreadsApi.update(id, { title, messages })
      onThreadsChanged?.()
    },
    [onThreadsChanged],
  )

  /** Stores the running summary of turns that scrolled out of the prompt. */
  const saveSummary = useCallback(async (id: string, summary: { text: string; covers: number }) => {
    const current = threadRef.current
    if (current?.id === id) {
      const next = { ...current, summary }
      threadRef.current = next
      setThread(next)
    }
    await assistantThreadsApi.update(id, { summary })
  }, [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  /** One reply, streamed: with tools it can look things up, read pictures, and (with approval) change files. */
  const sendMessage = useCallback(
    async (text: string, idOverride?: string, attachedImages: string[] = []) => {
      const id = idOverride ?? threadId
      const trimmed = text.trim()
      if (!id || (!trimmed && !attachedImages.length) || isBusy) return
      const controller = new AbortController()
      abortRef.current = controller
      setIsBusy(true)
      setStreamingText('')

      const userMessage: AssistantMessage = { id: newId(), role: 'user', text: trimmed, createdAt: Date.now(), ...(attachedImages.length ? { images: attachedImages } : {}) }
      const withUser = [...(threadRef.current?.id === id ? threadRef.current.messages : []), userMessage]
      await persist(withUser, id)

      let working: AssistantMessage[] = withUser
      try {
        const template = resolveInstructTemplate(settings.instructTemplateId, customInstructTemplates)
        const maxContext = await client.getEffectiveMaxContext(settings.sampler.max_context_length)
        const box = await buildToolbox({
          mode: settings.assistantTools,
          autoApprove: settings.assistantAutoApprove,
          imageSettings: settings,
          signal: controller.signal,
          character: { client, styleGuidance: settings.styleGuidance, onProgress: (label) => setProgress({ kind: 'character', label }) },
          ask: (p) => confirmDialog({ title: p.title, detail: p.detail, confirmLabel: p.confirmLabel, tone: 'default' }),
        })
        const withTools = box.tools.length > 0
        const reserve = withTools ? TOOL_REPLY_RESERVE : REPLY_RESERVE
        const budget = Math.max(512, maxContext - reserve)
        const [workspace, notes] = await Promise.all([agentApi.workspace().catch(() => null), agentApi.memory().catch(() => [])])
        const base = settings.assistantSystemPrompt.trim() || ASSISTANT_SYSTEM_PROMPT
        let summary = threadRef.current?.summary
        const systemPrompt = () =>
          withAgentContext(withTools ? `${base}\n\n${toolInstructions(box.tools)}` : base, {
            now: new Date(),
            workspaceName: withTools && workspace?.root ? workspace.root.split(/[\\/]/).filter(Boolean).pop() : undefined,
            notes: notes.map((n) => n.text),
            summary: summary?.text,
          })

        // Turns that no longer fit are folded into a running summary, so a long conversation keeps its thread.
        const turns = promptTurnsOf(withUser)
        const fit = buildAssistantPrompt({ turns, template, systemPrompt: systemPrompt(), styleGuidance: settings.styleGuidance, contextBudget: budget })
        const dropped = turns.length - fit.usedTurns
        if (summaryIsStale(summary, dropped)) {
          setProgress({ kind: 'tools', label: 'Summarising the earlier conversation' })
          try {
            const covers = summary?.covers ?? 0
            const folded = await summarizeTurns(client, summary?.text, turns.slice(covers, dropped), { shaping: await resolveAssistShaping(60_000), signal: controller.signal, contextLength: maxContext })
            if (folded) {
              summary = { text: folded, covers: dropped }
              await saveSummary(id, summary)
            }
          } catch (e) {
            if (isAbortError(e)) throw e
          }
          setProgress(null)
        }

        // Pictures the model should see now: the ones the user attached, then what the latest tool steps returned.
        const request = (steps: ToolStep[]) => {
          const { prompt } = buildAssistantPrompt({
            turns: [...turns, ...stepTurns(steps)],
            template,
            systemPrompt: systemPrompt(),
            styleGuidance: settings.styleGuidance,
            contextBudget: budget,
          })
          const images = [...attachedImages.slice(0, 2), ...pendingImages(steps)].slice(-3).map(base64FromDataUrl)
          return {
            prompt,
            max_context_length: maxContext,
            max_length: reserve,
            temperature: settings.sampler.temperature,
            top_p: settings.sampler.top_p,
            top_k: settings.sampler.top_k,
            min_p: settings.sampler.min_p,
            typical: settings.sampler.typical,
            tfs: settings.sampler.tfs,
            rep_pen: settings.sampler.rep_pen,
            rep_pen_range: settings.sampler.rep_pen_range,
            rep_pen_slope: settings.sampler.rep_pen_slope,
            stop_sequence: [...assistantStopSequences(template), ...(withTools ? ['</tool_call>', '<tool_call|>'] : [])],
            trim_stop: true,
            ...(images.length ? { images } : {}),
          }
        }

        /** One model reply for the thread so far, plus any tool steps already taken this turn. An empty reply is tried once more. */
        const ask = async (steps: ToolStep[]) => {
          const generate = () =>
            client.generateStream(
              request(steps),
              // A tool call is plumbing, not prose: keep it out of the live text.
              (_token, full) => setStreamingText(withTools && /<\|?tool_call/i.test(full) ? '' : full),
              controller.signal,
            )
          const first = await generate()
          return first.trim() ? first : generate()
        }

        let raw: string
        let note = ''
        if (!withTools) {
          raw = await ask([])
        } else {
          const loop = await runToolLoop({
            signal: controller.signal,
            maxSteps: MAX_TOOL_STEPS,
            ask: (steps) => {
              setProgress({ kind: 'tools', label: steps.length ? `Thinking after ${steps.length} tool ${steps.length === 1 ? 'call' : 'calls'}` : 'Thinking' })
              return ask(steps)
            },
            run: async (call) => {
              setProgress({ kind: 'tools', label: `Using ${call.name}` })
              return box.run(call)
            },
            onStep: (step) => {
              working = [
                ...working,
                {
                  id: newId(),
                  role: 'assistant',
                  text: '',
                  createdAt: Date.now(),
                  tool: { name: step.call.name, arguments: step.call.arguments, result: step.result.text, isError: step.result.isError, ...(step.result.images?.length ? { images: step.result.images } : {}), ...(step.result.undo ? { undo: step.result.undo } : {}) },
                  ...(step.result.draft ? { attachment: { kind: 'character' as const, character: step.result.draft } } : {}),
                },
              ]
              void persist(working, id)
            },
          })
          raw = loop.final || (loop.steps.length ? 'Done.' : '')
          if (loop.exhausted) note = `\n\n(Stopped after ${MAX_TOOL_STEPS} tool calls. Say "continue" and I will pick up from here.)`
        }
        // Same cleanup the roleplay path uses: models echo their own turn prefix back.
        const reply = `${cleanModelOutput(raw, { charName: 'Assistant', personaName: 'User' }).trim()}${note}`.trim()
        await persist(
          [
            ...working,
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
          await persist([...working, { id: newId(), role: 'assistant', text: '', createdAt: Date.now(), error: errorMessage(e) }], id)
        }
      } finally {
        setStreamingText('')
        setProgress(null)
        setIsBusy(false)
        abortRef.current = null
      }
    },
    [client, isBusy, persist, saveSummary, settings, customInstructTemplates, threadId],
  )

  /** Records a request as the user's own turn without asking the model for a chat reply: the producers answer with a card. */
  const addUserTurn = useCallback(
    async (text: string, id: string) => {
      const userMessage: AssistantMessage = { id: newId(), role: 'user', text, createdAt: Date.now() }
      await persist([...(threadRef.current?.id === id ? threadRef.current.messages : []), userMessage], id)
    },
    [persist],
  )

  /** Builds a full character from a brief and attaches the draft to the thread; nothing is saved until the user says so. */
  const produceCharacter = useCallback(
    async (brief: string, idOverride?: string) => {
      const id = idOverride ?? threadId
      if (!id || isBusy) return
      const controller = new AbortController()
      abortRef.current = controller
      setIsBusy(true)
      setProgress({ kind: 'character', label: STAGE_LABELS.card })
      try {
        await addUserTurn(brief, id)
        const draft = await draftFullCharacter(
          client,
          { brief, styleGuidance: settings.styleGuidance },
          {
            shaping: await resolveAssistShaping(120_000),
            signal: controller.signal,
            onStage: (stage, status) => {
              if (status === 'start') setProgress({ kind: 'character', label: STAGE_LABELS[stage] })
            },
          },
        )
        await persist(
          [
            ...(threadRef.current?.messages ?? []),
            {
              id: newId(),
              role: 'assistant',
              text: `**${draft.card.name}**\n\n${draft.card.description}`,
              createdAt: Date.now(),
              attachment: { kind: 'character', character: generatedFromDraft(draft) },
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
    [addUserTurn, client, isBusy, persist, settings.styleGuidance, threadId],
  )

  /** Re-runs one section of a draft that has not been saved, so a weak one can be redone without starting over. */
  const redoStage = useCallback(
    async (messageId: string, stage: OptionalStage) => {
      const id = threadId
      const generated = threadRef.current?.messages.find((m) => m.id === messageId)?.attachment?.character
      if (!id || !generated || generated.savedCharacterId || isBusy) return
      const controller = new AbortController()
      abortRef.current = controller
      setIsBusy(true)
      setProgress({ kind: 'character', label: STAGE_LABELS[stage] })
      try {
        const next = await runDraftStage(client, stage, generated, {
          styleGuidance: settings.styleGuidance,
          shaping: await resolveAssistShaping(120_000),
          signal: controller.signal,
        })
        const { failedStages: _was, ...sections } = next
        const stillFailed = (generated.failedStages ?? []).filter((s) => s !== stage)
        await persist(
          (threadRef.current?.messages ?? []).map((m) =>
            m.id === messageId ? { ...m, attachment: { kind: 'character', character: { ...sections, ...(stillFailed.length ? { failedStages: stillFailed } : {}) } } } : m,
          ),
          id,
        )
      } catch (e) {
        if (e instanceof StageSkipped) toastInfo(`${STAGE_LABELS[stage]}: ${e.message}`)
        else if (!isAbortError(e)) toastError(`${STAGE_LABELS[stage]}: ${errorMessage(e)}`)
      } finally {
        setProgress(null)
        setIsBusy(false)
        abortRef.current = null
      }
    },
    [client, isBusy, persist, settings.styleGuidance, threadId],
  )

  /** Puts a section the Assistant rewrote back as it was. */
  const revertEdit = useCallback(
    async (messageId: string) => {
      const id = threadId
      const undo = threadRef.current?.messages.find((m) => m.id === messageId)?.tool?.undo
      if (!id || !undo || undo.reverted) return
      try {
        const current = await charactersApi.get(undo.characterId)
        if (!current) throw new Error(`${undo.name} no longer exists.`)
        await charactersApi.update(undo.characterId, patchBody(current, undo.before))
        toastSuccess(`Put back the ${STAGE_LABELS[undo.section as OptionalStage]?.toLowerCase() ?? undo.section} of ${undo.name}.`)
        await persist(
          (threadRef.current?.messages ?? []).map((m) => (m.id === messageId && m.tool?.undo ? { ...m, tool: { ...m.tool, undo: { ...m.tool.undo, reverted: true } } } : m)),
          id,
        )
      } catch (e) {
        toastError(errorMessage(e))
      }
    },
    [persist, threadId],
  )

  /** Plans a story, then writes each chapter in order, persisting as it goes so nothing is lost mid-run. */
  const produceStory = useCallback(
    async (brief: string, idOverride?: string) => {
      const id = idOverride ?? threadId
      if (!id || isBusy) return
      const controller = new AbortController()
      abortRef.current = controller
      setIsBusy(true)
      setProgress({ kind: 'story', label: 'Planning the chapters' })
      const messageId = newId()
      try {
        await addUserTurn(brief, id)
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
    [addUserTurn, client, isBusy, persist, settings.styleGuidance, threadId],
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
    redoStage,
    saveCharacter,
    revertEdit,
    abort,
    detectProducer,
  }
}
