import { useEffect, useRef, useState } from 'react'
import type { Character } from '@/lib/characters/cardSpec'
import type { Chat, Persona, StoredMessage, WorldCard } from '@/lib/types'
import { placeholderGradient } from '@/lib/vn/placeholder'
import { scrollToMessage } from '@/lib/scrollToMessage'
import {
  computeWarmth,
  formatRelationshipStage,
  getRelationshipStats,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import { MessageLog } from './MessageLog'

const SPRITE_FADE_MS = 200

/**
 * Swaps between expression sprites with a brief dip-to-transparent instead of a hard cut —
 * "outfit/pose layers" (a real layered sprite composition system) is a much bigger, separate
 * effort; this is just the crossfade half of that gap. Respects the app's reducedMotion setting
 * for free, since it crushes all CSS transition durations globally (see globals.css).
 */
function useSpriteCrossfade(src: string | undefined) {
  const [displaySrc, setDisplaySrc] = useState(src)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (src === displaySrc) return
    setVisible(false)
    const t = setTimeout(() => {
      setDisplaySrc(src)
      setVisible(true)
    }, SPRITE_FADE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  return { displaySrc, visible }
}

interface VNStageProps {
  character?: Character
  persona?: Persona
  /** Other characters able to speak in this chat (group scenes) — only threaded to the backlog log's avatar resolution; the VN sprite/expression stage itself stays keyed on the primary. */
  participantCharacters?: Character[]
  chat: Chat
  world?: WorldCard
  messages: StoredMessage[]
  streamingText: string
  generatingMessageId: string | null
  /** Message id to scroll to and briefly flash — opens the backlog drawer if it's collapsed. */
  highlightedMessageId?: string | null
  onSwipe: (id: string, dir: 'left' | 'right') => void
  onRegenerate: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (id: string, text: string) => void
  onFork: (id: string) => void
  onTogglePin: (id: string) => void
}

/**
 * Visual-novel presentation: full-bleed scene background, the character's sprite for
 * whatever expression the model tagged its reply with, and a bottom dialogue box —
 * with the ordinary scrolling transcript available as a collapsible backlog.
 */
export function VNStage({
  character,
  persona,
  participantCharacters,
  chat,
  world,
  messages,
  streamingText,
  generatingMessageId,
  highlightedMessageId,
  onSwipe,
  onRegenerate,
  onDelete,
  onEdit,
  onFork,
  onTogglePin,
}: VNStageProps) {
  const [showLog, setShowLog] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (showLog) logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [showLog])

  // A jump from search/the pinned panel opens the backlog drawer (if collapsed) and scrolls to
  // the target once it's actually mounted — deliberately separate effects since the drawer must
  // render before its content can be queried for the target message's anchor.
  useEffect(() => {
    if (highlightedMessageId) setShowLog(true)
  }, [highlightedMessageId])

  useEffect(() => {
    if (showLog && highlightedMessageId) {
      requestAnimationFrame(() => scrollToMessage(logRef.current, highlightedMessageId))
    }
  }, [showLog, highlightedMessageId])

  const lastCharMsg = [...messages].reverse().find((m) => m.role === 'char')
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  const isStreamingThis = !!lastCharMsg && generatingMessageId === lastCharMsg.id
  const displayText = isStreamingThis
    ? streamingText
    : lastCharMsg?.text || (messages.length === 0 ? 'Say hello to begin the scene…' : '')

  const activeSwipe = lastCharMsg?.activeSwipe ?? 0
  const scene = lastCharMsg?.swipeScenes?.[activeSwipe] ?? lastCharMsg?.scene
  const affection = Math.max(0, Math.min(100, chat.affection ?? 0))
  const warmth = computeWarmth(affection, getRelationshipStats(chat))
  const relationshipStage = relationshipStageForWarmth(warmth, relationshipMilestonesFor(world?.relationshipThresholds))
  const expression = scene?.expression || 'neutral'
  const spriteUnlocked = affection >= Number(character?.spriteUnlocks?.[expression] ?? 0)
  const spriteUrl = spriteUnlocked
    ? character?.sprites?.[expression] || character?.avatarDataUrl
    : character?.avatarDataUrl
  const sceneBackground = scene?.background ?? chat.activeEvent?.backgroundId
  const bgUnlocked = sceneBackground
    ? affection >= Number(world?.backgroundUnlocks?.[sceneBackground] ?? 0)
    : false
  const backgroundUrl = sceneBackground && bgUnlocked ? world?.backgrounds?.[sceneBackground] : undefined
  const bgStyle = backgroundUrl
    ? { backgroundImage: `url(${backgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: placeholderGradient(sceneBackground) }

  const swipes = lastCharMsg?.swipes ?? []
  const canSwipe = !!lastCharMsg && swipes.length > 0 && !isStreamingThis
  const { displaySrc: displaySpriteUrl, visible: spriteVisible } = useSpriteCrossfade(spriteUrl)

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div className="absolute inset-0 transition-[background] duration-500" style={bgStyle} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

      <button
        onClick={() => setShowLog((v) => !v)}
        className="absolute right-4 top-4 z-20 rounded-full bg-black/40 px-3 py-1.5 font-mono text-xs text-white backdrop-blur-sm transition-colors hover:bg-black/60"
      >
        {showLog ? 'Close log' : '☰ Log'}
      </button>
      <div className="absolute left-4 top-4 z-20 rounded-xl bg-black/40 px-3 py-2 text-xs text-white backdrop-blur-sm">
        <div className="mb-1 flex items-center gap-2">
          <span className="uppercase tracking-wide text-white/75">Bond</span>
          <span className="font-semibold capitalize text-accent">{formatRelationshipStage(relationshipStage)}</span>
          <span>{warmth}</span>
        </div>
        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${warmth}%` }} />
        </div>
      </div>

      {chat.activeEvent?.title && (
        <div className="absolute left-4 top-20 z-20 rounded-xl bg-black/40 px-3 py-1.5 text-xs text-white backdrop-blur-sm">
          Event: {chat.activeEvent.title}
        </div>
      )}

      {showLog ? (
        <div ref={logRef} className="relative z-10 flex-1 overflow-y-auto bg-bg/95 px-6 py-6 backdrop-blur">
          <MessageLog
            messages={messages}
            character={character}
            persona={persona}
            participantCharacters={participantCharacters}
            generatingMessageId={generatingMessageId}
            streamingText={streamingText}
            highlightedMessageId={highlightedMessageId}
            onEdit={onEdit}
            onDelete={onDelete}
            onRegenerate={onRegenerate}
            onSwipe={onSwipe}
            onFork={onFork}
            onTogglePin={onTogglePin}
          />
        </div>
      ) : (
        <>
          <div className="relative z-0 flex flex-1 items-end justify-center pb-4">
            {displaySpriteUrl && (
              <img
                src={displaySpriteUrl}
                alt={character?.card.name}
                className={`vn-sprite max-h-[85%] max-w-[70%] object-contain drop-shadow-2xl transition-opacity ease-out ${
                  spriteVisible ? 'opacity-100' : 'opacity-0'
                }`}
                style={{ transitionDuration: `${SPRITE_FADE_MS}ms` }}
              />
            )}
          </div>

          {lastUserMsg && (
            <div className="relative z-10 mx-4 mb-2 flex justify-end md:mx-8">
              <div className="themed-shadow max-w-[80%] rounded-2xl bg-msg-user px-3.5 py-2 text-sm text-accent-text">
                {lastUserMsg.text}
              </div>
            </div>
          )}

          <div className="relative z-10 mx-4 mb-4 rounded-2xl border border-white/10 bg-black/55 p-5 backdrop-blur-md md:mx-8">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-display text-accent">{lastCharMsg?.name ?? character?.card.name}</span>
              <span className="flex items-center gap-2 font-mono text-xs text-white/70">
                {canSwipe && (
                  <>
                    <button
                      onClick={() => onSwipe(lastCharMsg!.id, 'left')}
                      disabled={(lastCharMsg!.activeSwipe ?? 0) === 0}
                      className="disabled:opacity-30"
                      aria-label="Previous swipe"
                    >
                      ‹
                    </button>
                    <span>
                      {(lastCharMsg!.activeSwipe ?? 0) + 1}/{swipes.length}
                    </span>
                    <button onClick={() => onSwipe(lastCharMsg!.id, 'right')} aria-label="Next swipe">›</button>
                    <button onClick={() => onRegenerate(lastCharMsg!.id)} title="Regenerate" aria-label="Regenerate" className="ml-1">
                      ⟲
                    </button>
                    <button onClick={() => onFork(lastCharMsg!.id)} title="Fork chat from here" aria-label="Fork chat from here">
                      ⑂
                    </button>
                  </>
                )}
                {lastCharMsg && !isStreamingThis && (
                  <button
                    onClick={() => onTogglePin(lastCharMsg!.id)}
                    className={lastCharMsg.pinned ? 'text-accent' : ''}
                    title={lastCharMsg.pinned ? 'Unpin' : 'Pin this moment'}
                    aria-label={lastCharMsg.pinned ? 'Unpin message' : 'Pin message'}
                  >
                    {lastCharMsg.pinned ? '★' : '☆'}
                  </button>
                )}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/95">
              {displayText}
              {isStreamingThis && <span className="cursor-blink font-mono">▋</span>}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
