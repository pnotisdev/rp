import { splitReasoning } from '@/lib/text/slop'
import { tokenProbStore } from '@/lib/api/logprobs'
import { TokenProbabilities } from './TokenProbabilities'
import { memo, useState } from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, Compass, GitFork, Heart, History, MessageSquareWarning, RotateCcw, Star, TriangleAlert, Unlink, X } from 'lucide-react'
import type { StoredMessage } from '@/lib/types'
import { useSettingsStore, type AvatarShape } from '@/lib/store/useSettingsStore'
import { messageAnchorId } from '@/lib/scrollToMessage'
import { renderMessageText } from '@/lib/text/messageText'
import type { SfxConfig } from '@/lib/text/messageSegments'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { intentSpec } from '@/lib/dating/intent'
import { splitBubbles, toTextingReply } from '@/lib/text/texting'
import { useBubbleReveal } from './useBubbleReveal'

function avatarClass(shape: AvatarShape): string {
  switch (shape) {
    case 'circle':
      return 'rounded-full'
    case 'square':
      return 'rounded-none'
    case 'rectangle':
      return 'rounded-md w-7 h-9'
    case 'rounded':
    default:
      return 'rounded-md'
  }
}

function Avatar({ name, shape, dataUrl }: { name: string; shape: AvatarShape; dataUrl?: string }) {
  const base = `flex h-7 w-7 shrink-0 items-center justify-center bg-bg-sunken text-[10px] font-semibold text-text-muted overflow-hidden ${avatarClass(shape)}`
  if (dataUrl) {
    return <img src={dataUrl} alt={name} className={base + ' object-cover'} />
  }
  return <div className={base}>{name.slice(0, 2).toUpperCase()}</div>
}

interface MessageBubbleProps {
  message: StoredMessage
  avatarDataUrl?: string
  isStreaming?: boolean
  streamingText?: string
  /** Briefly highlighted after being scrolled to from a search result or the pinned-messages panel. */
  isHighlighted?: boolean
  /** SFX-burst policy for this message's speaker (global toggle + their `sfxWords`). */
  sfx?: SfxConfig
  // Every callback below takes this message's own id as its first argument, rather than `MessageLog` pre-binding a fresh `() =>…
  onEdit: (id: string, text: string) => void
  onDelete: (id: string) => void
  onRewind: (id: string) => void
  onRegenerate: (id: string) => void
  /** Item 4's mid-scene correction: re-generates this reply with a one-shot, explicit correction folded in (`dating/steer.ts`) — never touches the chat, the card, or any persistent prompt section. */
  onSteer: (id: string, steerText: string) => void
  onSwipe: (id: string, dir: 'left' | 'right') => void
  onFork: (id: string) => void
  onTogglePin: (id: string) => void
  /** Texting reply format: separate phone-style bubbles, revealed at typing pace when fresh. */
  texting?: boolean
  /** A texting bubble just appeared (for voice and scroll). */
  onBubbleShown?: (id: string, text: string) => void
}

