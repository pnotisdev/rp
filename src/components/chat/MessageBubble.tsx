import { useState } from 'react'
import { ChevronLeft, ChevronRight, GitFork, History, RotateCcw, Star, TriangleAlert, X } from 'lucide-react'
import type { StoredMessage } from '@/lib/types'
import { useSettingsStore, type AvatarShape } from '@/lib/store/useSettingsStore'
import { messageAnchorId } from '@/lib/scrollToMessage'
import { renderMessageText } from '@/lib/text/messageText'
import { confirmDialog } from '@/lib/store/useConfirmStore'

function avatarClass(shape: AvatarShape): string {
  switch (shape) {
    case 'circle':
      return 'rounded-full'
    case 'square':
      return 'rounded-none'
    case 'rectangle':
      return 'rounded-md w-9 h-12'
    case 'rounded':
    default:
      return 'rounded-xl'
  }
}

function Avatar({ name, shape, dataUrl }: { name: string; shape: AvatarShape; dataUrl?: string }) {
  const base = `flex h-9 w-9 shrink-0 items-center justify-center bg-bg-sunken text-xs font-semibold text-text-muted overflow-hidden ${avatarClass(shape)}`
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
  onEdit: (text: string) => void
  onDelete: () => void
  onRewind: () => void
  onRegenerate: () => void
  onSwipe: (dir: 'left' | 'right') => void
  onFork: () => void
  onTogglePin: () => void
}

