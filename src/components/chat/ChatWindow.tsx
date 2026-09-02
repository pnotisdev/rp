import { useEffect, useRef, useState } from 'react'
import { useChatSession } from '@/lib/hooks/useChatSession'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { scrollToMessage } from '@/lib/scrollToMessage'
import { buildChatTranscriptHtml, chatTranscriptFilename, downloadChatTranscript } from '@/lib/export/chatTranscript'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { getCurrentActivity, presenceLabel } from '@/lib/world/calendar'
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
import { SearchPanel } from './SearchPanel'
import { PinnedMessagesPanel } from './PinnedMessagesPanel'

export function ChatWindow({ chatId }: { chatId: string | null }) {
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
    sendUserMessage,
    regenerate,
    swipe,
    editMessage,
    deleteMessage,
    togglePinMessage,
    abortGeneration,
    previewPrompt,
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
    forkChat,
  } = useChatSession(chatId)

  const visualNovelMode = useSettingsStore((s) => s.visualNovelMode)
  const setActiveChatId = useSettingsStore((s) => s.setActiveChatId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showInspector, setShowInspector] = useState(false)
  const [showObjective, setShowObjective] = useState(false)
  const [showEvent, setShowEvent] = useState(false)
  const [showRelationship, setShowRelationship] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showPinned, setShowPinned] = useState(false)
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
      const html = await buildChatTranscriptHtml({ chat, character, persona, messages })
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
        <span className="font-mono text-3xl text-text-muted">&gt;_</span>
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

  return (
    <div className="flex flex-1 flex-col min-w-0">
      <header className="flex items-center justify-between bg-bg-elevated px-6 py-4">
        <div className="flex items-center gap-3">
          {character?.avatarDataUrl && (
            <img src={character.avatarDataUrl} className="h-9 w-9 rounded-xl object-cover" />
          )}
          <div>
            <div className="flex items-center gap-2 text-base font-display text-text">
              {character?.card.name ?? '…'}
              {chat.parentChatId && (
                <button
                  onClick={() => setActiveChatId(chat.parentChatId!)}
                  title="This chat was forked from another one — jump back to it"
                  className="font-mono text-xs font-normal text-text-muted hover:text-text"
                >
                  ⑂ original chat
                </button>
              )}
            </div>
            <div className="text-xs text-text-muted">as {persona?.name ?? 'You'}</div>
            {presence && (
              <div
                className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-muted"
                title={presence.activity ? `${presence.activity}${presence.location ? ` @ ${presence.location}` : ''}` : undefined}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${presence.status === 'available' ? 'bg-accent' : 'bg-text-muted'}`} />
                <span className="capitalize">{presenceLabel(presence.status)}</span>
                {presence.activity && <span className="truncate">— {presence.activity}</span>}
              </div>
            )}
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-bg-sunken">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: `${warmth}%` }}
                />
              </div>
              <span className="text-[11px] uppercase tracking-wide text-text-muted">
                {formatRelationshipStage(relationshipStage)} • {warmth}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowRelationship(true)}
            title="Open relationship panel"
            aria-label="Open relationship panel"
            className="font-mono text-xs text-text-muted hover:text-text transition-colors"
          >
            ♡
          </button>
          <button
            onClick={() => setShowEvent(true)}
            title={chat.activeEvent?.title ? `Event: ${chat.activeEvent.title}` : 'Create a date/event scenario'}
            aria-label={chat.activeEvent?.title ? `Event: ${chat.activeEvent.title}` : 'Create a date/event scenario'}
            className={`font-mono text-xs transition-colors ${
              chat.activeEvent ? 'text-accent' : 'text-text-muted hover:text-text'
            }`}
          >
            ♥
          </button>
          <button
            onClick={() => setShowObjective(true)}
            title={activeObjective ? `Objective: ${activeObjective.title}` : 'Set an objective for this chat'}
            aria-label={activeObjective ? `Objective: ${activeObjective.title}` : 'Set an objective for this chat'}
            className={`font-mono text-xs transition-colors ${
              activeObjective ? 'text-accent' : 'text-text-muted hover:text-text'
            }`}
          >
            →
          </button>
          <button
            onClick={() => setShowInspector(true)}
            title="Inspect the exact prompt and memory sent to the model"
            aria-label="Inspect the exact prompt and memory sent to the model"
            className="font-mono text-xs text-text-muted hover:text-text transition-colors"
          >
            [i]
          </button>
          <button
            onClick={() => setShowPinned(true)}
            title={pinnedCount > 0 ? `${pinnedCount} pinned moment${pinnedCount === 1 ? '' : 's'}` : 'Pinned moments'}
            aria-label="Open pinned moments"
            className={`font-mono text-xs transition-colors ${
              pinnedCount > 0 ? 'text-accent' : 'text-text-muted hover:text-text'
            }`}
          >
            ★
          </button>
          <button
            onClick={() => setShowSearch(true)}
            title="Search messages"
            aria-label="Search messages"
            className="text-sm text-text-muted hover:text-text transition-colors"
          >
            🔎
          </button>
          <button
            onClick={exportTranscript}
            disabled={exporting}
            title="Export this chat as a readable HTML transcript"
            aria-label="Export chat transcript"
            className="font-mono text-xs text-text-muted hover:text-text transition-colors disabled:opacity-50"
          >
            {exporting ? '…' : '↓'}
          </button>
          <ConnectionBadge />
        </div>
      </header>
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
        />
      ) : (
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
      )}

      {(() => {
        const last = messages[messages.length - 1]
        if (!last || last.role !== 'char' || isGenerating || !last.choiceCards?.length) return null
        return (
          <ChoiceList
            choices={last.choiceCards}
            onPick={(choice) => {
              sendUserMessage(choice.text, [], { choice })
            }}
            refreshing={refreshingChoices}
            onRefresh={() => {
              setRefreshingChoices(true)
              regenerateChoices(last.id).finally(() => setRefreshingChoices(false))
            }}
          />
        )
      })()}

      <Composer
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
    </div>
  )
}
