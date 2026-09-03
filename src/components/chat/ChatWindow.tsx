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
} from 'lucide-react'
import { useChatSession } from '@/lib/hooks/useChatSession'
import { IconButton } from '@/components/ui/IconButton'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { scrollToMessage } from '@/lib/scrollToMessage'
import { buildChatTranscriptHtml, chatTranscriptFilename, downloadChatTranscript } from '@/lib/export/chatTranscript'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { getCurrentActivity, getEnergyRemaining, presenceLabel } from '@/lib/world/calendar'
import {
  computeWarmth,
  formatRelationshipStage,
  getRelationshipStats,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import { MessageLog } from './MessageLog'
import { VNStage } from './VNStage'
import { ChoiceList } from './ChoiceList'
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
    assistActivity,
    sendUserMessage,
    regenerate,
    swipe,
    editMessage,
    deleteMessage,
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

  const visualNovelMode = useSettingsStore((s) => s.visualNovelMode)
  const regexScripts = useSettingsStore((s) => s.regexScripts)
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
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [draft, setDraft] = useState('')
  const [refreshingChoices, setRefreshingChoices] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, streamingText])

  useEffect(() => {
    setDraft('')
  }, [chatId])

  useEffect(() => {
    if (highlightedId) scrollToMessage(scrollRef.current, highlightedId)
  }, [highlightedId])

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
      const html = await buildChatTranscriptHtml({ chat, character, persona, messages, regexScripts })
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
  // order, so the two modes never drift apart into different feature sets.
  const toolbarTone = visualNovelMode ? 'glass' : 'chrome'
  const toolbar = (
    <>
      <IconButton tone={toolbarTone} icon={Heart} title="Open relationship panel" onClick={() => setShowRelationship(true)} />
      {/* 10e's content/feature flag: an author-level opt-out, not something that unlocks with more
          warmth like every other gate in this app — so the trigger is hidden entirely rather than
          just disabled, the same way a character with no active date shows no badge at all. */}
      {!character?.dateModeOptOut && (
        <IconButton
          tone={toolbarTone}
          icon={CalendarHeart}
          title={chat.activeEvent?.title ? `Event: ${chat.activeEvent.title}` : 'Create a date/event scenario'}
          active={!!chat.activeEvent}
          onClick={() => setShowEvent(true)}
        />
      )}
      <IconButton
        tone={toolbarTone}
        icon={Target}
        title={activeObjective ? `Objective: ${activeObjective.title}` : 'Set an objective for this chat'}
        active={!!activeObjective}
        onClick={() => setShowObjective(true)}
      />
      <IconButton
        tone={toolbarTone}
        icon={NotebookPen}
        title={chat.authorNote?.text ? "Author's note (set)" : "Author's note — a steering note for this chat"}
        active={!!chat.authorNote?.text}
        onClick={() => setShowAuthorNote(true)}
      />
      <IconButton tone={toolbarTone} icon={ScrollText} title="Inspect the exact prompt and memory sent to the model" onClick={() => setShowInspector(true)} />
      <IconButton
        tone={toolbarTone}
        icon={Star}
        title={pinnedCount > 0 ? `${pinnedCount} pinned moment${pinnedCount === 1 ? '' : 's'}` : 'Pinned moments'}
        active={pinnedCount > 0}
        onClick={() => setShowPinned(true)}
      />
      <IconButton tone={toolbarTone} icon={Search} title="Search messages" onClick={() => setShowSearch(true)} />
      <IconButton tone={toolbarTone} icon={Backpack} title="Bag — give a gift you already own" onClick={() => setShowBag(true)} />
      <IconButton tone={toolbarTone} icon={Download} title="Export this chat as a readable HTML transcript" onClick={exportTranscript} disabled={exporting} />
    </>
  )

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
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-bg-sunken">
                  <div
                    className="h-full rounded-full bg-romance transition-[width] duration-500"
                    style={{ width: `${warmth}%` }}
                  />
                </div>
                <span className="text-[11px] uppercase tracking-wide text-text-muted">
                  {formatRelationshipStage(relationshipStage)} • {warmth}
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* The full icon toolbar doesn't fit next to a title block on a phone-width screen —
                scrolls horizontally there rather than overflowing the header or crushing the
                title down to nothing. A real "what's essential on mobile" pass is a follow-up. */}
            <div className="flex max-w-[45vw] items-center gap-1 overflow-x-auto sm:max-w-none">{toolbar}</div>
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
          onEdit={editMessage}
          onFork={forkChat}
          onTogglePin={togglePinMessage}
          topBarExtra={toolbar}
          onBack={onBack}
          parentChatLink={parentChatLink}
          choiceListSlot={choiceListNode('vn')}
          assistSlot={<AssistActivityBar items={assistActivity} variant="vn" />}
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
              onRegenerate={regenerate}
              onSwipe={swipe}
              onFork={forkChat}
              onTogglePin={togglePinMessage}
            />
          </div>
          {choiceListNode('default')}
          <AssistActivityBar items={assistActivity} />
          {composerNode('default')}
        </>
      )}
    </div>
  )
}
