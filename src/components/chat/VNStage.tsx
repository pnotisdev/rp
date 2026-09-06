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
import { MessageLog } from './MessageLog'
import { SakuraPetals } from './SakuraPetals'
import { LiveRapport } from './LiveRapport'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { parseSfxWordList } from '@/lib/text/messageSegments'
import { sfxConfigFor } from '@/lib/text/sfx'
import { resolveExpressionSprite } from '@/lib/vn/expressions'
import { currentOutfitFrom } from '@/lib/vn/outfits'
import { vnArtHint } from '@/lib/vn/artHint'

/** Falling petals only make sense for scenes actually outdoors — never indoors (kitchen, office, a bedroom). */
const OUTDOOR_BACKGROUNDS = new Set(['park', 'forest', 'rooftop', 'city-street', 'beach'])

/**
 * Horizontal room each cast member's slot gets. Every slot is also given an explicit percentage
 * height by `VNCharacterSprite` (taller for the speaker), so a sprite is normalised to a
 * consistent on-screen height regardless of its source resolution — `object-contain` does the
 * fitting, so a 64px avatar and a 1216px sprite now stand roughly the same height instead of the
 * low-res one rendering as a thumbnail. The `max-w` caps keep a solo portrait from ballooning on
 * a wide monitor and a three-shot's figures from drifting apart; `basis` + `shrink` share the row.
 */
function slotWidthClass(castSize: number): string {
  if (castSize <= 1) return 'basis-[62%] max-w-[460px]'
  if (castSize === 2) return 'basis-[47%] max-w-[370px]'
  return 'basis-[32%] max-w-[290px]'
}

/** A stable, deliberately muted identity hue for a group scene's nameplate + slot accents — the
 *  classic VN "each speaker has their own name colour" cue. Solo chats never call this: their one
 *  nameplate keeps the relationship-pink it has always used, since there's no one to disambiguate
 *  from. Same tiny string hash as `placeholderGradient`. */
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