export function MessageBubble({
  message,
  avatarDataUrl,
  isStreaming,
  streamingText,
  isHighlighted,
  onEdit,
  onDelete,
  onRewind,
  onRegenerate,
  onSwipe,
  onFork,
  onTogglePin,
}: MessageBubbleProps) {
  const chatStyle = useSettingsStore((s) => s.chatStyle)
  const avatarShape = useSettingsStore((s) => s.avatarShape)
  const showTimestamps = useSettingsStore((s) => s.showTimestamps)
  const showTokenCounts = useSettingsStore((s) => s.showTokenCounts)
  const clickToEdit = useSettingsStore((s) => s.clickToEdit)
  const regexScripts = useSettingsStore((s) => s.regexScripts)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.text)

  const isUser = message.role === 'user'
  const displayText = isStreaming ? streamingText ?? '' : message.text
  const swipes = message.swipes ?? []
  const canSwipe = !isUser && swipes.length > 0 && !isStreaming
  // Text stays empty on a failed generation — see `useChatSession.ts` — rather than persisting an
  // error string as the character's actual dialogue, which would otherwise get fed back into
  // every future prompt. The failure itself is shown here, driven by the flag, not by content.
  const showFailedIndicator = !isUser && message.failed && !isStreaming

  const startEdit = () => {
    if (!clickToEdit || isStreaming) return
    setDraft(message.text)
    setEditing(true)
  }
  const commitEdit = () => {
    setEditing(false)
    if (draft !== message.text) onEdit(draft)
  }

  const imageStrip = message.images?.length ? (
    <div className="mb-1.5 flex flex-wrap gap-2">
      {message.images.map((src, i) => (
        <img key={i} src={src} alt="attachment" className="h-24 w-24 rounded-lg object-cover" />
      ))}
    </div>
  ) : null

  const textBlock = editing ? (
    <textarea
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit()
        if (e.key === 'Escape') setEditing(false)
      }}
      className="w-full resize-none rounded-xl bg-bg-sunken p-2.5 text-sm text-text outline-none ring-1 ring-accent/40"
      rows={Math.min(12, Math.max(2, draft.split('\n').length))}
    />
  ) : (
    <div
      onClick={startEdit}
      className={`prose-rp whitespace-pre-wrap break-words text-sm leading-relaxed ${clickToEdit ? 'cursor-text' : ''}`}
    >
      {showFailedIndicator ? (
        <span className="flex items-center gap-1.5 text-danger">
          <TriangleAlert size={14} strokeWidth={2} className="shrink-0" />
          Generation failed — try regenerating below.
        </span>
      ) : (
        renderMessageText(displayText, regexScripts)
      )}
      {isStreaming && <span className="cursor-blink font-mono">▋</span>}
    </div>
  )

  const meta = (
    <div className="flex items-center gap-0.5 text-[11px] text-text-muted">
      {showTimestamps && <span className="mr-1.5">{new Date(message.createdAt).toLocaleTimeString()}</span>}
      {showTokenCounts && message.tokenCount ? <span className="mr-1.5">{message.tokenCount} tok</span> : null}
      {canSwipe && (
        <span className="mr-1 flex items-center gap-0.5">
          <button
            onClick={() => onSwipe('left')}
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
            onClick={() => onSwipe('right')}
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
            onClick={onTogglePin}
            className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-bg-sunken ${message.pinned ? 'text-accent' : 'hover:text-text'}`}
            title={message.pinned ? 'Unpin' : 'Pin this moment'}
            aria-label={message.pinned ? 'Unpin message' : 'Pin message'}
          >
            <Star size={13} strokeWidth={2} fill={message.pinned ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={onRegenerate}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-bg-sunken hover:text-text"
            title="Regenerate"
            aria-label="Regenerate"
          >
            <RotateCcw size={13} strokeWidth={2} />
          </button>
          <button
            onClick={onFork}
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
              if (ok) onRewind()
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-bg-sunken hover:text-danger"
            title="Rewind to here (delete this and everything after)"
            aria-label="Rewind to here — delete this message and everything after it"
          >
            <History size={13} strokeWidth={2} />
          </button>
          <button
            onClick={onDelete}
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
  // Meta (timestamp, regenerate/delete, swipe) only appears on hover — keeps the resting
  // conversation calm and free of per-line chrome, matching the reference screens.
  const metaHoverable = <div className="mt-1 h-6 opacity-0 transition-opacity group-hover:opacity-100">{meta}</div>
  // Unlike the rest of `meta`, a pin needs to stay visible at rest — otherwise there's no way to
  // spot favorited moments while scrolling without hovering every single bubble.
  const pinBadge = message.pinned ? (
    <span className="inline-flex text-accent" title="Pinned">
      <Star size={12} strokeWidth={2} fill="currentColor" />
    </span>
  ) : null
  const anchorId = messageAnchorId(message.id)
  const highlightClass = isHighlighted ? 'bg-accent/10' : ''

  if (chatStyle === 'document') {
    return (
      <div id={anchorId} className={`group rounded-lg py-2 transition-colors duration-1000 ${highlightClass}`}>
        <span className={`font-display ${isUser ? 'text-accent' : 'text-text'}`}>{message.name}: </span>
        {pinBadge}{' '}
        {imageStrip}
        <span className="prose-rp whitespace-pre-wrap break-words text-sm leading-relaxed">
          {editing ? (
            textBlock
          ) : (
            <>
              {showFailedIndicator ? (
                <span className="inline-flex items-center gap-1.5 text-danger">
                  <TriangleAlert size={14} strokeWidth={2} className="shrink-0" />
                  Generation failed — try regenerating below.
                </span>
              ) : (
                renderMessageText(displayText, regexScripts)
              )}
              {isStreaming && <span className="cursor-blink font-mono">▋</span>}
            </>
          )}
        </span>
        <span className="ml-2 opacity-0 transition-opacity group-hover:opacity-100">{meta}</span>
      </div>
    )
  }

  if (chatStyle === 'bubbles') {
    return (
      <div
        id={anchorId}
        className={`group flex gap-3 rounded-lg py-2 transition-colors duration-1000 ${highlightClass} ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      >
        <Avatar name={message.name} shape={avatarShape} dataUrl={avatarDataUrl} />
        <div className={`flex max-w-[75%] flex-col ${isUser ? 'items-end' : 'items-start'}`}>
          <div
            className={`themed-shadow rounded-2xl px-3.5 py-2.5 ${
              isUser ? 'bg-msg-user text-accent-text rounded-tr-sm' : 'bg-msg-char text-text rounded-tl-sm'
            }`}
          >
            {imageStrip}
            {textBlock}
          </div>
          <div className="flex items-center gap-1.5">
            {pinBadge}
            {metaHoverable}
          </div>
        </div>
      </div>
    )
  }

  // flat (default): log-like, full width, no dividers — just generous vertical rhythm
  return (
    <div id={anchorId} className={`group flex gap-3 rounded-lg py-3.5 transition-colors duration-1000 ${highlightClass}`}>
      <Avatar name={message.name} shape={avatarShape} dataUrl={avatarDataUrl} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-display text-text">
          {message.name}
          {pinBadge}
        </div>
        {imageStrip}
        {textBlock}
        {metaHoverable}
      </div>
    </div>
  )
}