function TypingDots() {
  return (
    <div className="flex w-fit items-center gap-1 rounded-[18px] bg-msg-char px-3.5 py-3" aria-label="typing">
      {[0, 160, 320].map((delay) => (
        <span key={delay} className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </div>
  )
}

export const MessageBubble = memo(function MessageBubble({
  message,
  avatarDataUrl,
  isStreaming,
  streamingText,
  isHighlighted,
  sfx,
  onEdit,
  onDelete,
  onRewind,
  onRegenerate,
  onSteer,
  onSwipe,
  onFork,
  onTogglePin,
  texting = false,
  onBubbleShown,
}: MessageBubbleProps) {
  const chatStyle = useSettingsStore((s) => s.chatStyle)
  // Texting: the reply as bubbles, cleaned the same way the stored text will be, with the line still being written held back.
  const streamed = isStreaming && message.role !== 'user' ? splitReasoning(streamingText ?? '') : null
  const streamedReply = streamed ? streamed.reply : streamingText ?? ''
  const textingSource = !texting || message.role === 'user' ? '' : isStreaming ? toTextingReply(streamedReply, { charName: message.name, streaming: true }) + (streamedReply.endsWith('\n') ? '\n' : '') : message.text
  const { bubbles: textingBubbles, pending: textingPending } = splitBubbles(textingSource, !!isStreaming)
  const reveal = useBubbleReveal(message.id, textingBubbles, {
    streaming: texting && !!isStreaming && message.role !== 'user',
    pending: textingPending,
    failed: message.failed,
    onShow: (b) => onBubbleShown?.(message.id, b.text),
  })
  const avatarShape = useSettingsStore((s) => s.avatarShape)
  const showTimestamps = useSettingsStore((s) => s.showTimestamps)
  const showTokenCounts = useSettingsStore((s) => s.showTokenCounts)
  const clickToEdit = useSettingsStore((s) => s.clickToEdit)
  const regexScripts = useSettingsStore((s) => s.regexScripts)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.text)
  // Item 4's steer popover: a one-shot correction typed here goes straight to `regenerateWithSteer` and is never persisted anywhere
  const [steering, setSteering] = useState(false)
  const [steerDraft, setSteerDraft] = useState('')

  const isUser = message.role === 'user'
  const displayText = isStreaming ? streamedReply : message.text
  // The model's reasoning, from the raw output kept on the message (or the stream so far). Only when the writer asked to see it.
  const showReasoning = useSettingsStore((s) => s.showReasoning)
  const rawForReasoning = isUser ? '' : isStreaming ? streamingText ?? '' : message.swipeRawTexts?.[message.activeSwipe ?? 0] ?? message.rawText ?? ''
  const thought = !isUser && showReasoning ? splitReasoning(rawForReasoning) : null
  const probs = !isUser && !isStreaming ? tokenProbStore.get(message.id) : undefined
  const swipes = message.swipes ?? []
  const canSwipe = !isUser && swipes.length > 0 && !isStreaming
  // Text stays empty on a failed generation
  const showFailedIndicator = !isUser && message.failed && !isStreaming
  // Item 8: durable alternative to a one-shot toast — see `types.ts`'s `boundaryFlag` doc comment.
  const showBoundaryFlag = !isUser && !!message.boundaryFlag && !isStreaming
  // Same durable, player-reviewed pattern as `boundaryFlag` above — see `dating/agencyGuard.ts`'s `detectPersonaAgencyViolation`.
  const showPovFlag = !isUser && !!message.povFlag && !isStreaming
  // Item 11: same durable, player-reviewed pattern again
  const showExplicitQualityFlag = !isUser && !!message.explicitQualityFlag && !isStreaming
  // Same durable pattern once more, for a reply that contradicted the tracked scene state — see `dating/continuityGuard.ts`.
  const showContinuityFlag = !isUser && !!message.continuityFlag && !isStreaming

  const startEdit = () => {
    if (!clickToEdit || isStreaming) return
    setDraft(message.text)
    setEditing(true)
  }
  const commitEdit = () => {
    setEditing(false)
    if (draft !== message.text) onEdit(message.id, draft)
  }

  const closeSteer = () => {
    setSteering(false)
    setSteerDraft('')
  }
  const submitSteer = () => {
    const trimmed = steerDraft.trim()
    closeSteer()
    if (trimmed) onSteer(message.id, trimmed)
  }
  // Inline popover anchored to the Steer button; a click-outside backdrop closes it.
  const steerControl = (
    <span className="relative">
      <button
        onClick={() => setSteering((v) => !v)}
        className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-bg-sunken ${steering ? 'bg-bg-sunken text-accent' : 'hover:text-text'}`}
        title="Steer. Correct this reply and regenerate"
        aria-label="Steer this reply"
      >
        <Compass size={13} strokeWidth={2} />
      </button>
      {steering && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeSteer} />
          <div
            className="absolute bottom-full right-0 z-50 mb-1.5 w-64 rounded-lg border border-border bg-bg-elevated p-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <textarea
              autoFocus
              value={steerDraft}
              onChange={(e) => setSteerDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitSteer()
                if (e.key === 'Escape') closeSteer()
              }}
              placeholder="e.g. stop escalating, she should pull back and change the subject"
              rows={2}
              className="w-full resize-none rounded-md border border-accent/60 bg-bg p-2 text-xs text-text outline-none"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] text-text-muted">Regenerates with this correction. Nothing is saved.</span>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={closeSteer}
                  className="rounded-md px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-bg-sunken hover:text-text"
                >
                  Cancel
                </button>
                <button
                  onClick={submitSteer}
                  disabled={!steerDraft.trim()}
                  className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-accent-text transition-opacity disabled:opacity-40"
                >
                  Regenerate
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </span>
  )

  const imageStrip = message.images?.length ? (
    <div className="mb-1.5 flex flex-wrap gap-2">
      {message.images.map((src, i) => (
        <img key={i} src={src} alt="attachment" className="h-24 w-24 rounded-lg object-cover" />
      ))}
    </div>
  ) : null

  const textCore = editing ? (
    <textarea
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit()
        if (e.key === 'Escape') setEditing(false)
      }}
      className="w-full resize-none rounded-lg border border-accent/60 bg-bg p-2.5 text-[15px] text-text outline-none"
      rows={Math.min(12, Math.max(2, draft.split('\n').length))}
    />
  ) : (
    <div
      onClick={startEdit}
      className={`prose-rp whitespace-pre-wrap break-words text-[length:calc(15px*var(--read-scale,1))] leading-[1.65] ${clickToEdit ? 'cursor-text' : ''}`}
    >
      {showFailedIndicator ? (
        <span className="flex items-center gap-1.5 text-danger">
          <TriangleAlert size={14} strokeWidth={2} className="shrink-0" />
          Generation failed. Try regenerating below.
        </span>
      ) : (
        renderMessageText(displayText, regexScripts, sfx)
      )}
      {isStreaming && <span className="cursor-blink font-mono">▋</span>}
    </div>
  )

  const textBlock = (
    <>
      {thought?.reasoning && (
        <details open={thought.open} className="mb-2 rounded-lg bg-bg-sunken px-3 py-2 text-xs text-text-muted">
          <summary className="cursor-pointer select-none">{thought.open ? 'Thinking...' : 'Thought process'}</summary>
          <div className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{thought.reasoning}</div>
        </details>
      )}
      {textCore}
      {probs && <TokenProbabilities probs={probs} />}
    </>
  )

  const meta = (
    <div className="flex items-center gap-0.5 text-[11px] text-text-muted">
      {showTimestamps && <span className="mr-1.5">{new Date(message.createdAt).toLocaleTimeString()}</span>}
      {showTokenCounts && message.tokenCount ? <span className="mr-1.5">{message.tokenCount} tok</span> : null}
      {canSwipe && (
        <span className="mr-1 flex items-center gap-0.5">
          <button
            onClick={() => onSwipe(message.id, 'left')}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-bg-sunken hover:text-text disabled:opacity-30"
            disabled={(message.activeSwipe ?? 0) === 0}
            aria-label="Previous swipe"
          >
            <ChevronLeft size={14} strokeWidth={2} />
          </button>
          <span className="px-0.5 tabular-nums">
            {(message.activeSwipe ?? 0) + 1}/{swipes.length}
          </span>
          <button
            onClick={() => onSwipe(message.id, 'right')}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-bg-sunken hover:text-text"
            aria-label="Next swipe"
          >
            <ChevronRight size={14} strokeWidth={2} />
          </button>
        </span>
      )}
      {!isStreaming && (
        <>
          <button
            onClick={() => onTogglePin(message.id)}
            className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-bg-sunken ${message.pinned ? 'text-accent' : 'hover:text-text'}`}
            title={message.pinned ? 'Unpin' : 'Pin this moment'}
            aria-label={message.pinned ? 'Unpin message' : 'Pin message'}
          >
            <Star size={13} strokeWidth={2} fill={message.pinned ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={() => onRegenerate(message.id)}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-bg-sunken hover:text-text"
            title="Regenerate"
            aria-label="Regenerate"
          >
            <RotateCcw size={13} strokeWidth={2} />
          </button>
          {steerControl}
          <button
            onClick={() => onFork(message.id)}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-bg-sunken hover:text-text"
            title="Fork chat from here"
            aria-label="Fork chat from here"
          >
            <GitFork size={13} strokeWidth={2} />
          </button>
          <button
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Rewind to here?',
                body: 'Deletes this message and everything after it in this chat. Unlike forking, the discarded messages are not kept anywhere.',
                confirmLabel: 'Rewind',
                tone: 'danger',
              })
              if (ok) onRewind(message.id)
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-bg-sunken hover:text-danger"
            title="Rewind to here (delete this and everything after)"
            aria-label="Rewind to here. Delete this message and everything after it"
          >
            <History size={13} strokeWidth={2} />
          </button>
          <button
            onClick={() => onDelete(message.id)}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-bg-sunken hover:text-danger"
            title="Delete"
            aria-label="Delete message"
          >
            <X size={13} strokeWidth={2} />
          </button>
        </>
      )}
    </div>
  )
  // Meta (timestamp, regenerate/delete, swipe) only appears on hover
  const metaHoverable = (
    <div className={`mt-1 h-6 transition-opacity ${steering ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>{meta}</div>
  )
  // Unlike the rest of `meta`, a pin needs to stay visible at rest
  const pinBadge = message.pinned ? (
    <span className="inline-flex text-accent" title="Pinned">
      <Star size={12} strokeWidth={2} fill="currentColor" />
    </span>
  ) : null
  // Item 8: same "stays visible at rest" reasoning as the pin badge above
  const boundaryBadge = showBoundaryFlag ? (
    <span className="inline-flex text-warning" title={`May have crossed a stated limit: "${message.boundaryFlag}". Worth a regenerate if it reads wrong.`}>
      <TriangleAlert size={12} strokeWidth={2} />
    </span>
  ) : null
  // Distinct icon from `boundaryBadge` (a circle, not a triangle) so the two read as different categories of flag at a glance, even…
  const povBadge = showPovFlag ? (
    <span
      className="inline-flex text-warning"
      title={`May have narrated your own reaction on your behalf: "${message.povFlag}". Worth a regenerate if it reads wrong.`}
    >
      <AlertCircle size={12} strokeWidth={2} />
    </span>
  ) : null
  // A third, distinct icon again — this one a prose-quality miss (the model actually used a phrase it was told to avoid), not a…
  const explicitQualityBadge = showExplicitQualityFlag ? (
    <span
      className="inline-flex text-warning"
      title={`This reply used the stock phrase "${message.explicitQualityFlag}" it was told to avoid. Worth a regenerate if it reads wrong.`}
    >
      <MessageSquareWarning size={12} strokeWidth={2} />
    </span>
  ) : null
  // A fourth distinct icon — a break in what the scene already established, rather than a limit, a
  // POV slip, or a prose tell.
  const continuityBadge = showContinuityFlag ? (
    <span className="inline-flex text-warning" title={`This reply contradicted the scene: ${message.continuityFlag}. Worth a regenerate if it reads wrong.`}>
      <Unlink size={12} strokeWidth={2} />
    </span>
  ) : null
  // 10b: how the player tagged this line's intent. Shown at rest (not hover-only) — it's real
  // context for how the exchange should read.
  const intentBadge = (() => {
    const spec = intentSpec(message.intent)
    if (!spec) return null
    return (
      <span className="rounded-full bg-accent/12 px-1.5 py-px text-[10px] font-medium text-accent" title={spec.hint}>
        {spec.label}
      </span>
    )
  })()
  // The user's own direct question: once sent, a line drafted from the Relationship panel's Unlocks tab (a kiss…
  const intimacyActionBadge = message.intimacyAction ? (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-romance/12 px-1.5 py-px text-[10px] font-medium text-romance"
      title={`Sent from the Relationship panel's Unlocks tab (${message.intimacyAction.category.replace('_', ' ')}): "${message.intimacyAction.label}"`}
    >
      <Heart size={9} strokeWidth={2.25} className="shrink-0" />
      {message.intimacyAction.label}
    </span>
  ) : null
  const anchorId = messageAnchorId(message.id)
  const highlightClass = isHighlighted ? 'bg-accent/10' : ''

  if (texting) {
    const bubbleBase = 'w-fit max-w-[78%] rounded-[18px] px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap break-words'
    const userSide = message.role === 'user'
    return (
      <div
        id={anchorId} data-rp-part="message" data-role={message.role}
        className={`group flex flex-col gap-1 rounded-lg py-1.5 transition-colors duration-1000 ${highlightClass} ${userSide ? 'items-end' : 'items-start'}`}
      >
        {imageStrip}
        {editing ? (
          <div className="w-full">{textBlock}</div>
        ) : userSide ? (
          <div onClick={startEdit} className={`${bubbleBase} bg-msg-user text-accent-text`}>
            {renderMessageText(displayText, regexScripts, sfx)}
          </div>
        ) : showFailedIndicator ? (
          <div className={`${bubbleBase} flex items-center gap-1.5 bg-msg-char text-danger`}>
            <TriangleAlert size={14} strokeWidth={2} className="shrink-0" />
            Didn't send. Try regenerating.
          </div>
        ) : (
          <>
            {textingBubbles.slice(0, reveal.visible).map((b, i) => (
              <div
                key={i}
                onClick={startEdit}
                className={`${bubbleBase} animate-bubble-in bg-msg-char text-text ${b.block ? 'text-[14px] leading-relaxed' : ''}`}
              >
                {renderMessageText(b.text, regexScripts, sfx)}
              </div>
            ))}
            {reveal.typing && <TypingDots />}
          </>
        )}
        <div className={`flex items-center gap-1.5 ${userSide ? 'flex-row-reverse' : ''}`}>
          {pinBadge}
          {boundaryBadge}
          {povBadge}
          {continuityBadge}
          {intentBadge}
          {!reveal.typing && metaHoverable}
        </div>
      </div>
    )
  }

  if (chatStyle === 'document') {
    return (
      <div id={anchorId} data-rp-part="message" data-role={message.role} className={`group rounded-lg py-2 transition-colors duration-1000 ${highlightClass}`}>
        <span className={`${isUser ? 'text-accent' : 'text-text'}`}>{message.name}: </span>
        {pinBadge} {boundaryBadge} {povBadge} {explicitQualityBadge} {continuityBadge} {intentBadge} {intimacyActionBadge}{' '}
        {imageStrip}
        <span className="prose-rp whitespace-pre-wrap break-words text-sm leading-relaxed">
          {editing ? (
            textBlock
          ) : (
            <>
              {showFailedIndicator ? (
                <span className="inline-flex items-center gap-1.5 text-danger">
                  <TriangleAlert size={14} strokeWidth={2} className="shrink-0" />
                  Generation failed. Try regenerating below.
                </span>
              ) : (
                renderMessageText(displayText, regexScripts, sfx)
              )}
              {isStreaming && <span className="cursor-blink font-mono">▋</span>}
            </>
          )}
        </span>
        <span className={`ml-2 transition-opacity ${steering ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>{meta}</span>
      </div>
    )
  }

  if (chatStyle === 'bubbles') {
    return (
      <div
        id={anchorId} data-rp-part="message" data-role={message.role}
        className={`group flex gap-3 rounded-lg py-2 transition-colors duration-1000 ${highlightClass} ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      >
        <Avatar name={message.name} shape={avatarShape} dataUrl={avatarDataUrl} />
        <div className={`flex max-w-[75%] flex-col ${isUser ? 'items-end' : 'items-start'}`}>
          <div
            className={`rounded-xl px-3.5 py-2.5 ${
              isUser
                ? 'rp-bubble-user bg-msg-user text-accent-text'
                : 'bg-msg-char text-text border border-border'
            }`}
          >
            {imageStrip}
            {textBlock}
          </div>
          <div className="flex items-center gap-1.5">
            {pinBadge}
            {boundaryBadge}
            {povBadge}
            {explicitQualityBadge}
            {continuityBadge}
            {intentBadge}
            {intimacyActionBadge}
            {metaHoverable}
          </div>
        </div>
      </div>
    )
  }

  // flat (default): the character's lines run unboxed; yours sit in a hairline card
  return (
    <div
      id={anchorId}
      data-rp-part="message"
      data-role={message.role}
      className={`group flex gap-3 rounded-lg px-3 py-3 transition-colors duration-1000 ${isUser ? 'border border-border bg-bg-elevated' : ''} ${highlightClass}`}
    >
      <Avatar name={message.name} shape={avatarShape} dataUrl={avatarDataUrl} />
      <div className="flex-1 min-w-0">
        <div className="mb-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-text">
          {message.name}
          {pinBadge}
          {boundaryBadge}
          {povBadge}
          {explicitQualityBadge}
          {continuityBadge}
          {intentBadge}
          {intimacyActionBadge}
        </div>
        {imageStrip}
        {textBlock}
        {metaHoverable}
      </div>
    </div>
  )
})
