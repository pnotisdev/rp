import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Backpack,
  CalendarHeart,
  Download,
  GitFork,
  Heart,
  MessageCircle,
  NotebookPen,
  ScrollText,
  Search,
  Star,
  Target,
  Wrench,
} from 'lucide-react'
import { useChatSession } from '@/lib/hooks/useChatSession'
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
  relationshipMilestonesFor,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import { ChatToolbar, type ChatToolbarAction } from './ChatToolbar'
import { MessageLog } from './MessageLog'
import { VNStage } from './VNStage'
import { ChoiceList } from './ChoiceList'
import { QuickReplyBar } from './QuickReplyBar'
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
import { getGiftCatalog } from '@/lib/dating/gifts'
import { getItemCatalog } from '@/lib/dating/items'

export function ChatWindow({ chatId, onBack }: { chatId: string | null; onBack?: () => void }) {
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
    useItem,
    askForCommitment,
    endRelationship,
    forkChat,
  } = useChatSession(chatId)

  const globalVisualNovelMode = useSettingsStore((s) => s.visualNovelMode)
  const quickReplies = useSettingsStore((s) => s.quickReplies)
  const showGenerationHud = useSettingsStore((s) => s.showGenerationHud)
  const regexScripts = useSettingsStore((s) => s.regexScripts)
  const sfxBursts = useSettingsStore((s) => s.sfxBursts)
  const sfxWords = useSettingsStore((s) => s.sfxWords)
  const setActiveChatId = useSettingsStore((s) => s.setActiveChatId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showInspector, setShowInspector] = useState(false)
  const [showObjective, setShowObjective] = useState(false)
  const [showEvent, setShowEvent] = useState(false)
  const [showRelationship, setShowRelationship] = useState(false)
  const [showAuthorNote, setShowAuthorNote] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showPinned, setShowPinned] = useState(false)
  const [showBag, setShowBag] = useState(false)
  const [showDirector, setShowDirector] = useState(false)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [draft, setDraft] = useState('')
  const [refreshingChoices, setRefreshingChoices] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, streamingText])

  // Publish the scene the last character reply landed on, for the app-level music player
  // (GlobalBgm) — it sits above the view switch so a world's track keeps playing into Settings.
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

  // Section 15's "discoverable keyboard shortcuts" — arrow-key swipe navigation on the latest
  // reply. Deliberately never fires the "generate a brand-new swipe" branch `swipe('right', ...)`
  // takes at the last index (see `useChatSession.ts`) — an arrow key is a passive browsing
  // gesture, and silently kicking off a real generation from it would be a surprising, easy-to-
  // trigger-by-accident side effect, not a shortcut anyone asked for.
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

  // A jump from search or the pinned panel — scroll-to for the VN log lives in VNStage itself
  // (it needs to open its collapsed backlog drawer first), driven by the same highlightedId.
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

  // Chat-level override wins over the global Settings → Appearance default, same precedence style
  // as the autoTrackRelationship/autoSuggestChoices overrides below it.
  const visualNovelMode = chat.assistOverrides?.visualNovelMode ?? globalVisualNovelMode
  const pinnedCount = messages.filter((m) => m.pinned).length
  // Presence reads the world's shared clock, so it's only meaningful for a world-bound character
  // that actually has a schedule authored — most characters have neither, and stay unbadged.
  const presence =
    world && character?.schedule?.length
      ? getCurrentActivity(character.schedule, world.currentDay ?? 0, world.currentPhaseIndex ?? 0)
      : undefined
  const warmth = computeWarmth(chat.affection ?? 0, getRelationshipStats(chat))
  // Computed live rather than trusted from the stored `chat.relationshipStage` field, so display
  // never drifts out of sync if some future code path updates affection/relationshipStats without
  // separately recomputing the cached stage.
  const relationshipStage = relationshipStageForWarmth(warmth, relationshipMilestonesFor(world?.relationshipThresholds))


  // Built once, rendered twice: as the ordinary header's toolbar (tone="chrome") in normal mode,
  // and folded into VNStage's own floating overlay (tone="glass") in VN mode — same actions, same
  // order, so the two modes never drift apart into different feature sets. Only the `primary`
  // actions render as icons; the rest collapse into a single "•••" overflow menu (ChatToolbar).
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
      key: 'event',
      icon: CalendarHeart,
      label: chat.activeEvent?.title ? `Event: ${chat.activeEvent.title}` : 'Start a date or event',
      priority: 'primary-desktop',
      active: !!chat.activeEvent,
      // 10e's content/feature flag: an author-level opt-out, not something that unlocks with more
      // warmth like every other gate in this app — so the trigger is hidden entirely rather than
      // just disabled, the same way a character with no active date shows no badge at all.
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

  // The Prompt Inspector's raw/processed toggle only ever looks at the latest reply — a message
  // generated before `rawText` existed just has nothing to show, handled there, not here.
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

  const composerNode = (variant: 'default' | 'vn') => (
    <Composer
      variant={variant}
      value={draft}
      onChangeValue={setDraft}
      disabled={!character}
      isGenerating={isGenerating}
      canContinue={canContinue}
      onSend={sendUserMessage}
      onAbort={abortGeneration}
      onContinue={continueMessage}
      onImpersonate={impersonate}
      replyAsOptions={
        character ? [{ id: character.id, name: character.card.name }, ...participantCharacters.map((c) => ({ id: c.id, name: c.card.name }))] : []
      }
      replyAsId={replyAsCharacterId}
      onChangeReplyAs={(id) => setReplyAsCharacterId(id === character?.id ? null : id)}
    />
  )

  return (
    <div className="flex flex-1 flex-col min-w-0">
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
                <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-bg-sunken">
                  <div
                    className="h-full rounded-full bg-romance transition-[width] duration-500"
                    style={{ width: `${warmth}%` }}
                  />
                </div>
                {/* Stage label truncates first on a narrow header; the warmth number never does —
                    it's the piece that actually changes turn to turn. */}
                <span className="truncate">{formatRelationshipStage(relationshipStage)}</span>
                <span className="shrink-0 tabular-nums text-text">{warmth}</span>
              </div>
            </div>
          </div>
          {/* Just the primary actions plus a "•••" overflow now, so the whole row fits beside the
              title block even at 375px without the horizontal-scroll hack the ten-icon version
              needed — and the overflow dropdown can't be clipped by an `overflow-x-auto` ancestor. */}
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
          world={world}
          onClose={() => setShowRelationship(false)}
          onBuyGift={buyGift}
          onBuyItem={buyItem}
          onAskCommitment={askForCommitment}
          onEndRelationship={endRelationship}
        />
      )}
      {showAuthorNote && (
        <AuthorNotePanel
          note={chat.authorNote}
          onClose={() => setShowAuthorNote(false)}
          onSave={updateAuthorNote}
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
          characterName={character.card.name}
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
          onDelete={deleteMessage}
          onRewind={rewindToMessage}
          onEdit={editMessage}
          onFork={forkChat}
          onTogglePin={togglePinMessage}
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
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
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
              onSwipe={swipe}
              onFork={forkChat}
              onTogglePin={togglePinMessage}
            />
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
