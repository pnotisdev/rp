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
  getRelationshipTrack,
  isLiveScene,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import { countCharReplies } from '@/lib/dating/aftercare'
import { isIntimacySceneActive } from '@/lib/dating/intimacyScene'
import { triggeredCg } from '@/lib/vn/cgTrigger'
import { pickVariant } from '@/lib/vn/pickVariant'
import { MessageLog } from './MessageLog'
import { SakuraPetals } from './SakuraPetals'
import { LiveRapport } from './LiveRapport'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { parseSfxWordList } from '@/lib/text/messageSegments'
import { sfxConfigFor } from '@/lib/text/sfx'
import { resolveExpressionSprite } from '@/lib/vn/expressions'
import { currentOutfitFrom } from '@/lib/vn/outfits'
import { vnArtHint } from '@/lib/vn/artHint'

/**
 * Visual-novel presentation of a chat: full-bleed scene background, each cast member's sprite,
 * and one glass panel docked to the bottom edge carrying the dialogue, choices, and composer
 * together like a real VN's ADV box. The ordinary transcript is available as a collapsible log.
 */

// Petals only make sense outdoors.
const OUTDOOR_BACKGROUNDS = new Set(['park', 'forest', 'rooftop', 'city-street', 'beach'])

/** Horizontal width per cast slot; height is set separately so sprites of any source resolution normalize to the same on-screen height. */
function slotWidthClass(castSize: number): string {
  if (castSize <= 1) return 'basis-[62%] max-w-[460px]'
  if (castSize === 2) return 'basis-[47%] max-w-[370px]'
  return 'basis-[32%] max-w-[290px]'
}

