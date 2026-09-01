import { useEffect, useRef, useState } from 'react'
import { useChatSession } from '@/lib/hooks/useChatSession'
import { MessageBubble } from './MessageBubble'
import { Composer } from './Composer'
import { ConnectionBadge } from './ConnectionBadge'
import { PromptInspector } from './PromptInspector'
import { ObjectivePanel } from './ObjectivePanel'

export function ChatWindow({ chatId }: { chatId: string | null }) {
  const {
    chat,
    character,
    persona,
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
    activeObjective,
    createObjective,
    generateTasksForActiveObjective,
    addManualTask,
    toggleTask,
    setObjectiveStatus,
    suggestObjectiveIdea,
  } = useChatSession(chatId)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [showInspector, setShowInspector] = useState(false)
  const [showObjective, setShowObjective] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, streamingText])

  useEffect(() => {
    setDraft('')
  }, [chatId])

  if (!chatId || !chat) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <span className="font-mono text-3xl text-text-muted">&gt;_</span>
        <p className="text-xl font-medium text-text">Pick a character to start a conversation</p>
        <p className="text-sm text-text-muted">Or create a new one — you can even ask the model to write it for you.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-w-0">
      <header className="flex items-center justify-between bg-bg-elevated px-6 py-4">
        <div className="flex items-center gap-3">
          {character?.avatarDataUrl && (
            <img src={character.avatarDataUrl} className="h-9 w-9 rounded-xl object-cover" />
          )}
          <div>
            <div className="text-base font-semibold text-text">{character?.card.name ?? '…'}</div>
            <div className="text-xs text-text-muted">as {persona?.name ?? 'You'}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowObjective(true)}
            title={activeObjective ? `Objective: ${activeObjective.title}` : 'Set an objective for this chat'}
            className={`font-mono text-xs transition-colors ${
              activeObjective ? 'text-accent' : 'text-text-muted hover:text-text'
            }`}
          >
            →
          </button>
          <button
            onClick={() => setShowInspector(true)}
            title="Inspect the exact prompt and memory sent to the model"
            className="font-mono text-xs text-text-muted hover:text-text transition-colors"
          >
            [i]
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

      {error && (
        <div className="bg-danger/10 px-4 py-2 text-xs text-danger border-b border-border">{error}</div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-chat backdrop-blur-chat">
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              avatarDataUrl={m.role === 'char' ? character?.avatarDataUrl : persona?.avatarDataUrl}
              isStreaming={generatingMessageId === m.id}
              streamingText={streamingText}
              onEdit={(text) => editMessage(m.id, text)}
              onDelete={() => deleteMessage(m.id)}
              onRegenerate={() => regenerate(m.id)}
              onSwipe={(dir) => swipe(m.id, dir)}
            />
          ))}
          {messages.length === 0 && (
            <p className="text-center text-sm text-text-muted py-8">
              No messages yet — say hello, or the character's first message will appear once you send one.
            </p>
          )}
        </div>
      </div>

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
      />
    </div>
  )
}
