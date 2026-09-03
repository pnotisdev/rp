import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, GitFork, Heart, History, RotateCcw, Star, X } from 'lucide-react'
import type { Character } from '@/lib/characters/cardSpec'
import type { Chat, Persona, StoredMessage, WorldCard } from '@/lib/types'
import { placeholderGradient } from '@/lib/vn/placeholder'
import { scrollToMessage } from '@/lib/scrollToMessage'
import { renderMessageText } from '@/lib/text/messageText'
import {
  computeWarmth,
  formatRelationshipStage,
  getRelationshipStats,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import { MessageLog } from './MessageLog'
import { SakuraPetals } from './SakuraPetals'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

const SPRITE_FADE_MS = 200

/** Falling petals only make sense for scenes actually outdoors — never indoors (kitchen, office, a bedroom). */
const OUTDOOR_BACKGROUNDS = new Set(['park', 'forest', 'rooftop', 'city-street', 'beach'])

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
  /**
   * VN mode folds the app's own chrome into the scene itself, rather than framing it with a
   * separate white toolbar — these render as glass overlays. `topBarExtra` is the icon toolbar
   * (relationship/event/objective/etc + the connection dot), placed left of the log toggle.
   */
  topBarExtra?: ReactNode
  /** Small "original chat" jump-back link — only meaningful when this chat was forked. */
  parentChatLink?: ReactNode
  /** The next-move suggestion chips for the current turn, pre-built with variant="vn" — omitted when there are none. */
  choiceListSlot?: ReactNode
  /** A thin "background assists running" strip, pre-built — omitted when nothing is running. */
  assistSlot?: ReactNode
  /** The message composer, pre-built with variant="vn" — docked at the very bottom of the same glass panel as the dialogue text. */
  composerSlot: ReactNode
}

