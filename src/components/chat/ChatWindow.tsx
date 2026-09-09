import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Backpack,
  CalendarDays,
  CalendarHeart,
  Clapperboard,
  Download,
  Drama,
  GitFork,
  Heart,
  MessageCircle,
  NotebookPen,
  ScrollText,
  Search,
  SlidersHorizontal,
  Star,
  Sunrise,
  Target,
  Wrench,
  X,
} from 'lucide-react'
import { useChatSession } from '@/lib/hooks/useChatSession'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi } from '@/lib/api/client'
import { IconButton } from '@/components/ui/IconButton'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { scrollToMessage } from '@/lib/scrollToMessage'
import { buildChatTranscriptHtml, chatTranscriptFilename, downloadChatTranscript } from '@/lib/export/chatTranscript'
import { parseSfxWordList } from '@/lib/text/messageSegments'
import { useBgmSceneStore } from '@/lib/store/useBgmSceneStore'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { getEnergyRemaining, PHASES, presenceLabel, resolveScheduledPresence } from '@/lib/world/calendar'
import { getWorldTemplate } from '@/lib/world/worldTemplates'
import {
  computeWarmth,
  formatRelationshipStage,
  getRelationshipStats,
  isLiveScene,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import { ChatToolbar, type ChatToolbarAction } from './ChatToolbar'
import { MessageLog } from './MessageLog'
import { VNStage } from './VNStage'
import { ChoiceList } from './ChoiceList'
import { QuickReplyBar } from './QuickReplyBar'
import { IntentChips } from './IntentChips'
import { LiveRapport } from './LiveRapport'
import type { MessageIntent } from '@/lib/dating/intent'
import { GenerationHud } from './GenerationHud'
import { Composer } from './Composer'
import { ConnectionBadge } from './ConnectionBadge'
import { PromptInspector } from './PromptInspector'
import { ObjectivePanel } from './ObjectivePanel'
import { DateEventPanel } from './DateEventPanel'
import { DayPlannerPanel } from './DayPlannerPanel'
import { CalendarPanel } from './CalendarPanel'
import { RelationshipPanel } from './RelationshipPanel'
import { AuthorNotePanel } from './AuthorNotePanel'
import { AssistActivityBar } from './AssistActivityBar'
import { SearchPanel } from './SearchPanel'
import { PinnedMessagesPanel } from './PinnedMessagesPanel'
import { BagPanel } from './BagPanel'
import { DirectorPanel } from './DirectorPanel'
import { TuningPanel } from './TuningPanel'
import { ReactivePortrait } from './ReactivePortrait'
import { ScenePanel } from './ScenePanel'
import { nextRoundRobinSpeaker, rosterFrom } from '@/lib/chat/scene'
import { resolveExpressionSprite } from '@/lib/vn/expressions'
import { currentOutfitFrom } from '@/lib/vn/outfits'
import { isVnReady } from '@/lib/vn/artHint'
import { countCharReplies } from '@/lib/dating/aftercare'
import { getGiftCatalog } from '@/lib/dating/gifts'
import { getItemCatalog } from '@/lib/dating/items'
import { composeIntimacyActionText, intimacyItemById, type IntimacyUnlockable } from '@/lib/dating/intimacyCatalog'

/**
 * The main chat screen: header, toolbar, and either the default message-log layout or VNStage's
 * visual-novel layout, plus every side panel (relationship, objective, scene, inspector, etc.)
 * they share. Wires `useChatSession`'s state/actions together with settings and display state.
 */
export function ChatWindow({
  chatId,
  onBack,
  onOpenSettings,
  onNavigateToWorld,
}: {
  chatId: string | null
  onBack?: () => void
  /** Deep link from the Quick tuning panel's "Open full Generation settings" — optional so ChatWindow stays usable without a view-switcher in scope. */
  onOpenSettings?: () => void
  /** The Relationship panel's "Customize in World editor" link — optional for the same reason as `onOpenSettings`. */
  onNavigateToWorld?: (worldId: string, tab?: string) => void
}) {
  const {
    chat,
    character,
    persona,
    world,
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
    updateParticipants,
    updateMemorySummary,
    continueMessage,
    canContinue,
    canUndoLastContinue,
    undoLastContinue,
    regenerateLastContinueSegment,
    impersonate,
    draftIntimacyAction,
    activeObjective,
    createObjective,
    generateTasksForActiveObjective,
    addManualTask,
    toggleTask,
    setObjectiveStatus,
    suggestObjectiveIdea,
    suggestDateEventIdea,
    startDateEvent,
    endDateEvent,
    runDayPlannerActivity,
    regenerateChoices,
    buyGift,
    buyItem,
    buyToy,
    chooseIntimacyBranch,
    useItem,
    askForCommitment,
    initiateFirstTime,
    endRelationship,
    forkChat,
  } = useChatSession(chatId)

  const globalVisualNovelMode = useSettingsStore((s) => s.visualNovelMode)
  const autoTrackRelationship = useSettingsStore((s) => s.autoTrackRelationship)
  const quickReplies = useSettingsStore((s) => s.quickReplies)
  const showGenerationHud = useSettingsStore((s) => s.showGenerationHud)
  const regexScripts = useSettingsStore((s) => s.regexScripts)
  const sfxBursts = useSettingsStore((s) => s.sfxBursts)
  const sfxWords = useSettingsStore((s) => s.sfxWords)
  const setActiveChatId = useSettingsStore((s) => s.setActiveChatId)
  const firstReplyTipDismissed = useSettingsStore((s) => s.firstReplyTipDismissed)
  const dismissFirstReplyTip = useSettingsStore((s) => s.dismissFirstReplyTip)
  // Only used for the Scene panel's invite picker, not the roster itself (`participantCharacters`).
  const allCharacters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const otherCharacters = character ? allCharacters.filter((c) => c.id !== character.id) : allCharacters
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showInspector, setShowInspector] = useState(false)
  const [showObjective, setShowObjective] = useState(false)
  const [showEvent, setShowEvent] = useState(false)
  const [showDayPlanner, setShowDayPlanner] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  const [showRelationship, setShowRelationship] = useState(false)
  const [showAuthorNote, setShowAuthorNote] = useState(false)
  const [showScene, setShowScene] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showPinned, setShowPinned] = useState(false)
  const [showBag, setShowBag] = useState(false)
  const [showDirector, setShowDirector] = useState(false)
  const [showTuning, setShowTuning] = useState(false)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [draft, setDraft] = useState('')
  const [armedIntent, setArmedIntent] = useState<MessageIntent | null>(null)
  // Set when a Relationship-panel intimacy action populates the composer; carries the outfit/aftercare side effects into the next send.
  const [armedIntimacyOptionId, setArmedIntimacyOptionId] = useState<string | null>(null)
  const [refreshingChoices, setRefreshingChoices] = useState(false)
  const [exporting, setExporting] = useState(false)
  // VN quick menu's Auto toggle — off by default, never persisted, and reset below on every chat
  // switch, so it can never silently keep running somewhere the user forgot about. See
  // `handleAutoAdvanceFire`'s own doc comment for the rest of the safety rails.
  const [autoAdvance, setAutoAdvance] = useState(false)
  const autoAdvanceCountRef = useRef(0)
  const autoAdvanceStartRef = useRef<number | null>(null)

  useEffect(() => {
    setArmedIntent(null)
    setArmedIntimacyOptionId(null)
    setAutoAdvance(false)
  }, [chatId])

  useEffect(() => {
    if (autoAdvance) {
      autoAdvanceCountRef.current = 0
      autoAdvanceStartRef.current = Date.now()
    }
  }, [autoAdvance])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, streamingText])

  // Publishes the last reply's scene for the app-level music player (GlobalBgm).
  const setBgmScene = useBgmSceneStore((s) => s.setScene)
  const lastChar = [...messages].reverse().find((m) => m.role === 'char')
  const lastCharScene = lastChar?.swipeScenes?.[lastChar.activeSwipe ?? 0] ?? lastChar?.scene
  useEffect(() => {
    setBgmScene(lastCharScene)
  }, [lastCharScene?.mood, lastCharScene?.background, setBgmScene])

  // A failed reply never re-arms `handleAutoAdvanceFire` on its own — `dialogueComplete` in
  // `VNStage` requires `!failed`, so its schedule effect just never fires again for this message.
  // That's already safe (no retry storm), but the toggle would otherwise sit there still showing
  // "on" and pulsing while actually dormant — this turns it off outright so the UI doesn't lie.
  useEffect(() => {
    if (autoAdvance && lastChar?.failed) setAutoAdvance(false)
  }, [autoAdvance, lastChar?.failed])

  useEffect(() => {
    setDraft('')
  }, [chatId])

  useEffect(() => {
    if (highlightedId) scrollToMessage(scrollRef.current, highlightedId)
  }, [highlightedId])

  // Arrow-key swipe navigation on the latest reply; never triggers a new-swipe generation at the last index.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
      const last = [...messages].reverse().find((m) => m.role === 'char')
      if (!last) return
      const swipes = last.swipes ?? [last.text]
      const current = last.activeSwipe ?? 0
      const dir = e.key === 'ArrowLeft' ? 'left' : 'right'
      if (dir === 'left' && current === 0) return
      if (dir === 'right' && current >= swipes.length - 1) return
      e.preventDefault()
      swipe(last.id, dir)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [messages, swipe])

  // A jump from search or the pinned panel; VNStage handles its own scroll-to since it must open its backlog drawer first.
  const jumpToMessage = (id: string) => {
    setShowSearch(false)
    setShowPinned(false)
    setHighlightedId(id)
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current)
    highlightTimeoutRef.current = setTimeout(() => setHighlightedId(null), 2200)
  }

  const jumpToChat = (otherChatId: string) => {
    setShowSearch(false)
    setShowPinned(false)
    setActiveChatId(otherChatId)
  }

  const exportTranscript = async () => {
    if (!chat || exporting) return
    setExporting(true)
    try {
      const html = await buildChatTranscriptHtml({
        chat,
        character,
        persona,
        messages,
        regexScripts,
        sfx: !sfxBursts
          ? { disabled: true }
          : { extraWords: [...parseSfxWordList(sfxWords), ...(character?.sfxWords ?? [])] },
      })
      downloadChatTranscript(html, chatTranscriptFilename(chat.title))
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  if (!chatId || !chat) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <MessageCircle size={40} strokeWidth={1.25} className="text-text-muted" />
        <p className="text-xl font-medium text-text">Pick a character to start a conversation</p>
        <p className="text-sm text-text-muted">Or create a new one. You can even ask the model to write it for you.</p>
      </div>
    )
  }

  // Chat-level override wins over the global Settings → Appearance default. Either can be `'auto'`
  // — resolved to a real boolean via `isVnReady` (character has sprites, world has scene art) so
  // 'auto' never shows a blank void, and everything past this point reads the resolved boolean.
  const visualNovelMode = chat.assistOverrides?.visualNovelMode ?? globalVisualNovelMode
  const resolvedVisualNovelMode = visualNovelMode === 'auto' ? isVnReady(character, world) : visualNovelMode
  // In-chat VN toggle: writes an explicit per-chat override (never 'auto' — that's only reachable
  // from Settings/RelationshipPanel), clearing back to "inherit" when the new value would just
  // match the global default. Same precedence contract as RelationshipPanel's own override selects.
  const toggleVnForChat = () => {
    const next = { ...(chat.assistOverrides ?? {}) }
    const target = !resolvedVisualNovelMode
    if (target === globalVisualNovelMode) delete next.visualNovelMode
    else next.visualNovelMode = target
    chatsApi.update(chat.id, { assistOverrides: next }).catch((e) => toastError(errorMessage(e)))
  }
  // Post-first-reply tip: a one-time nudge toward the two changes that most alter the experience,
  // once there's an actual completed reply to react to and at least one of them still applies.
  // Dismissing it is permanent (`firstReplyTipDismissed`) — this is a first-run orientation, not a
  // recurring reminder.
  const showFirstReplyTip =
    !firstReplyTipDismissed && !isGenerating && !!lastChar?.text && !lastChar.failed && (!resolvedVisualNovelMode || !character?.worldId)
  const pinnedCount = messages.filter((m) => m.pinned).length
  // Reactive portrait for the default (non-VN) layout, using the same expression resolution as VNStage's sprite.
  const reactivePortraitExpression = lastCharScene?.expression || 'neutral'
  const reactivePortraitUrl = resolveExpressionSprite(
    character?.sprites,
    character?.spriteUnlocks,
    character?.avatarDataUrl,
    reactivePortraitExpression,
    chat.affection ?? 0,
    // Same sticky-outfit read as VNStage, so both surfaces always agree on what the character is wearing.
    currentOutfitFrom(messages),
    { variants: character?.spriteVariants, seed: lastChar?.id ?? 'no-message' },
  )
  // Only meaningful for a world-bound character with an authored schedule; most stay unbadged.
  // Uses the same scene-reconciled presence the prompt does (per-chat time-of-day override, an
  // established scene location) so the badge can't say "in class" while the scene is elsewhere.
  const presence =
    world && character?.schedule?.length
      ? resolveScheduledPresence(
          character.schedule,
          world.currentDay ?? 0,
          chat.scene?.timePhase ? PHASES.indexOf(chat.scene.timePhase) : (world.currentPhaseIndex ?? 0),
          chat.scene?.location,
        )
      : undefined
  // Always the primary character's warmth, unlike VNStage's Bond card — this header's identity is always the primary's.
  const warmth = computeWarmth(chat.affection ?? 0, getRelationshipStats(chat))
  // Computed live rather than trusted from the stored `chat.relationshipStage`, so it can't drift out of sync.
  const relationshipStage = relationshipStageForWarmth(warmth, relationshipMilestonesFor(world?.relationshipThresholds))

  // Built once, rendered as the header toolbar (tone="chrome") or folded into VNStage's overlay (tone="glass").
  const toolbarTone = resolvedVisualNovelMode ? 'glass' : 'chrome'
  const toolbarActions: ChatToolbarAction[] = [
    {
      key: 'relationship',
      icon: Heart,
      label: 'Relationship',
      priority: 'primary',
      onClick: () => setShowRelationship(true),
    },
    {
      key: 'tuning',
      icon: SlidersHorizontal,
      label: 'Quick tuning: sampler & system prompt',
      priority: 'primary',
      active: showTuning,
      onClick: () => setShowTuning((v) => !v),
    },
    {
      key: 'vn-mode',
      icon: Drama,
      label: resolvedVisualNovelMode ? 'Visual Novel mode: on (switch to chat view)' : 'Visual Novel mode: off (switch to scene view)',
      priority: 'primary-desktop',
      active: resolvedVisualNovelMode,
      onClick: toggleVnForChat,
    },
    {
      key: 'event',
      icon: CalendarHeart,
      label: chat.activeEvent?.title ? `Event: ${chat.activeEvent.title}` : 'Start a date or event',
      priority: 'primary-desktop',
      active: !!chat.activeEvent,
      // An author-level opt-out, or this chat's own mode saying "no romance mechanics" — either
      // way hidden entirely rather than just disabled. Never hides a genuinely active event,
      // though, even if the mode override would otherwise say no — nothing to strand the user with.
      hidden: !!character?.dateModeOptOut || (chat.assistOverrides?.showDateEventButton === false && !chat.activeEvent),
      onClick: () => setShowEvent(true),
    },
    {
      key: 'day-planner',
      icon: Sunrise,
      label: 'Plan your day',
      priority: 'primary-desktop',
      // Same "romance-flavored surface" bucket the event button already opts out of — this just
      // leads into the same scored-hangout machinery through a different door — plus no bound
      // world at all, since there's no clock/energy to plan around without one.
      hidden: !world || !!character?.dateModeOptOut || chat.assistOverrides?.showDateEventButton === false,
      onClick: () => setShowDayPlanner(true),
    },
    {
      key: 'objective',
      icon: Target,
      label: activeObjective ? `Objective: ${activeObjective.title}` : 'Set an objective',
      priority: 'primary-desktop',
      active: !!activeObjective,
      onClick: () => setShowObjective(true),
    },
    {
      key: 'calendar',
      icon: CalendarDays,
      label: 'Key dates',
      // An occasional-reference view, not a per-turn action — stays in the overflow menu rather
      // than competing for primary space with the day planner/event buttons. No bound world means
      // no clock at all to plan a birthday or anniversary against.
      hidden: !world,
      onClick: () => setShowCalendar(true),
    },
    {
      key: 'author-note',
      icon: NotebookPen,
      label: chat.authorNote?.text ? "Author's note (set)" : "Author's note",
      active: !!chat.authorNote?.text,
      onClick: () => setShowAuthorNote(true),
    },
    {
      key: 'scene',
      icon: Clapperboard,
      label: chat.scene ? `Scene (${chat.scene.turnPolicy.replace('_', ' ')})` : 'Scene',
      // Also how a first participant gets invited into an empty chat; hidden only when nobody else exists to invite.
      hidden: otherCharacters.length === 0,
      active: !!chat.scene && (!!chat.scene.location || !!chat.scene.atmosphere || chat.scene.turnPolicy !== 'manual'),
      onClick: () => setShowScene(true),
    },
    {
      key: 'pinned',
      icon: Star,
      label: pinnedCount > 0 ? `Pinned moments (${pinnedCount})` : 'Pinned moments',
      active: pinnedCount > 0,
      onClick: () => setShowPinned(true),
    },
    { key: 'search', icon: Search, label: 'Search messages', onClick: () => setShowSearch(true) },
    { key: 'bag', icon: Backpack, label: 'Bag: give a gift you own', onClick: () => setShowBag(true) },
    { key: 'inspector', icon: ScrollText, label: 'Inspect prompt & memory', onClick: () => setShowInspector(true) },
    {
      key: 'director',
      icon: Wrench,
      label: 'Director: adjust world & relationship state',
      onClick: () => setShowDirector(true),
    },
    {
      key: 'export',
      icon: Download,
      label: exporting ? 'Exporting…' : 'Export as HTML transcript',
      disabled: exporting,
      onClick: exportTranscript,
    },
  ]
  const toolbar = <ChatToolbar tone={toolbarTone} actions={toolbarActions} />

  const parentChatLink = chat.parentChatId ? (
    <button
      onClick={() => setActiveChatId(chat.parentChatId!)}
      title="This chat was forked from another one. Jump back to it"
      className="flex shrink-0 items-center gap-1 hover:text-text"
    >
      <GitFork size={11} strokeWidth={2} />
      original chat
    </button>
  ) : null

  const activeChoices = (() => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'char' || isGenerating || !last.choiceCards?.length) return null
    return last
  })()

  // For the Prompt Inspector's raw/processed toggle.
  const lastCharMessage = [...messages].reverse().find((m) => m.role === 'char')

  const choiceListNode = (variant: 'default' | 'vn') =>
    activeChoices && (
      <ChoiceList
        variant={variant}
        choices={activeChoices.choiceCards!}
        onPick={(choice) => sendUserMessage(choice.text, [], { choice })}
        refreshing={refreshingChoices}
        onRefresh={() => {
          setRefreshingChoices(true)
          regenerateChoices(activeChoices.id).finally(() => setRefreshingChoices(false))
        }}
      />
    )

  const quickReplyNode = (variant: 'default' | 'vn') =>
    !activeChoices &&
    !isGenerating && (
      <QuickReplyBar variant={variant} replies={quickReplies} onPick={(reply) => sendUserMessage(reply.message, [])} />
    )

  // Intent chips: offered while relationship tracking is on for this chat (its override, else the
  // global default) — unless the mode itself has its own opinion (`showIntentChips`), which wins
  // either way (e.g. a Freeform chat where the player later turned relationship tracking back on
  // for some other reason still doesn't want "Flirt/Tease" chips; that vocabulary is genre, not tracking).
  const relationshipTrackingActive = chat?.assistOverrides?.autoTrackRelationship ?? autoTrackRelationship
  const showIntentChips = (chat?.assistOverrides?.showIntentChips ?? relationshipTrackingActive) && !isGenerating && !!character
  const liveDateActive = isLiveScene(chat?.activeEvent)

  const AUTO_ADVANCE_MAX_TURNS = 5
  const AUTO_ADVANCE_MAX_MS = 10 * 60 * 1000
  /**
   * Real VN autoplay: called once per completed reply while Auto is on (`VNStage` owns the "when",
   * timed to that reply's length). Never auto-picks an AI-suggested choice — a real decision point
   * always waits for the player, same as autoplay pausing at a branch in any other VN. Stops itself
   * on a live date/event, a failed generation, or a capped number of turns/wall-clock time, so
   * leaving it on by accident can't run away unattended.
   */
  const handleAutoAdvanceFire = () => {
    if (!autoAdvance || isGenerating) return
    if (activeChoices) return
    if (liveDateActive || lastCharMessage?.failed) {
      setAutoAdvance(false)
      return
    }
    const elapsed = autoAdvanceStartRef.current ? Date.now() - autoAdvanceStartRef.current : 0
    if (autoAdvanceCountRef.current >= AUTO_ADVANCE_MAX_TURNS || elapsed >= AUTO_ADVANCE_MAX_MS) {
      setAutoAdvance(false)
      return
    }
    const preferred = quickReplies.find((q) => q.id === 'qr-time-skip') ?? quickReplies[0]
    if (!preferred) {
      setAutoAdvance(false)
      return
    }
    autoAdvanceCountRef.current += 1
    sendUserMessage(preferred.message, [])
  }
  // During a live scene, tension is frozen, so surface Reassure/Apologize off the live rapport read instead.
  const intentStats = (() => {
    const base = getRelationshipStats({ relationshipStats: chat?.relationshipStats })
    const strained = liveDateActive && (chat?.rapport?.trajectory === 'pulling_back' || chat?.rapport?.trajectory === 'on_edge')
    return strained ? { ...base, tension: Math.max(base.tension, 15) } : base
  })()

  const sendWithIntent = (text: string, attachments: Parameters<typeof sendUserMessage>[1] = []) => {
    const opts =
      armedIntent || armedIntimacyOptionId
        ? { ...(armedIntent ? { intent: armedIntent } : {}), ...(armedIntimacyOptionId ? { intimacyOptionId: armedIntimacyOptionId } : {}) }
        : undefined
    sendUserMessage(text, attachments, opts)
    setArmedIntent(null)
    setArmedIntimacyOptionId(null)
  }

  // Model rewrites the action line into the composer for review (never auto-sent); falls back to the canned line on failure.
  const onIntimacyAction = async (option: IntimacyUnlockable) => {
    let text = ''
    try {
      text = await draftIntimacyAction(option.id)
    } catch {
      /* fall through to the canned line */
    }
    setDraft(text.trim() || composeIntimacyActionText(option, character?.card.name ?? 'them'))
    setArmedIntimacyOptionId(option.id)
    setShowRelationship(false)
  }

  // Answering a branch the scene is blocked on: the stage moves in the hook, and an option that names a
  // catalog entry then goes through the ordinary clicked-action path so it lands in the composer for
  // review like any other deliberate move.
  const onIntimacyChoice = async (characterId: string, edgeTo: string) => {
    const entryId = await chooseIntimacyBranch(characterId, edgeTo)
    const entry = entryId ? intimacyItemById(entryId, world) : undefined
    if (entry) await onIntimacyAction(entry)
  }

  // Once a non-'manual' policy is active, the composer's "reply as" picker gives way to a read-only hint.
  const turnPolicy = chat.scene?.turnPolicy ?? 'manual'
  const turnPolicyHint =
    turnPolicy === 'manual' || participantCharacters.length === 0
      ? undefined
      : turnPolicy === 'round_robin'
        ? (() => {
            const roster = rosterFrom(character, participantCharacters)
            const next = nextRoundRobinSpeaker(roster, chat.scene?.roundRobinIndex)
            return next ? `Next: ${roster.find((r) => r.id === next.id)?.name}` : undefined
          })()
        : turnPolicy === 'director'
          ? 'AI director picks who replies'
          : 'Type @Name to address them'

  const composerNode = (variant: 'default' | 'vn') => (
    <Composer
      variant={variant}
      value={draft}
      onChangeValue={(v) => {
        setDraft(v)
        // Clearing the composer discards the armed intimacy action too.
        if (!v.trim()) setArmedIntimacyOptionId(null)
      }}
      disabled={!character}
      isGenerating={isGenerating}
      canContinue={canContinue}
      onSend={sendWithIntent}
      onAbort={abortGeneration}
      onContinue={continueMessage}
      onImpersonate={impersonate}
      canUndoLastContinue={canUndoLastContinue}
      onUndoLastContinue={undoLastContinue}
      onRegenerateLastContinueSegment={regenerateLastContinueSegment}
      replyAsOptions={
        character ? [{ id: character.id, name: character.card.name }, ...participantCharacters.map((c) => ({ id: c.id, name: c.card.name }))] : []
      }
      replyAsId={replyAsCharacterId}
      onChangeReplyAs={(id) => setReplyAsCharacterId(id === character?.id ? null : id)}
      turnPolicyHint={turnPolicyHint}
      intentSlot={
        showIntentChips ? (
          <IntentChips variant={variant} stats={intentStats} armed={armedIntent} onArm={setArmedIntent} />
        ) : undefined
      }
    />
  )

  return (
    // overflow-hidden is load-bearing: TuningPanel's closed (translate-x-full) state still counts
    // toward scrollWidth without it, causing a permanent horizontal scrollbar. Panels that need to
    // escape this box use position: fixed instead, which plain overflow doesn't clip.
    <div className="relative flex flex-1 flex-col min-w-0 overflow-hidden">
      {showFirstReplyTip && (
        // `fixed` (not `absolute`) so it floats consistently above whichever layout is active
        // (VNStage is full-bleed and doesn't otherwise have a slot for this) — same reasoning the
        // comment above gives for TuningPanel. One-time orientation nudge, not a recurring one.
        <div className="fixed inset-x-4 bottom-6 z-40 mx-auto max-w-sm rounded-2xl border border-border bg-bg-elevated p-4 shadow-lg sm:inset-x-auto sm:right-6">
          <button
            onClick={dismissFirstReplyTip}
            aria-label="Dismiss tip"
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-bg-sunken hover:text-text"
          >
            <X size={13} strokeWidth={2} />
          </button>
          <p className="pr-5 text-sm text-text">Two changes that most alter the experience:</p>
          <ul className="mt-2 space-y-1.5 text-xs text-text-muted">
            {!resolvedVisualNovelMode && (
              <li>
                <button onClick={toggleVnForChat} className="font-medium text-accent hover:underline">
                  Turn on Visual Novel mode
                </button>
                {': '}full-bleed scene art and a dialogue box, instead of the plain chat log.
              </li>
            )}
            {!character?.worldId && (
              <li>
                <span className="font-medium text-text">Bind a world</span> in the character
                editor's Identity tab, for scene backgrounds and a shared clock.
              </li>
            )}
          </ul>
        </div>
      )}
      {!resolvedVisualNovelMode && (
        <header className="flex items-center justify-between gap-4 border-b border-border bg-bg-elevated px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {onBack && (
              <IconButton tone="chrome" icon={ArrowLeft} title="Back to chats" onClick={onBack} className="md:hidden" />
            )}
            {character?.avatarDataUrl && (
              <img src={character.avatarDataUrl} className="h-10 w-10 shrink-0 rounded-xl object-cover" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-base font-display text-text">
                <span className="truncate">{character?.card.name ?? '…'}</span>
                {parentChatLink && <span className="text-xs font-normal text-text-muted">{parentChatLink}</span>}
              </div>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span>as {persona?.name ?? 'You'}</span>
                {chat.mode && (
                  <span className="flex items-center gap-2 truncate">
                    <span className="text-border">·</span>
                    {getWorldTemplate(chat.mode).label}
                  </span>
                )}
                {presence && (
                  <span
                    className="flex items-center gap-1.5 truncate"
                    title={presence.activity ? `${presence.activity}${presence.location ? ` @ ${presence.location}` : ''}` : undefined}
                  >
                    <span className="text-border">·</span>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${presence.status === 'available' ? 'bg-accent' : 'bg-text-muted'}`} />
                    <span className="truncate capitalize">
                      {presenceLabel(presence.status)}
                      {presence.activity && `. ${presence.activity}`}
                    </span>
                  </span>
                )}
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] uppercase tracking-wide text-text-muted">
                {liveDateActive && chat.rapport ? (
                  // Warmth is frozen during a live scene, so show the qualitative rapport read instead.
                  <LiveRapport read={chat.rapport} label={chat?.activeEvent?.kind === 'hangout' ? 'Live hangout' : 'Live date'} />
                ) : (
                  <>
                    <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-bg-sunken">
                      <div
                        className="h-full rounded-full bg-romance transition-[width] duration-500"
                        style={{ width: `${warmth}%` }}
                      />
                    </div>
                    {/* Stage label truncates first on a narrow header; the warmth number never does. */}
                    <span className="truncate">{formatRelationshipStage(relationshipStage)}</span>
                    <span className="shrink-0 tabular-nums text-text">{warmth}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          {/* Primary actions plus a "•••" overflow, so the row fits beside the title block at 375px. */}
          <div className="flex shrink-0 items-center gap-1">
            {toolbar}
            <div className="mx-1.5 h-5 w-px bg-border" />
            <ConnectionBadge />
          </div>
        </header>
      )}
      {showInspector && (
        <PromptInspector
          loadPrompt={previewPrompt}
          summary={chat.summary}
          onUpdateSummary={() => updateMemorySummary({ force: true })}
          onClose={() => setShowInspector(false)}
          lastReply={lastCharMessage ? { processed: lastCharMessage.text, raw: lastCharMessage.rawText } : undefined}
        />
      )}
      {showObjective && (
        <ObjectivePanel
          activeObjective={activeObjective}
          onClose={() => setShowObjective(false)}
          onCreate={createObjective}
          onSuggest={suggestObjectiveIdea}
          onGenerateTasks={generateTasksForActiveObjective}
          onAddTask={addManualTask}
          onToggleTask={toggleTask}
          onSetStatus={setObjectiveStatus}
        />
      )}
      {showEvent && (
        <DateEventPanel
          currentEvent={chat.activeEvent}
          energyRemaining={world ? getEnergyRemaining(world.currentDay ?? 0, world.currentPhaseIndex ?? 0) : undefined}
          onClose={() => setShowEvent(false)}
          onSuggest={suggestDateEventIdea}
          onStart={async (event) => {
            await startDateEvent(event)
            setShowEvent(false)
          }}
          onEnd={endDateEvent}
        />
      )}
      {showDayPlanner && character && world && (
        <DayPlannerPanel
          character={character}
          world={world}
          activeEvent={chat.activeEvent}
          onOpenActiveEvent={() => {
            setShowDayPlanner(false)
            setShowEvent(true)
          }}
          onPick={runDayPlannerActivity}
          onClose={() => setShowDayPlanner(false)}
        />
      )}
      {showCalendar && character && world && (
        <CalendarPanel
          world={world}
          character={character}
          participantCharacters={participantCharacters}
          chat={chat}
          onClose={() => setShowCalendar(false)}
        />
      )}
      {showRelationship && (
        <RelationshipPanel
          chat={chat}
          character={character}
          participantCharacters={participantCharacters}
          world={world}
          onClose={() => setShowRelationship(false)}
          onBuyGift={buyGift}
          onBuyItem={buyItem}
          onBuyToy={buyToy}
          onAskCommitment={askForCommitment}
          onInitiateFirstTime={initiateFirstTime}
          onEndRelationship={endRelationship}
          onNavigateToWorld={onNavigateToWorld}
          charReplyCount={countCharReplies(messages)}
          onIntimacyAction={onIntimacyAction}
          onIntimacyChoice={onIntimacyChoice}
        />
      )}
      {showAuthorNote && (
        <AuthorNotePanel
          note={chat.authorNote}
          onClose={() => setShowAuthorNote(false)}
          onSave={updateAuthorNote}
        />
      )}
      {showScene && (
        <ScenePanel
          scene={chat.scene}
          participantIds={chat.participants ?? []}
          otherCharacters={otherCharacters.map((c) => ({ id: c.id, name: c.card.name }))}
          onClose={() => setShowScene(false)}
          onSave={updateScene}
          onSaveParticipants={updateParticipants}
        />
      )}
      {showSearch && (
        <SearchPanel
          chatId={chat.id}
          messages={messages}
          onClose={() => setShowSearch(false)}
          onJumpToMessage={jumpToMessage}
          onJumpToChat={jumpToChat}
        />
      )}
      {showPinned && (
        <PinnedMessagesPanel
          messages={messages}
          onClose={() => setShowPinned(false)}
          onJump={jumpToMessage}
          onUnpin={togglePinMessage}
        />
      )}

      {showBag && character && (
        <BagPanel
          giftCatalog={getGiftCatalog(world)}
          giftInventory={chat.giftInventory ?? {}}
          itemCatalog={getItemCatalog(world)}
          itemInventory={chat.itemInventory ?? {}}
          // A gift goes to whoever "reply as" is set to, not always the primary — copy must say so.
          characterName={(replyAsCharacterId && participantCharacters.find((c) => c.id === replyAsCharacterId)?.card.name) || character.card.name}
          onClose={() => setShowBag(false)}
          onGive={(gift) => {
            sendUserMessage('', [], {
              choice: { id: `bag-${gift.id}`, kind: 'gift', label: gift.name, text: '', giftId: gift.id, giftName: gift.name },
            })
            setShowBag(false)
          }}
          onUseItem={(item) => {
            useItem(item.id)
            setShowBag(false)
          }}
        />
      )}

      {showDirector && (
        <DirectorPanel chat={chat} character={character} world={world} onClose={() => setShowDirector(false)} />
      )}

      <TuningPanel
        open={showTuning}
        onClose={() => setShowTuning(false)}
        character={character}
        onOpenSettings={
          onOpenSettings
            ? () => {
                setShowTuning(false)
                onOpenSettings()
              }
            : undefined
        }
      />

      {resolvedVisualNovelMode ? (
        <VNStage
          character={character}
          persona={persona}
          participantCharacters={participantCharacters}
          chat={chat}
          world={world}
          messages={messages}
          streamingText={streamingText}
          generatingMessageId={generatingMessageId}
          highlightedMessageId={highlightedId}
          onSwipe={swipe}
          onRegenerate={regenerate}
          onSteer={regenerateWithSteer}
          onDelete={deleteMessage}
          onRewind={rewindToMessage}
          onEdit={editMessage}
          onFork={forkChat}
          onTogglePin={togglePinMessage}
          onSelectSpeaker={turnPolicy === 'manual' ? (id) => setReplyAsCharacterId(id) : undefined}
          topBarExtra={toolbar}
          onBack={onBack}
          parentChatLink={parentChatLink}
          choiceListSlot={quickReplyNode('vn')}
          activeChoiceData={
            activeChoices
              ? {
                  choices: activeChoices.choiceCards!,
                  onPick: (choice) => {
                    sendUserMessage(choice.text, [], { choice })
                  },
                  onRefresh: () => {
                    setRefreshingChoices(true)
                    regenerateChoices(activeChoices.id).finally(() => setRefreshingChoices(false))
                  },
                  refreshing: refreshingChoices,
                }
              : undefined
          }
          assistSlot={
            <>
              {showGenerationHud && <GenerationHud stats={genStats} variant="vn" />}
              <AssistActivityBar items={assistActivity} variant="vn" />
            </>
          }
          composerSlot={composerNode('vn')}
          autoAdvance={autoAdvance}
          onToggleAutoAdvance={() => setAutoAdvance((v) => !v)}
          onAutoAdvanceFire={handleAutoAdvanceFire}
        />
      ) : (
        <>
          <div className="relative min-h-0 flex-1">
            <div ref={scrollRef} className="h-full overflow-y-auto px-6 py-6">
              <MessageLog
                messages={messages}
                character={character}
                persona={persona}
                participantCharacters={participantCharacters}
                generatingMessageId={generatingMessageId}
                streamingText={streamingText}
                highlightedMessageId={highlightedId}
                onEdit={editMessage}
                onDelete={deleteMessage}
                onRewind={rewindToMessage}
                onRegenerate={regenerate}
                onSteer={regenerateWithSteer}
                onSwipe={swipe}
                onFork={forkChat}
                onTogglePin={togglePinMessage}
              />
            </div>
            {/* Live scenes only — an ordinary chat stays text-focused with no portrait. */}
            {liveDateActive && character && (
              <ReactivePortrait spriteUrl={reactivePortraitUrl} alt={character.card.name} />
            )}
          </div>
          {choiceListNode('default') || quickReplyNode('default')}
          {showGenerationHud && <GenerationHud stats={genStats} />}
          <AssistActivityBar items={assistActivity} />
          {composerNode('default')}
        </>
      )}
    </div>
  )
}