/** Stable muted identity hue per speaker, used for group-scene nameplates/accents. Solo chats keep the usual relationship-pink instead. */
function nameplateHue(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** One cast member's sprite, split out so each can crossfade independently. The speaker stands full-height/colour with a floor-light; everyone else steps back, dimmed. */
function VNCharacterSprite({
  spriteUrl,
  name,
  hue,
  isActive,
  dim,
  slotClass,
  onClick,
}: {
  spriteUrl: string | undefined
  name: string
  /** Identity hue matching this speaker's nameplate. */
  hue: number
  isActive: boolean
  /** True for a non-speaking member of a 2+ cast. */
  dim: boolean
  slotClass: string
  /** Doubles as the "reply as" picker; omitted when turn policy isn't manual. */
  onClick?: () => void
}) {
  const { displaySrc, visible, fadeMs } = useSpriteCrossfade(spriteUrl)

  const inner = displaySrc ? (
    <img
      src={displaySrc}
      alt={name}
      className={`vn-sprite h-full w-full object-contain object-bottom transition-opacity ease-out ${
        visible ? 'opacity-100' : 'opacity-0'
      } ${isActive ? 'drop-shadow-2xl' : ''}`}
      style={{ transitionDuration: `${fadeMs}ms` }}
    />
  ) : (
    // No sprite/avatar yet — a standing placeholder: monogram pillar + name.
    <div className="relative flex h-full w-full items-end justify-center">
      <div
        className="relative flex h-[94%] w-full max-w-[150px] flex-col items-center rounded-t-[46%] pt-[16%] sm:max-w-[210px]"
        style={{ background: `linear-gradient(to bottom, hsl(${hue} 32% 52% / 0.3), hsl(${hue} 30% 42% / 0.12) 55%, transparent)` }}
      >
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full font-display text-lg text-white shadow-xl ring-1 ring-white/15 sm:h-20 sm:w-20 sm:text-2xl"
          style={{ backgroundColor: `hsl(${hue} 48% 50%)` }}
        >
          {initialsOf(name)}
        </span>
        <span className="mt-2.5 font-display text-[13px] text-white/75 sm:text-sm">{name}</span>
      </div>
    </div>
  )

  const showingPlaceholder = !displaySrc

  return (
    <div
      className={`relative flex shrink items-end justify-center transition-[transform,filter,opacity,height] duration-500 ease-out ${slotClass} ${
        isActive
          ? 'z-10 h-[93%]'
          : !dim
            ? 'z-0 h-[88%]'
            : showingPlaceholder
              ? 'z-0 h-[82%] scale-[0.96] opacity-75 [filter:brightness(0.78)_saturate(0.8)]'
              : 'z-0 h-[80%] scale-[0.95] [filter:brightness(0.5)_saturate(0.72)]'
      }`}
    >
      {isActive && dim && (
        // Floor-light under the speaker, only shown when there's someone else to contrast against.
        <div className="pointer-events-none absolute inset-x-[2%] bottom-0 -z-10 h-20 rounded-[50%] bg-white/20 blur-2xl" />
      )}
      {inner}
      {onClick && (
        <button
          type="button"
          onClick={onClick}
          title={`Reply as ${name}`}
          aria-label={`Reply as ${name}`}
          className="absolute inset-0 rounded-xl border-0 bg-transparent transition-[background-color,box-shadow] hover:bg-white/[0.04] hover:ring-2 hover:ring-white/40"
        />
      )}
    </div>
  )
}

interface VNStageProps {
  character?: Character
  persona?: Persona
  /** Other speakable characters in a group scene; the whole roster stands on stage, with the active speaker lit. */
  participantCharacters?: Character[]
  chat: Chat
  world?: WorldCard
  messages: StoredMessage[]
  streamingText: string
  generatingMessageId: string | null
  /** Message id to scroll to and flash; opens the log drawer if collapsed. */
  highlightedMessageId?: string | null
  onSwipe: (id: string, dir: 'left' | 'right') => void
  onRegenerate: (id: string) => void
  /** Mid-scene correction, reachable via the backlog drawer's MessageLog only. */
  onSteer: (id: string, steerText: string) => void
  onDelete: (id: string) => void
  onRewind: (id: string) => void
  onEdit: (id: string, text: string) => void
  onFork: (id: string) => void
  onTogglePin: (id: string) => void
  /** Lets the cast double as the "reply as" picker; omitted under any non-manual turn policy. */
  onSelectSpeaker?: (id: string | null) => void
  /** Icon toolbar rendered as a glass overlay, left of the log toggle. */
  topBarExtra?: ReactNode
  /** Mobile-only "back to chat list"; hidden at md and above. */
  onBack?: () => void
  /** "Original chat" jump-back link, shown only for forked chats. */
  parentChatLink?: ReactNode
  /** Next-move suggestion chips (variant="vn"), omitted when none. */
  choiceListSlot?: ReactNode
  /** "Background assists running" strip, omitted when nothing is running. */
  assistSlot?: ReactNode
  /** Message composer (variant="vn"), docked at the bottom of the glass panel. */
  composerSlot: ReactNode
}

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
  onSteer,
  onDelete,
  onRewind,
  onEdit,
  onFork,
  onTogglePin,
  onSelectSpeaker,
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

  // Opening the drawer and scrolling to the target are separate effects since the drawer must
  // mount before its content can be queried.
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
  // A failed generation keeps empty text (see useChatSession.ts); show a message instead of going blank.
  const displayText = isStreamingThis
    ? streamingText
    : lastCharMsg?.failed
      ? '⚠ Generation failed — try regenerating (⟲) from the log.'
      : lastCharMsg?.text || (messages.length === 0 ? 'Say hello to begin the scene…' : '')

  const activeSwipe = lastCharMsg?.activeSwipe ?? 0
  const scene = lastCharMsg?.swipeScenes?.[activeSwipe] ?? lastCharMsg?.scene
  const cast = character ? [character, ...(participantCharacters ?? [])] : (participantCharacters ?? [])
  // The Bond HUD follows whoever's actually speaking in a group scene, not always the primary.
  // Falls back to the primary if the stored speaker id isn't in the current cast (roster can
  // shrink after they last spoke).
  const rawActiveSpeakerId = lastCharMsg ? (lastCharMsg.speakerId ?? character?.id) : character?.id
  const activeSpeakerId = cast.some((m) => m.id === rawActiveSpeakerId) ? rawActiveSpeakerId : character?.id
  const activeTrack = activeSpeakerId ? getRelationshipTrack(chat, activeSpeakerId) : {}
  const affection = Math.max(0, Math.min(100, activeTrack.affection ?? 0))
  const warmth = computeWarmth(affection, getRelationshipStats(activeTrack))
  const relationshipStage = relationshipStageForWarmth(warmth, relationshipMilestonesFor(world?.relationshipThresholds))
  // Item 10: a gallery CG whose author-set trigger condition is met right now, surfaced full-bleed
  // in place of the ordinary background+sprite composition below.
  const activeCgSource = cast.find((m) => m.id === activeSpeakerId)
  const activeIntimacyScene = isIntimacySceneActive(activeTrack.intimacyScene, countCharReplies(messages))
    ? activeTrack.intimacyScene
    : undefined
  const triggeredCgEntry = triggeredCg(activeCgSource?.gallery, {
    affection,
    sceneFlags: chat.sceneFlags ?? [],
    intimacyPhase: activeIntimacyScene?.phase,
    lastCatalogActionId: lastUserMsg?.intimacyAction?.optionId,
    relationshipStage,
  })
  // Item 11: a stable pick across this CG's own variants, reseeded only when the message that surfaced it changes.
  const triggeredCgImageUrl = triggeredCgEntry
    ? pickVariant([triggeredCgEntry.imageUrl, ...(triggeredCgEntry.variants ?? [])].filter(Boolean), lastCharMsg?.id ?? triggeredCgEntry.id)
    : undefined
  const liveDateActive = isLiveScene(chat.activeEvent)
  const isHangoutEvent = chat.activeEvent?.kind === 'hangout'
  const expression = scene?.expression || 'neutral'
  // Sprite resolution degrades unlocked tag -> same-family expression -> avatar (see resolveExpressionSprite).
  // Outfits are sticky across turns, read from the last message that set one.
  const outfitId = currentOutfitFrom(messages)
  // Same stable-per-message seed as the CG pick above, so a sprite variant doesn't flicker mid-turn.
  const spriteVariantSeed = lastCharMsg?.id ?? 'no-message'
  // Everyone in the roster is shown at once (a two/three-shot); the active speaker gets the live
  // expression and full prominence, everyone else rests dimmed at neutral.
  const canPickSpeaker = !!onSelectSpeaker && cast.length > 1
  const isGroupScene = cast.length > 1
  const castMembers = cast.map((member) => {
    const isActive = member.id === activeSpeakerId
    // Non-active members gate their sprite/expression unlocks on their own affection, not the active speaker's.
    const memberAffection = isActive ? affection : Math.max(0, Math.min(100, getRelationshipTrack(chat, member.id).affection ?? 0))
    const variantOptions = { variants: member.spriteVariants, seed: spriteVariantSeed }
    const spriteUrl = isActive
      ? resolveExpressionSprite(member.sprites, member.spriteUnlocks, member.avatarDataUrl, expression, memberAffection, outfitId, variantOptions)
      : resolveExpressionSprite(member.sprites, member.spriteUnlocks, member.avatarDataUrl, 'neutral', memberAffection, undefined, variantOptions)
    return {
      id: member.id,
      name: member.card.name,
      avatarUrl: member.avatarDataUrl,
      hue: nameplateHue(member.id || member.card.name),
      spriteUrl,
      isActive,
      onClick: canPickSpeaker ? () => onSelectSpeaker!(member.id === character?.id ? null : member.id) : undefined,
    }
  })
  const slotClass = slotWidthClass(castMembers.length)
  const activeMember = castMembers.find((m) => m.isActive) ?? castMembers[0]
  const speakerName = lastCharMsg?.name ?? activeMember?.name ?? character?.card.name ?? ''
  // Group scenes get a per-speaker identity hue; solo chats keep the usual relationship-pink.
  const plateHue = activeMember?.hue ?? 320
  const plate = isGroupScene
    ? {
        bg: `hsl(${plateHue} 36% 24% / 0.94)`,
        name: `hsl(${plateHue} 82% 84%)`,
        edge: `hsl(${plateHue} 60% 56% / 0.55)`,
        chip: `hsl(${plateHue} 44% 44%)`,
      }
    : {
        bg: 'rgb(var(--c-romance) / 0.94)',
        name: 'rgb(var(--c-romance-text))',
        edge: 'rgb(var(--c-romance) / 0.45)',
        chip: 'rgb(var(--c-romance))',
      }
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

  // See vnArtHint; dismissal is per-character.
  const vnArtHintDismissed = useSettingsStore((s) => s.vnArtHintDismissed)
  const dismissVnArtHint = useSettingsStore((s) => s.dismissVnArtHint)
  const artHint = vnArtHint(character, world, vnArtHintDismissed)
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
      {triggeredCgEntry && triggeredCgImageUrl && (
        // Full-bleed CG in place of the ordinary background — sprites are skipped below while one's showing.
        <img key={triggeredCgEntry.id} src={triggeredCgImageUrl} alt={triggeredCgEntry.title} className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/35" />
      {/* Cinematic vignette rather than a flat scrim. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 80% 65% at 50% 40%, transparent 55%, rgb(0 0 0 / 0.32) 100%)' }}
      />
      {showPetals && <SakuraPetals />}

      {/* One flex row (not two absolute overlays) so the HUD card and toolbar don't collide on phones. */}
      <div className="absolute inset-x-4 top-4 z-20 flex items-start justify-between gap-3">
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
              <span className="shrink-0 uppercase tracking-wide text-white/70">
                {/* Named only when there's more than one cast member to disambiguate. */}
                Bond{isGroupScene ? ` · ${activeMember?.name ?? ''}` : ''}
              </span>
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
            onSteer={onSteer}
            onSwipe={onSwipe}
            onFork={onFork}
            onTogglePin={onTogglePin}
          />
        </div>
      ) : (
        <>
          {/* min-h floor keeps the sprite area from being squeezed to nothing on a short viewport. */}
          <div
            className={`relative z-0 flex min-h-[190px] flex-1 items-end justify-center px-4 sm:px-6 ${
              // Extra top padding for group scenes so the outer figure clears the HUD card.
              isGroupScene ? 'pt-8 sm:pt-14 md:pt-20' : 'pt-3 sm:pt-6 md:pt-10'
            }`}
          >
            {!triggeredCgEntry && artHint && character && (
              <div className="absolute inset-x-0 top-[26%] z-20 flex justify-center px-6">
                <div className="relative max-w-sm rounded-2xl border border-dashed border-white/25 bg-black/45 px-5 py-4 text-center text-[12px] leading-relaxed text-white/80 backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => dismissVnArtHint(character.id)}
                    aria-label="Dismiss VN setup hint"
                    className="absolute right-1.5 top-1.5 text-white/45 transition-colors hover:text-white/90"
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                  <p className="pr-3">{artHint}</p>
                </div>
              </div>
            )}
            {/* h-full is required for each slot's h-[NN%] to resolve against a definite height. Skipped while a CG is showing full-bleed — sprites composited over unrelated CG art would look wrong. */}
            {!triggeredCgEntry && (
            <div className="flex h-full w-full items-end justify-center gap-2 sm:gap-5">
              {castMembers.map((m) => (
                <VNCharacterSprite
                  key={m.id}
                  spriteUrl={m.spriteUrl}
                  name={m.name}
                  hue={m.hue}
                  isActive={m.isActive}
                  dim={isGroupScene && !m.isActive}
                  slotClass={slotClass}
                  onClick={m.onClick}
                />
              ))}
            </div>
            )}
          </div>

          {lastUserMsg && (
            // mb-5 keeps the bubble clear of the speaker nameplate overlapping the panel below.
            <div className="relative z-10 mx-4 mb-5 flex flex-col items-end gap-1 sm:mx-6 sm:mb-3">
              <div className="vn-user-bubble prose-rp themed-shadow max-w-[74%] whitespace-pre-wrap rounded-2xl bg-msg-user px-3.5 py-2 text-sm text-accent-text">
                {renderMessageText(lastUserMsg.text, regexScripts)}
              </div>
              {lastUserMsg.intimacyAction && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/80"
                  title={`Sent from the Relationship panel's Unlocks tab (${lastUserMsg.intimacyAction.category.replace('_', ' ')}): "${lastUserMsg.intimacyAction.label}"`}
                >
                  <Heart size={9} strokeWidth={2.25} className="shrink-0" />
                  {lastUserMsg.intimacyAction.label}
                </span>
              )}
            </div>
          )}

          {/* Docked flush to the bottom edge, full width, like a real VN textbox. */}
          <div
            className="group/vnpanel relative z-10 flex flex-col border-t border-white/10 bg-black/65 backdrop-blur-md"
            style={{ borderTopColor: plate.edge }}
          >
            {/* Speaker nameplate tab, overlapping the panel's top edge. */}
            <div
              className="absolute -top-9 left-3 z-20 flex items-center gap-2.5 rounded-t-xl rounded-br-xl py-2 pl-2 pr-4 backdrop-blur-md sm:left-5"
              style={{ backgroundColor: plate.bg, boxShadow: `inset 0 1px 0 ${plate.edge}, 0 10px 22px -10px rgb(0 0 0 / 0.6)` }}
            >
              {activeMember?.avatarUrl ? (
                <img src={activeMember.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover ring-1 ring-white/25" />
              ) : (
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-display text-white shadow-inner ring-1 ring-white/15"
                  style={{ backgroundColor: plate.chip }}
                >
                  {initialsOf(speakerName)}
                </span>
              )}
              <span className="font-display text-[15px] font-semibold leading-none" style={{ color: plate.name }}>
                {speakerName}
              </span>
            </div>
            {/* Utility controls recede to near-invisible at rest, appear on hover/focus. */}
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
            {/* Capped height, not left to grow with reply length — scrolls in place instead. */}
            <div className="max-h-[22vh] overflow-y-auto px-4 pb-3 pt-1.5 sm:max-h-[26vh] sm:px-6">
              <p
                className="vn-dialogue whitespace-pre-wrap text-[15px] leading-relaxed text-white/95"
                style={{ textShadow: '0 1px 3px rgb(0 0 0 / 0.5)' }}
              >
                {renderMessageText(displayText, regexScripts, dialogueSfx)}
                {isStreamingThis && <span className="cursor-blink font-mono">▋</span>}
              </p>
            </div>
            {/* Same capped-height treatment as the dialogue box above. */}
            {choiceListSlot && (
              <div className="max-h-[15vh] overflow-y-auto border-t border-white/10 px-3 pb-2.5 pt-2.5 sm:px-5">{choiceListSlot}</div>
            )}
            {assistSlot}
            <div className="border-t border-white/10 p-2.5 sm:px-4">{composerSlot}</div>
          </div>
        </>
      )}
    </div>
  )
}
