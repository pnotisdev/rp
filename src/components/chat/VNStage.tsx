import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, GitFork, Heart, History, RotateCcw, Star, X } from 'lucide-react'
import type { Character } from '@/lib/characters/cardSpec'
import type { Chat, Persona, StoredMessage, WorldCard } from '@/lib/types'
import { placeholderGradient } from '@/lib/vn/placeholder'
import { scrollToMessage } from '@/lib/scrollToMessage'
import { renderMessageText } from '@/lib/text/messageText'
import { useSpriteCrossfade } from '@/lib/hooks/useSpriteCrossfade'
import {
  computeWarmth,
  formatRelationshipStage,
  getRelationshipStats,
  isLiveScene,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import { MessageLog } from './MessageLog'
import { SakuraPetals } from './SakuraPetals'
import { LiveRapport } from './LiveRapport'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { parseSfxWordList } from '@/lib/text/messageSegments'
import { sfxConfigFor } from '@/lib/text/sfx'
import { resolveExpressionSprite } from '@/lib/vn/expressions'
import { currentOutfitFrom } from '@/lib/vn/outfits'

/** Falling petals only make sense for scenes actually outdoors — never indoors (kitchen, office, a bedroom). */
const OUTDOOR_BACKGROUNDS = new Set(['park', 'forest', 'rooftop', 'city-street', 'beach'])

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
  onRewind: (id: string) => void
  onEdit: (id: string, text: string) => void
  onFork: (id: string) => void
  onTogglePin: (id: string) => void
  /**
   * VN mode folds the app's own chrome into the scene itself, rather than framing it with a
   * separate white toolbar — these render as glass overlays. `topBarExtra` is the icon toolbar
   * (relationship/event/objective/etc + the connection dot), placed left of the log toggle.
   */
  topBarExtra?: ReactNode
  /** Mobile-only "back to chat list" — the chats panel is a full-screen overlay under `md`, so VN mode needs its own way back besides the desktop-only side panel. Hidden at `md` and above. */
  onBack?: () => void
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
  onRewind,
  onEdit,
  onFork,
  onTogglePin,
  topBarExtra,
  onBack,
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
  const liveDateActive = isLiveScene(chat.activeEvent)
  const isHangoutEvent = chat.activeEvent?.kind === 'hangout'
  const expression = scene?.expression || 'neutral'
  // Guaranteed coverage (section 10): an unlocked/missing exact tag falls through to a
  // same-family expression before the plain avatar, rather than hard-swapping to the avatar the
  // moment the exact tag isn't available — see `resolveExpressionSprite`'s own doc comment.
  // Outfits (`outfits.ts`) are sticky across turns — read from the last reply that actually set
  // one, not from this message's tag, so a model that stops repeating the field doesn't undress
  // anyone. Resolution degrades outfit art -> base art -> avatar, so a half-drawn outfit still
  // shows a real character.
  const outfitId = currentOutfitFrom(messages)
  const spriteUrl = resolveExpressionSprite(
    character?.sprites,
    character?.spriteUnlocks,
    character?.avatarDataUrl,
    expression,
    affection,
    outfitId,
  )
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
  const { displaySrc: displaySpriteUrl, visible: spriteVisible, fadeMs: spriteFadeMs } = useSpriteCrossfade(spriteUrl)
  const personaName = persona?.name
  const reducedMotion = useSettingsStore((s) => s.reducedMotion)
  const regexScripts = useSettingsStore((s) => s.regexScripts)
  const sfxEnabled = useSettingsStore((s) => s.sfxBursts)
  const sfxWordsSetting = useSettingsStore((s) => s.sfxWords)
  const dialogueSfx = lastCharMsg
    ? sfxConfigFor(lastCharMsg, {
        enabled: sfxEnabled,
        globalWords: parseSfxWordList(sfxWordsSetting),
        primary: character,
        participants: participantCharacters,
      })
    : undefined
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

      {/* HUD card and toolbar share one flex row rather than two independent `absolute` overlays —
          on a phone the two used to collide (the Bond card painting over the back button and the
          first toolbar icons). The card takes the slack and truncates; the toolbar never shrinks. */}
      <div className="absolute inset-x-4 top-4 z-20 flex items-start justify-between gap-3">
        {/* One cohesive HUD card — persona, bond, and the active event as internal sections
            divided by hairlines, rather than three separate chiclets stacked with gaps. */}
        <div className="min-w-0 overflow-hidden rounded-xl bg-black/40 text-white backdrop-blur-sm sm:max-w-[65%]">
          {(personaName || parentChatLink) && (
            <div className="flex items-center gap-2 px-3 pb-1.5 pt-2 text-[11px] text-white/70">
              {personaName && <span className="truncate">as {personaName}</span>}
              {parentChatLink}
            </div>
          )}
          <div className={`px-3 py-2 text-xs ${personaName || parentChatLink ? 'border-t border-white/10' : ''}`}>
            <div className="mb-1 flex min-w-0 items-center gap-1.5">
              <Heart size={11} strokeWidth={2.25} className="shrink-0 text-romance" fill="currentColor" fillOpacity={0.4} />
              <span className="shrink-0 uppercase tracking-wide text-white/70">Bond</span>
              <span className="truncate font-semibold capitalize text-romance">{formatRelationshipStage(relationshipStage)}</span>
              <span className="shrink-0 text-white/90">{warmth}</span>
            </div>
            <div className="h-1.5 w-28 max-w-full overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-romance transition-[width] duration-500" style={{ width: `${warmth}%` }} />
            </div>
          </div>
          {chat.activeEvent?.title && (
            <div className="flex items-center gap-1.5 truncate border-t border-white/10 px-3 py-1.5 text-xs">
              <span className="shrink-0 uppercase tracking-wide text-white/60">
                {liveDateActive ? (isHangoutEvent ? 'Hangout' : 'Date') : 'Event'}
              </span>
              <span className="truncate text-white/90">{chat.activeEvent.title}</span>
            </div>
          )}
          {liveDateActive && chat.rapport && (
            <div className="border-t border-white/10 px-3 py-1.5 text-xs">
              <LiveRapport read={chat.rapport} variant="vn" label={isHangoutEvent ? 'Live hangout' : 'Live date'} />
            </div>
          )}
        </div>

        <div className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-black/40 px-1 backdrop-blur-sm">
          {onBack && (
            <>
              <button
                onClick={onBack}
                title="Back to chats"
                aria-label="Back to chats"
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white md:hidden"
              >
                <ArrowLeft size={15} strokeWidth={2} />
              </button>
              <span className="h-4 w-px bg-white/15 md:hidden" />
            </>
          )}
          {topBarExtra}
          <span className="h-4 w-px bg-white/15" />
          <button
            onClick={() => setShowLog((v) => !v)}
            title={showLog ? 'Close log' : 'Open log'}
            aria-label={showLog ? 'Close log' : 'Open log'}
            className="flex h-7 items-center gap-1.5 rounded-full px-2 text-xs text-white/85 transition-colors hover:bg-white/15 hover:text-white sm:pr-3"
          >
            {showLog ? <X size={14} strokeWidth={2} /> : <History size={14} strokeWidth={2} />}
            <span className="hidden sm:inline">{showLog ? 'Close' : 'Log'}</span>
          </button>
        </div>
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
            onRewind={onRewind}
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
                style={{ transitionDuration: `${spriteFadeMs}ms` }}
              />
            )}
          </div>

          {lastUserMsg && (
            <div className="relative z-10 mx-4 mb-2 flex justify-end sm:mx-6">
              <div className="vn-user-bubble prose-rp themed-shadow max-w-[80%] whitespace-pre-wrap rounded-2xl bg-msg-user px-3.5 py-2 text-sm text-accent-text">
                {renderMessageText(lastUserMsg.text, regexScripts)}
              </div>
            </div>
          )}

          {/* Docked flush to the bottom edge, full width — the real-VN textbox placement the
              floating, margin-all-around card (the previous design) didn't have. Dialogue,
              choices, and the composer all live in this one continuous glass panel, divided by
              hairlines, instead of three separate app-chrome widgets stacked below the scene. */}
          <div className="group/vnpanel relative z-10 flex flex-col border-t border-romance/30 bg-black/65 backdrop-blur-md">
            {/* The speaker's nameplate — a solid tab overlapping the panel's top edge, the way a
                real VN's ADV box tags who's talking, rather than a plain text line sharing the
                same row as the swipe/regenerate controls. Romance-tinted rather than the generic UI
                accent — the name tag is the one piece of VN chrome that's actually about the
                relationship, not a control. */}
            <span className="absolute -top-[1.15rem] left-4 rounded-lg bg-romance px-3.5 py-1.5 font-display text-sm font-medium leading-none text-romance-text shadow-md sm:left-6">
              {lastCharMsg?.name ?? character?.card.name}
            </span>
            {/* Swipe/regen/fork/pin are utility, not scene — recede to near-invisible at rest and
                come back on hover or keyboard focus, so a settled scene reads as the art and the
                dialogue, not a control strip. */}
            <div className="flex items-center justify-end gap-1 px-3 pt-3 opacity-30 transition-opacity duration-200 focus-within:opacity-100 group-hover/vnpanel:opacity-100 sm:px-5">
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
                {renderMessageText(displayText, regexScripts, dialogueSfx)}
                {isStreamingThis && <span className="cursor-blink font-mono">▋</span>}
              </p>
            </div>
            {/* Capped the same way the dialogue box above is — three chips wrapping to two lines
                on a narrow phone screen was measured pushing the composer entirely below the
                viewport (its own `top` past `window.innerHeight`), making the app unable to send a
                message at all. A tall choice row now scrolls in place instead of growing the panel. */}
            {choiceListSlot && (
              <div className="max-h-[15vh] overflow-y-auto border-t border-white/10 px-3 pt-2.5 sm:px-5">{choiceListSlot}</div>
            )}
            {assistSlot}
            <div className="border-t border-white/10 p-2.5 sm:px-4">{composerSlot}</div>
          </div>
        </>
      )}
    </div>
  )
}