/**
 * Visual-novel presentation: full-bleed scene background, the character's sprite for whatever
 * expression the model tagged its reply with, and a single glass panel docked to the bottom edge
 * — carrying the dialogue, the next-move choices, and the composer as one continuous textbox,
 * the way a real VN's ADV box does, rather than three separate app-chrome widgets stacked below
 * the scene. The ordinary scrolling transcript is available as a collapsible backlog.
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
  topBarExtra,
  parentChatLink,
  choiceListSlot,
  assistSlot,
  composerSlot,
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
  // Failed-generation messages keep empty text (see useChatSession.ts) rather than an error string
  // baked into the dialogue — shown here instead, so VN mode doesn't just go silently blank.
  const displayText = isStreamingThis
    ? streamingText
    : lastCharMsg?.failed
      ? '⚠ Generation failed — try regenerating (⟲) from the log.'
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
  const personaName = persona?.name
  const reducedMotion = useSettingsStore((s) => s.reducedMotion)
  const regexScripts = useSettingsStore((s) => s.regexScripts)
  const showPetals = !reducedMotion && !!sceneBackground && OUTDOOR_BACKGROUNDS.has(sceneBackground)

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div className="absolute inset-0 transition-[background] duration-500" style={bgStyle} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/35" />
      {/* A cinematic vignette rather than a flat scrim — corners recede, the character stays lit. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 80% 65% at 50% 40%, transparent 55%, rgb(0 0 0 / 0.32) 100%)' }}
      />
      {showPetals && <SakuraPetals />}

      <div className="absolute right-4 top-4 z-20 flex h-9 items-center gap-1 rounded-full bg-black/40 pl-1 pr-1 backdrop-blur-sm">
        {topBarExtra}
        <span className="h-4 w-px bg-white/15" />
        <button
          onClick={() => setShowLog((v) => !v)}
          title={showLog ? 'Close log' : 'Open log'}
          aria-label={showLog ? 'Close log' : 'Open log'}
          className="flex h-7 items-center gap-1.5 rounded-full pl-2 pr-3 text-xs text-white/85 transition-colors hover:bg-white/15 hover:text-white"
        >
          {showLog ? <X size={14} strokeWidth={2} /> : <History size={14} strokeWidth={2} />}
          {showLog ? 'Close' : 'Log'}
        </button>
      </div>

      {/* One cohesive HUD card — persona, bond, and the active event as internal sections
          divided by hairlines, rather than three separate chiclets stacked with gaps. */}
      <div className="absolute left-4 top-4 z-20 max-w-[65%] overflow-hidden rounded-xl bg-black/40 text-white backdrop-blur-sm">
        {(personaName || parentChatLink) && (
          <div className="flex items-center gap-2 px-3 pb-1.5 pt-2 text-[11px] text-white/70">
            {personaName && <span className="truncate">as {personaName}</span>}
            {parentChatLink}
          </div>
        )}
        <div className={`px-3 py-2 text-xs ${personaName || parentChatLink ? 'border-t border-white/10' : ''}`}>
          <div className="mb-1 flex items-center gap-1.5">
            <Heart size={11} strokeWidth={2.25} className="text-romance" fill="currentColor" fillOpacity={0.4} />
            <span className="uppercase tracking-wide text-white/70">Bond</span>
            <span className="font-semibold capitalize text-romance">{formatRelationshipStage(relationshipStage)}</span>
            <span className="text-white/90">{warmth}</span>
          </div>
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-romance transition-[width] duration-500" style={{ width: `${warmth}%` }} />
          </div>
        </div>
        {chat.activeEvent?.title && (
          <div className="flex items-center gap-1.5 truncate border-t border-white/10 px-3 py-1.5 text-xs">
            <span className="uppercase tracking-wide text-white/60">Event</span>
            <span className="truncate text-white/90">{chat.activeEvent.title}</span>
          </div>
        )}
      </div>

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
          {/* min-h-[190px] (rather than min-h-0) both overrides the flex default of
              min-height:auto — without which this flex-1 child refuses to shrink below the
              sprite's natural size on a short viewport, silently clipped by overflow-hidden
              instead of scaling down — AND gives the scene art a guaranteed floor, so the
              docked panel below never squeezes it down to near-nothing. */}
          <div className="relative z-0 flex min-h-[190px] flex-1 items-end justify-center pb-3">
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
            <div className="relative z-10 mx-4 mb-2 flex justify-end sm:mx-6">
              <div className="themed-shadow max-w-[80%] rounded-2xl bg-msg-user px-3.5 py-2 text-sm text-accent-text">
                {lastUserMsg.text}
              </div>
            </div>
          )}

          {/* Docked flush to the bottom edge, full width — the real-VN textbox placement the
              floating, margin-all-around card (the previous design) didn't have. Dialogue,
              choices, and the composer all live in this one continuous glass panel, divided by
              hairlines, instead of three separate app-chrome widgets stacked below the scene. */}
          <div className="relative z-10 flex flex-col border-t border-romance/30 bg-black/65 backdrop-blur-md">
            {/* The speaker's nameplate — a solid tab overlapping the panel's top edge, the way a
                real VN's ADV box tags who's talking, rather than a plain text line sharing the
                same row as the swipe/regenerate controls. Romance-tinted rather than the generic UI
                accent — the name tag is the one piece of VN chrome that's actually about the
                relationship, not a control. */}
            <span className="absolute -top-[1.15rem] left-4 rounded-lg bg-romance px-3.5 py-1.5 font-display text-sm font-medium leading-none text-romance-text shadow-md sm:left-6">
              {lastCharMsg?.name ?? character?.card.name}
            </span>
            <div className="flex items-center justify-end gap-1 px-3 pt-3 sm:px-5">
              {canSwipe && (
                <>
                  <span className="flex items-center gap-0.5 text-xs text-white/70">
                    <button
                      onClick={() => onSwipe(lastCharMsg!.id, 'left')}
                      disabled={(lastCharMsg!.activeSwipe ?? 0) === 0}
                      aria-label="Previous swipe"
                      className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10 disabled:opacity-30"
                    >
                      <ChevronLeft size={15} strokeWidth={2} />
                    </button>
                    <span className="px-0.5 tabular-nums">
                      {(lastCharMsg!.activeSwipe ?? 0) + 1}/{swipes.length}
                    </span>
                    <button
                      onClick={() => onSwipe(lastCharMsg!.id, 'right')}
                      aria-label="Next swipe"
                      className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10"
                    >
                      <ChevronRight size={15} strokeWidth={2} />
                    </button>
                  </span>
                  <span className="mx-1 h-4 w-px bg-white/15" />
                  <span className="flex items-center gap-0.5 text-xs text-white/70">
                    <button
                      onClick={() => onRegenerate(lastCharMsg!.id)}
                      title="Regenerate"
                      aria-label="Regenerate"
                      className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10"
                    >
                      <RotateCcw size={14} strokeWidth={2} />
                    </button>
                    <button
                      onClick={() => onFork(lastCharMsg!.id)}
                      title="Fork chat from here"
                      aria-label="Fork chat from here"
                      className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10"
                    >
                      <GitFork size={14} strokeWidth={2} />
                    </button>
                  </span>
                </>
              )}
              {lastCharMsg && !isStreamingThis && (
                <>
                  {canSwipe && <span className="mx-1 h-4 w-px bg-white/15" />}
                  <button
                    onClick={() => onTogglePin(lastCharMsg!.id)}
                    title={lastCharMsg.pinned ? 'Unpin' : 'Pin this moment'}
                    aria-label={lastCharMsg.pinned ? 'Unpin message' : 'Pin message'}
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors hover:bg-white/10 ${lastCharMsg.pinned ? 'text-accent' : 'text-white/70'}`}
                  >
                    <Star size={14} strokeWidth={2} fill={lastCharMsg.pinned ? 'currentColor' : 'none'} />
                  </button>
                </>
              )}
            </div>
            {/* Capped rather than left to grow with the reply's length — a long generation would
                otherwise balloon this panel and squeeze the sprite area above it down to nothing;
                a long reply now scrolls in place instead. */}
            <div className="max-h-[22vh] overflow-y-auto px-4 pb-3 pt-1.5 sm:max-h-[26vh] sm:px-6">
              <p
                className="vn-dialogue whitespace-pre-wrap text-[15px] leading-relaxed text-white/95"
                style={{ textShadow: '0 1px 3px rgb(0 0 0 / 0.5)' }}
              >
                {renderMessageText(displayText, regexScripts)}
                {isStreamingThis && <span className="cursor-blink font-mono">▋</span>}
              </p>
            </div>
            {choiceListSlot && <div className="border-t border-white/10 px-3 pt-2.5 sm:px-5">{choiceListSlot}</div>}
            {assistSlot}
            <div className="border-t border-white/10 p-2.5 sm:px-4">{composerSlot}</div>
          </div>
        </>
      )}
    </div>
  )
}