/**
 * One member of a group scene's "cast" — extracted so each character's sprite crossfades on its
 * own (`useSpriteCrossfade` can't be called a variable number of times from `VNStage` itself,
 * whose cast size changes with the roster). A solo scene is just a cast of one, so this is also
 * the only sprite-rendering path now — no separate single-character branch to keep in sync.
 *
 * Who's talking is carried three ways at once, because a single cue kept reading as broken: the
 * speaker stands at full height and full colour with a soft floor-light; everyone else is pushed
 * back a step (`scale`) and dropped to a dim, desaturated near-silhouette. In a solo scene the one
 * member is always "the speaker", so none of the dimming applies.
 */
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
  /** Identity hue for the monogram placeholder + floor-light — matches this speaker's nameplate. */
  hue: number
  isActive: boolean
  /** Darken + step back: true only for a non-speaking member of a 2+ cast. */
  dim: boolean
  slotClass: string
  /** Doubles a group scene's cast as the "reply as" picker — omitted (turn policy isn't manual, or there's nobody else to pick) leaves the sprite inert. */
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
    // No sprite and no avatar drawn for this character yet — a calm standing "presence": a soft
    // pillar with a monogram where the head would be and the name at its base, so a mixed-art
    // group scene still composes as two figures rather than one real portrait beside an empty gap.
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
              ? // a dimmed placeholder is already abstract — just nudge it back
                'z-0 h-[82%] scale-[0.96] opacity-75 [filter:brightness(0.78)_saturate(0.8)]'
              : // a non-speaking sprite steps back into shadow but stays readable as themselves —
                // real ADV scenes recess the listener, they don't black them out
                'z-0 h-[80%] scale-[0.95] [filter:brightness(0.5)_saturate(0.72)]'
      }`}
    >
      {isActive && dim && (
        // A soft floor-light under the speaker — only when there's someone else on stage to be
        // told apart from. Sits behind the sprite (`-z-10`) so it reads as light, not a halo.
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
  /** Other characters able to speak in this chat (group scenes) — the whole roster stands on
   *  stage at once, with the turn's actual speaker (`activeSpeakerId` below) lit and named while
   *  the rest recede; the VN-art-hint nag still checks the primary only, since "the relationship"
   *  a dating-sim chat tracks is theirs (the Bond HUD does follow the active speaker). */
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
  /** Item 4's mid-scene correction — only reaches a `MessageBubble` via the backlog drawer's `MessageLog`; the VN dialogue box's own inline regenerate/swipe row (below) stays as-is. */
  onSteer: (id: string, steerText: string) => void
  onDelete: (id: string) => void
  onRewind: (id: string) => void
  onEdit: (id: string, text: string) => void
  onFork: (id: string) => void
  onTogglePin: (id: string) => void
  /**
   * Lets a group scene's cast double as the "reply as" picker — click whoever should speak next
   * instead of only the composer's dropdown. Omitted (as it is under any turn policy but manual)
   * makes every sprite inert: a scene that's deciding automatically has nothing for a click to
   * mean, the same reasoning the composer's own picker gives way to a read-only hint for.
   */
  onSelectSpeaker?: (id: string | null) => void
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
  // Cast computed here (ahead of the Bond calc below, not just the sprite row further down) so
  // `activeSpeakerId` can be validated against who's actually still in the scene.
  const cast = character ? [character, ...(participantCharacters ?? [])] : (participantCharacters ?? [])
  // In a group scene the Bond card now follows whoever's actually speaking, not always the
  // primary — gifting a participant updates *their* track (`RelationshipPanel` already has a tab
  // per cast member for this), and a HUD that never budged from the primary's own number would
  // just be showing a stat nothing currently on screen changed. Naming who it's for once there's
  // someone else it could be read as belongs to the header render below, not this calc.
  //
  // Falls back to the primary when the raw id isn't actually in the current cast, not only when
  // it's nullish — the roster can shrink out from under an old message (the new "Who's in this
  // scene" picker in `ScenePanel.tsx` lets a participant be removed after they last spoke), and
  // without this fallback nobody would match, leaving every sprite in the dimmed "not speaking"
  // state and the header below rendering a dangling "Bond · " with no name after it.
  const rawActiveSpeakerId = lastCharMsg ? (lastCharMsg.speakerId ?? character?.id) : character?.id
  const activeSpeakerId = cast.some((m) => m.id === rawActiveSpeakerId) ? rawActiveSpeakerId : character?.id
  const activeTrack = activeSpeakerId ? getRelationshipTrack(chat, activeSpeakerId) : {}
  const affection = Math.max(0, Math.min(100, activeTrack.affection ?? 0))
  const warmth = computeWarmth(affection, getRelationshipStats(activeTrack))
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
  // A group scene now shows everyone actually in the roster at once — a two- or three-shot, the
  // way a real VN holds a conversation — rather than one sprite hard-cutting to whoever spoke
  // last (confirmed live as a real gap: Kestrel's whole turn used to render under Sumire's
  // portrait, and even once that was fixed to show the right character, only one face at a time
  // ever showed at all). The turn's actual speaker still gets the live expression tag and full
  // prominence; everyone else in the scene rests at a calm neutral, slightly dimmed, so the
  // "who's talking right now" read stays clear without anyone vanishing between their own turns.
  const canPickSpeaker = !!onSelectSpeaker && cast.length > 1
  const isGroupScene = cast.length > 1
  const castMembers = cast.map((member) => {
    const isActive = member.id === activeSpeakerId
    // The active member's own affection is already computed above (`affection`); anyone else's
    // sprite/expression unlocks gate against *their own* progress, not whoever's currently talking.
    const memberAffection = isActive ? affection : Math.max(0, Math.min(100, getRelationshipTrack(chat, member.id).affection ?? 0))
    const spriteUrl = isActive
      ? resolveExpressionSprite(member.sprites, member.spriteUnlocks, member.avatarDataUrl, expression, memberAffection, outfitId)
      : resolveExpressionSprite(member.sprites, member.spriteUnlocks, member.avatarDataUrl, 'neutral', memberAffection)
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
  // The nameplate's palette. A group scene gives each speaker their own muted identity hue (the
  // strongest single "who's talking" cue there is — the plate changes colour the instant the turn
  // passes); a solo chat keeps the relationship-pink the plate has always used, since there's no
  // second speaker to tell it apart from.
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

  // "VN mode reads as broken before art exists" — see `vnArtHint`. Dismiss is per-character so a
  // deliberately art-less one stops nagging while a new one still gets told.
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
              <span className="shrink-0 uppercase tracking-wide text-white/70">
                {/* Named only once there's more than one cast member to disambiguate — this card
                    follows whoever's actually speaking in a group scene, so a bare "Bond" would be
                    ambiguous the moment it could mean either of two people. */}
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
          {/* min-h-[190px] (rather than min-h-0) both overrides the flex default of
              min-height:auto — without which this flex-1 child refuses to shrink below the
              sprite's natural size on a short viewport, silently clipped by overflow-hidden
              instead of scaling down — AND gives the scene art a guaranteed floor, so the
              docked panel below never squeezes it down to near-nothing. `pt-*` keeps the
              (bottom-anchored) sprites clear of the floating HUD card up top; the sprites
              themselves stand right down onto the dialogue panel's top edge below. */}
          <div
            className={`relative z-0 flex min-h-[190px] flex-1 items-end justify-center px-4 sm:px-6 ${
              // A two-shot's outer figure sits under the top-left HUD card unless the row is
              // pushed down; a solo portrait is centred and clears it with far less headroom.
              // Kept small on a phone, where vertical room between the HUD and the panel is scarce.
              isGroupScene ? 'pt-8 sm:pt-14 md:pt-20' : 'pt-3 sm:pt-6 md:pt-10'
            }`}
          >
            {artHint && character && (
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
            {/* `h-full` matters, not just decoration: a CSS percentage height only resolves against
                a containing block with a *definite* height, and a plain content-sized flex div
                doesn't count as one. The parent above *is* definite (`flex-1` in a bounded column
                layout), so `h-full` here is what lets each slot's `h-[NN%]` resolve — and that
                per-slot percentage is what normalises every sprite to a consistent height. */}
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
          </div>

          {lastUserMsg && (
            // `mb-5` keeps the bubble clear of the speaker nameplate that overlaps the panel's top
            // edge just below — without it a long (wrapped) player line renders behind the plate.
            <div className="relative z-10 mx-4 mb-5 flex justify-end sm:mx-6 sm:mb-3">
              <div className="vn-user-bubble prose-rp themed-shadow max-w-[74%] whitespace-pre-wrap rounded-2xl bg-msg-user px-3.5 py-2 text-sm text-accent-text">
                {renderMessageText(lastUserMsg.text, regexScripts)}
              </div>
            </div>
          )}

          {/* Docked flush to the bottom edge, full width — the real-VN textbox placement the
              floating, margin-all-around card (the previous design) didn't have. Dialogue,
              choices, and the composer all live in this one continuous glass panel, divided by
              hairlines, instead of three separate app-chrome widgets stacked below the scene. */}
          <div
            className="group/vnpanel relative z-10 flex flex-col border-t border-white/10 bg-black/65 backdrop-blur-md"
            style={{ borderTopColor: plate.edge }}
          >
            {/* The speaker's nameplate — a tab overlapping the panel's top edge, the way a real
                VN's ADV box tags who's talking, rather than a plain text line sharing the swipe/
                regenerate control row. Carries the speaker's face and, in a group scene, their own
                identity colour — so the single glance that reads "the dialogue box" also reads
                "and it's Kestrel talking now", without hunting for a sprite that may not be drawn. */}
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
