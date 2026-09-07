import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Backpack,
  CalendarHeart,
  Clapperboard,
  Download,
  GitFork,
  Heart,
  MessageCircle,
  NotebookPen,
  ScrollText,
  Search,
  SlidersHorizontal,
  Star,
  Target,
  Wrench,
} from 'lucide-react'
import { useChatSession } from '@/lib/hooks/useChatSession'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi } from '@/lib/api/client'
import { IconButton } from '@/components/ui/IconButton'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { scrollToMessage } from '@/lib/scrollToMessage'
import { buildChatTranscriptHtml, chatTranscriptFilename, downloadChatTranscript } from '@/lib/export/chatTranscript'
import { parseSfxWordList } from '@/lib/text/messageSegments'
import { useBgmSceneStore } from '@/lib/store/useBgmSceneStore'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { getCurrentActivity, getEnergyRemaining, presenceLabel } from '@/lib/world/calendar'
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
import { countCharReplies } from '@/lib/dating/aftercare'
import { getGiftCatalog } from '@/lib/dating/gifts'
import { getItemCatalog } from '@/lib/dating/items'
import { composeIntimacyActionText, type IntimacyUnlockable } from '@/lib/dating/intimacyCatalog'

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
    regenerateChoices,
    buyGift,
    buyItem,
    buyToy,
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
  // Only used for the Scene panel's invite picker, not the roster itself (`participantCharacters`).
  const allCharacters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const otherCharacters = character ? allCharacters.filter((c) => c.id !== character.id) : allCharacters
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showInspector, setShowInspector] = useState(false)
  const [showObjective, setShowObjective] = useState(false)
  const [showEvent, setShowEvent] = useState(false)
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

  useEffect(() => {
    setArmedIntent(null)
    setArmedIntimacyOptionId(null)
  }, [chatId])

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
        <p className="text-sm text-text-muted">Or create a new one — you can even ask the model to write it for you.</p>
      </div>
    )
  }

  // Chat-level override wins over the global Settings → Appearance default.
  const visualNovelMode = chat.assistOverrides?.visualNovelMode ?? globalVisualNovelMode
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
  const presence =
    world && character?.schedule?.length
      ? getCurrentActivity(character.schedule, world.currentDay ?? 0, world.currentPhaseIndex ?? 0)
      : undefined
  // Always the primary character's warmth, unlike VNStage's Bond card — this header's identity is always the primary's.
  const warmth = computeWarmth(chat.affection ?? 0, getRelationshipStats(chat))
  // Computed live rather than trusted from the stored `chat.relationshipStage`, so it can't drift out of sync.
  const relationshipStage = relationshipStageForWarmth(warmth, relationshipMilestonesFor(world?.relationshipThresholds))

  // Built once, rendered as the header toolbar (tone="chrome") or folded into VNStage's overlay (tone="glass").
  const toolbarTone = visualNovelMode ? 'glass' : 'chrome'
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
      label: 'Quick tuning — sampler & system prompt',
      priority: 'primary',
      active: showTuning,
      onClick: () => setShowTuning((v) => !v),
    },
    {
      key: 'event',
      icon: CalendarHeart,
      label: chat.activeEvent?.title ? `Event: ${chat.activeEvent.title}` : 'Start a date or event',
      priority: 'primary-desktop',
      active: !!chat.activeEvent,
      // An author-level opt-out, hidden entirely rather than just disabled.
      hidden: !!character?.dateModeOptOut,
      onClick: () => setShowEvent(true),
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
    { key: 'bag', icon: Backpack, label: 'Bag — give a gift you own', onClick: () => setShowBag(true) },
    { key: 'inspector', icon: ScrollText, label: 'Inspect prompt & memory', onClick: () => setShowInspector(true) },
    {
      key: 'director',
      icon: Wrench,
      label: 'Director — adjust world & relationship state',
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
      title="This chat was forked from another one — jump back to it"
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

  // Intent chips: offered while relationship tracking is on for this chat (its override, else the global default).
  const relationshipTrackingActive = chat?.assistOverrides?.autoTrackRelationship ?? autoTrackRelationship
  const showIntentChips = relationshipTrackingActive && !isGenerating && !!character
  const liveDateActive = isLiveScene(chat?.activeEvent)
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
      {!visualNovelMode && (
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
                {presence && (
                  <span
                    className="flex items-center gap-1.5 truncate"
                    title={presence.activity ? `${presence.activity}${presence.location ? ` @ ${presence.location}` : ''}` : undefined}
                  >
                    <span className="text-border">·</span>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${presence.status === 'available' ? 'bg-accent' : 'bg-text-muted'}`} />
                    <span className="truncate capitalize">
                      {presenceLabel(presence.status)}
                      {presence.activity && ` — ${presence.activity}`}
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

      {visualNovelMode ? (
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
          choiceListSlot={choiceListNode('vn') || quickReplyNode('vn')}
          assistSlot={
            <>
              {showGenerationHud && <GenerationHud stats={genStats} variant="vn" />}
              <AssistActivityBar items={assistActivity} variant="vn" />
            </>
          }
          composerSlot={composerNode('vn')}
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
