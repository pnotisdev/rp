import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  EyeOff,
  GitFork,
  Heart,
  History,
  Loader2,
  Play,
  RotateCcw,
  Star,
  Volume1,
  Volume2,
  X,
} from 'lucide-react'
import type { Character } from '@/lib/characters/cardSpec'
import type { ChoiceOption, Chat, Persona, StoredMessage, WorldCard } from '@/lib/types'
import { ChoiceList } from './ChoiceList'
import { VNCenteredChoices } from './VNCenteredChoices'
import { VNDialogueBox } from './VNDialogueBox'
import { sceneGradient } from '@/lib/vn/placeholder'
import { resolveSceneBackground } from '@/lib/vn/resolveBackground'
import { backgroundLabel } from '@/lib/vn/backgrounds'
import { scrollToMessage } from '@/lib/scrollToMessage'
import { renderMessageText } from '@/lib/text/messageText'
import { useSpriteCrossfade } from '@/lib/hooks/useSpriteCrossfade'
import { useTypewriterReveal } from '@/lib/hooks/useTypewriterReveal'
import {
  computeWarmth,
  formatRelationshipStage,
  getRelationshipStats,
  getRelationshipTrack,
  isLiveScene,
  relationshipMilestonesFor,
  findActiveIntimacyScene,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import { countCharReplies } from '@/lib/dating/aftercare'
import { isIntimacySceneActive } from '@/lib/dating/intimacyScene'
import type { IntimacyScene } from '@/lib/dating/intimacyScene'
import { isSceneParticipant } from '@/lib/dating/sceneParticipants'
import { getScenarioCatalog, scenarioById } from '@/lib/dating/scenarios'
import { SceneStateCard } from '@/components/chat/SceneStateCard'
import { StageLabel, StageMeter, StageRow } from '@/components/ui/Stage'
import { triggeredCg } from '@/lib/vn/cgTrigger'
import { pickVariant } from '@/lib/vn/pickVariant'
import { MessageLog } from './MessageLog'
import { SakuraPetals } from './SakuraPetals'
import { LiveRapport } from './LiveRapport'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { synthesizeSpeech } from '@/lib/voice/ttsProviders'
import { toSpeakableText } from '@/lib/voice/speakableText'
import { parseSfxWordList } from '@/lib/text/messageSegments'
import { sfxConfigFor } from '@/lib/text/sfx'
import { resolveExpressionSprite } from '@/lib/vn/expressions'
import { currentOutfitFrom } from '@/lib/vn/outfits'
import { vnArtHint } from '@/lib/vn/artHint'
import { getWorldTemplate } from '@/lib/world/worldTemplates'
import { isNightPhase } from '@/lib/world/calendar'

/**
 * Visual-novel presentation of a chat: full-bleed scene background, each cast member's sprite
 * standing at full height, and one floating glass dialogue box of fixed height over their feet.
 * The ordinary transcript is available as a collapsible log.
 *
 * The composition rule everything here follows: **the art is the subject, the UI is furniture.**
 * Only the dialogue lives inside the box; choices, quick replies, the assist strip and the
 * per-line utilities all float outside it, so the box's height is a constant and the scene behind
 * it never resizes turn to turn. Under `vnInputMode: 'inline'` the box is also where the player
 * writes — the same frame, in the same place, with the nameplate and the accent rail switched over
 * to their persona so it is never ambiguous whose line is being composed.
 */

// Petals only make sense outdoors.
const OUTDOOR_BACKGROUNDS = new Set([
  'park', 'forest', 'rooftop', 'city-street', 'beach',
  'school-rooftop', 'school-gate', 'school-courtyard', 'shrine', 'festival', 'fireworks-viewing', 'onsen',
])

/**
 * Horizontal width per cast slot; height is set separately so sprites of any source resolution
 * normalize to the same on-screen height. The cap matters more than it looks: `object-contain`
 * takes whichever of width/height binds first, so a narrow cap on a bust-cropped sprite (the common
 * case — most cards ship a portrait, not a full-body VN sprite) shrinks it vertically too and
 * leaves the head sitting low with dead scene above it.
 */
function slotWidthClass(castSize: number): string {
  if (castSize <= 1) return 'basis-[72%] max-w-[620px]'
  if (castSize === 2) return 'basis-[52%] max-w-[470px]'
  return 'basis-[35%] max-w-[350px]'
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
  phase,
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
  /** Sprite staging: a brief slide+fade the moment this member joins or leaves the roster. Unset once settled. */
  phase?: 'entering' | 'exiting'
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
          ? 'z-10 h-[96%]'
          : !dim
            ? 'z-0 h-[90%]'
            : showingPlaceholder
              ? 'z-0 h-[84%] scale-[0.96] opacity-75 [filter:brightness(0.78)_saturate(0.8)]'
              : 'z-0 h-[82%] scale-[0.95] [filter:brightness(0.5)_saturate(0.72)]'
      } ${phase === 'entering' ? 'vn-sprite-enter-anim' : phase === 'exiting' ? 'vn-sprite-exit-anim pointer-events-none' : ''}`}
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
  /** Quick-reply pills (variant="vn"), shown when there's no active AI-suggested choice — always
   *  docked regardless of `vnChoiceStyle`, since a casual quick reply isn't a real decision point. */
  choiceListSlot?: ReactNode
  /** AI-suggested choices — VNStage renders these itself (docked pills or a centered choice screen,
   *  per Settings → Appearance's `vnChoiceStyle`) rather than taking a pre-rendered node, since which
   *  one it picks is its own presentation call. Omitted when there's nothing to choose from. */
  activeChoiceData?: {
    choices: ChoiceOption[]
    onPick: (choice: ChoiceOption) => void
    onRefresh: () => void
    refreshing: boolean
  }
  /** "Background assists running" strip, omitted when nothing is running. */
  assistSlot?: ReactNode
  /** Message composer (variant="vn"). Under `vnInputMode: 'inline'` this is rendered *inside* the
   *  dialogue box while the player is writing; under 'docked' it sits in its own bar below it. */
  composerSlot: ReactNode
  /** Whether the composer currently holds text. Keeps the inline box open for a draft the player
   *  didn't type themselves (an impersonation suggestion, a prefilled intimacy action), which would
   *  otherwise be composed somewhere they can't see. */
  composerHasDraft?: boolean
  /** Off by default; the quick menu's Auto toggle. Once a reply finishes typing, waits a beat scaled
   *  to its length and calls `onAutoAdvanceFire` — real VN autoplay, so `ChatWindow` owns the actual
   *  "what to send" + safety-cap decision (never picks an AI-suggested choice, stops on a live date,
   *  a failed generation, chat switch, or its own turn/time cap). */
  autoAdvance?: boolean
  onToggleAutoAdvance?: () => void
  onAutoAdvanceFire?: () => void
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
  activeChoiceData,
  assistSlot,
  composerSlot,
  composerHasDraft = false,
  autoAdvance = false,
  onToggleAutoAdvance,
  onAutoAdvanceFire,
}: VNStageProps) {
  const [showLog, setShowLog] = useState(false)
  // Universal VN convention: hides everything but the background/sprites/CG, restored by clicking
  // anywhere on the scene (see the root `onClick` below) — same discoverability contract as every
  // other VN's hide-UI, so no on-screen hint is needed to find your way back.
  const [hideUI, setHideUI] = useState(false)
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
  // A failed generation leaves no real character line to show — fall back to the player's own last
  // line as "current" instead of putting an error banner in Sumire's mouth. Same textbox, same
  // nameplate slot, just attributed to whoever actually has something to say right now.
  const showUserAsCurrent = !!lastCharMsg?.failed && !isStreamingThis && !!lastUserMsg
  // A failed generation keeps empty text (see useChatSession.ts); show a message instead of going blank.
  const displayText = isStreamingThis
    ? streamingText
    : showUserAsCurrent
      ? lastUserMsg!.text
      : lastCharMsg?.failed
        ? '⚠ Generation failed. Try regenerating (⟲) from the log.'
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
  // Chat-wide, not off the active speaker's own track: a shared scene lives on its owner's
  // (`sceneParticipants.ts`), so reading `activeTrack` here would show nothing for anyone who joined
  // one. The speaker still has to actually be *in* it, since standing in the room is not being in it.
  const charRepliesNow = countCharReplies(messages)
  const liveScene = findActiveIntimacyScene(chat, (sc: IntimacyScene) => isIntimacySceneActive(sc, charRepliesNow))
  const activeIntimacyScene =
    liveScene && activeSpeakerId && isSceneParticipant(liveScene.scene, activeSpeakerId, liveScene.ownerId)
      ? liveScene.scene
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
  // CG reveal ceremony: a brief full-screen beat (see `.vn-cg-reveal` — the `key` below already
  // remounts the <img> per distinct CG, which is what makes the enter animation replay each time)
  // plus a one-time "new in Gallery" toast, fired the first time this component instance sees a
  // given CG id trigger — never again for the same id, even as it keeps showing across re-renders.
  const cgToastedIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!triggeredCgEntry || cgToastedIdsRef.current.has(triggeredCgEntry.id)) return
    cgToastedIdsRef.current.add(triggeredCgEntry.id)
    toastSuccess(`New in Gallery: "${triggeredCgEntry.title}"`, { chime: true })
  }, [triggeredCgEntry])
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

  // Sprite staging: slide+fade a cast member in the first time they appear (including a chat's very
  // first render — opening a chat is itself a "first appearance"), and keep someone who just left
  // the roster around briefly for a matching exit, instead of a hard cut either way.
  const ENTER_EXIT_MS = 450
  const [enteringIds, setEnteringIds] = useState<Set<string>>(new Set())
  const [departedMembers, setDepartedMembers] = useState<typeof castMembers>([])
  const prevCastRef = useRef<typeof castMembers>([])
  useEffect(() => {
    const prevIds = new Set(prevCastRef.current.map((m) => m.id))
    const currentIds = new Set(castMembers.map((m) => m.id))
    const entered = castMembers.filter((m) => !prevIds.has(m.id))
    const left = prevCastRef.current.filter((m) => !currentIds.has(m.id))
    if (entered.length) {
      const ids = entered.map((m) => m.id)
      setEnteringIds((prev) => new Set([...prev, ...ids]))
      setTimeout(() => setEnteringIds((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      }), ENTER_EXIT_MS)
    }
    if (left.length) {
      setDepartedMembers((prev) => [...prev, ...left])
      const ids = left.map((m) => m.id)
      setTimeout(() => setDepartedMembers((prev) => prev.filter((m) => !ids.includes(m.id))), ENTER_EXIT_MS)
    }
    prevCastRef.current = castMembers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castMembers.map((m) => m.id).join(',')])

  const slotClass = slotWidthClass(castMembers.length)
  const activeMember = castMembers.find((m) => m.isActive) ?? castMembers[0]
  // Nameplate follows whoever's line is actually showing — the player's own persona while
  // `showUserAsCurrent`, the speaking cast member otherwise. Same slot, same styling either way.
  const speakerName = showUserAsCurrent ? persona?.name || 'You' : (lastCharMsg?.name ?? activeMember?.name ?? character?.card.name ?? '')
  const speakerAvatarUrl = showUserAsCurrent ? persona?.avatarDataUrl : activeMember?.avatarUrl
  // Group scenes get a per-speaker identity hue; solo chats keep the usual relationship-pink.
  const plateHue = activeMember?.hue ?? 320
  // The name is set *on* the box's dark glass now, not on a filled romance-coloured tab, so it
  // takes the accent colour itself — `--c-romance-text` is the colour authored to contrast against
  // that fill, which in the dark theme is near-black and disappeared here.
  const plate = isGroupScene
    ? { name: `hsl(${plateHue} 82% 82%)`, chip: `hsl(${plateHue} 44% 44%)` }
    : { name: 'rgb(var(--c-romance))', chip: 'rgb(var(--c-romance))' }
  // Every fallback for "where is this scene" lives in `resolveSceneBackground` — including reading
  // the narration itself, which is what stops a chat's opening messages (a static greeting carries
  // no `<<scene:>>` tag at all) from landing on an unplaced void.
  const night = isNightPhase(world?.currentPhaseIndex)
  const narration = [lastCharMsg?.text, lastUserMsg?.text].filter(Boolean).join(' ')
  const resolvedBackground = resolveSceneBackground({
    taggedBackground: scene?.background,
    chat,
    world,
    affection,
    narration,
    night,
  })
  const sceneBackground = resolvedBackground.id
  const backgroundUrl = resolvedBackground.url
  const bgStyle = backgroundUrl
    ? { backgroundImage: `url(${backgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: sceneGradient(sceneBackground, { night }) }
  // Keyed on what's actually painted, so the cross-dissolve replays when the scene moves somewhere
  // else and stays put through an ordinary re-render.
  const bgKey = backgroundUrl || sceneBackground || 'nowhere'
  const prevBgRef = useRef<{ key: string; style: typeof bgStyle }>({ key: bgKey, style: bgStyle })
  const outgoingBgStyle = prevBgRef.current.key === bgKey ? undefined : prevBgRef.current.style
  useEffect(() => {
    prevBgRef.current = { key: bgKey, style: bgStyle }
  })

  // Only worth naming when there's no photo to say it for you — on authored art the location is
  // self-evident, and a caption over it is just chrome.
  const locationCaption = !backgroundUrl && sceneBackground ? backgroundLabel(sceneBackground, world) : undefined

  const swipes = lastCharMsg?.swipes ?? []
  const canSwipe = !!lastCharMsg && swipes.length > 0 && !isStreamingThis

  // See vnArtHint; dismissal is per-character.
  const vnArtHintDismissed = useSettingsStore((s) => s.vnArtHintDismissed)
  const dismissVnArtHint = useSettingsStore((s) => s.dismissVnArtHint)
  const artHint = vnArtHint(character, world, vnArtHintDismissed)
  const personaName = persona?.name
  const reducedMotion = useSettingsStore((s) => s.reducedMotion)
  const vnTextSpeedMs = useSettingsStore((s) => s.vnTextSpeedMs)
  const vnChoiceStyle = useSettingsStore((s) => s.vnChoiceStyle)
  const vnInputMode = useSettingsStore((s) => s.vnInputMode)

  // Inline input: the dialogue box is handed over to the player rather than a composer bar living
  // permanently under it. `composerHasDraft` forces it open for text that arrived some other way,
  // so a suggestion or a prefilled action is never composed off-screen.
  const inlineInput = vnInputMode === 'inline'
  const [writing, setWriting] = useState(false)
  const isWriting = inlineInput && (writing || composerHasDraft)
  // A landed reply is the scene's turn again — hand the box back, unless there's still a draft in it.
  useEffect(() => {
    setWriting(false)
  }, [lastCharMsg?.id])
  // Enter takes the box, the way Enter sends from it. Ignored while a dialog is open, while the
  // caret is already in a field, and while the backlog/hide-UI have the screen.
  useEffect(() => {
    if (!inlineInput || isWriting || showLog || hideUI) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      setWriting(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inlineInput, isWriting, showLog, hideUI])

  // Per-line voice: "read this line aloud" via the shared TTS stack (`lib/voice`). Manual and
  // one line at a time only — no auto-voice-on-every-reply, unlike Auto above; that's a
  // recurring-cost surface this pass intentionally doesn't take on.
  const koboldBaseUrl = useSettingsStore((s) => s.baseUrl)
  const ttsProvider = useSettingsStore((s) => s.ttsProvider)
  const ttsApiKey = useSettingsStore((s) => s.ttsApiKey)
  const ttsBaseUrl = useSettingsStore((s) => s.ttsBaseUrl)
  const ttsRegion = useSettingsStore((s) => s.ttsRegion)
  const ttsModel = useSettingsStore((s) => s.ttsModel)
  const openMayhemApiKey = useSettingsStore((s) => s.openMayhemApiKey)
  const ttsVoice = useSettingsStore((s) => s.ttsVoice)
  const [speakState, setSpeakState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const speakAudioRef = useRef<HTMLAudioElement | null>(null)
  const speakControllerRef = useRef<AbortController | null>(null)
  const speakUrlRef = useRef<string | null>(null)
  const stopSpeaking = () => {
    speakControllerRef.current?.abort()
    speakControllerRef.current = null
    if (speakUrlRef.current) { URL.revokeObjectURL(speakUrlRef.current); speakUrlRef.current = null }
    speakAudioRef.current?.pause()
    speakAudioRef.current = null
    setSpeakState('idle')
  }
  // Always starts fresh (cancelling anything already playing) — shared by the manual button's
  // "start" half and by auto-voice, which must never be subject to the button's own toggle-to-stop
  // semantics (a second reply arriving mid-playback should cut in, not silently no-op as a "stop").
  const startSpeaking = async (rawText: string) => {
    stopSpeaking()
    const text = toSpeakableText(rawText)
    if (!text) return
    setSpeakState('loading')
    const controller = new AbortController()
    speakControllerRef.current = controller
    try {
      if (character?.voice?.provider && character.voice.provider !== ttsProvider) {
        throw new Error('This character overrides the voice provider. Select that provider in Settings → Voice first, or use the global default for this character.')
      }
      const blob = await synthesizeSpeech(
        {
          provider: character?.voice?.provider ?? ttsProvider,
          apiKey: ttsProvider === 'openmayhem' ? openMayhemApiKey : ttsApiKey,
          model: ttsModel,
          baseUrl: ttsBaseUrl,
          region: ttsRegion,
          voice: character?.voice?.voiceId || ttsVoice,
        },
        text,
        koboldBaseUrl,
        controller.signal,
      )
      controller.signal.throwIfAborted()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      speakUrlRef.current = url
      speakAudioRef.current = audio
      setSpeakState('playing')
      const finish = () => {
        URL.revokeObjectURL(url)
        if (speakAudioRef.current === audio) {
          speakAudioRef.current = null
          setSpeakState('idle')
        }
      }
      audio.onended = finish
      audio.onerror = finish
      try { await audio.play() } catch (error) { finish(); throw error }
    } catch (e) {
      if (controller.signal.aborted) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) toastError(errorMessage(e))
        return
      }
      setSpeakState('idle')
      toastError(errorMessage(e))
    }
  }
  // The manual button: toggles, since a deliberate click while already speaking means "stop."
  const speakLine = () => {
    if (speakState !== 'idle') {
      stopSpeaking()
      return
    }
    startSpeaking(displayText)
  }
  // Swiping to a different line, or leaving the message entirely, cuts off whatever was playing —
  // it no longer matches what's on screen.
  useEffect(() => stopSpeaking, [lastCharMsg?.id, activeSwipe, ttsProvider, ttsModel, ttsVoice, openMayhemApiKey, ttsApiKey, ttsBaseUrl, ttsRegion, character?.voice?.provider, character?.voice?.voiceId])
  const [autoVoice, setAutoVoice] = useState(false)

  // Every message id this component instance has watched stream in live — its text already
  // appeared token-by-token, so re-running the typewriter over it (e.g. once `isStreamingThis`
  // flips false, or on a later swipe back to it) would just replay content the player already
  // watched arrive. Only a line that shows up already-complete (a static greeting, an
  // alternate-greeting swipe, or reopening a chat) gets the reveal treatment.
  const streamedIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (isStreamingThis && lastCharMsg) streamedIdsRef.current.add(lastCharMsg.id)
  }, [isStreamingThis, lastCharMsg?.id])
  const typewriterActive = !isStreamingThis && !!lastCharMsg?.text && !lastCharMsg?.failed && !streamedIdsRef.current.has(lastCharMsg?.id ?? '')
  const {
    revealed: revealedDialogueText,
    done: dialogueRevealDone,
    skip: skipTypewriter,
  } = useTypewriterReveal(displayText, reducedMotion ? 0 : vnTextSpeedMs, typewriterActive)
  const shownDialogueText = typewriterActive ? revealedDialogueText : displayText
  // The ADV "done typing" glyph — only for an actual, complete character line, never the empty-chat
  // placeholder or a still-in-flight stream.
  const dialogueComplete = !isStreamingThis && !!lastCharMsg?.text && !lastCharMsg?.failed && dialogueRevealDone
  // Auto-voice: speaks each new reply once it finishes typing, unprompted — opt-in, off by
  // default, never persisted (resets with everything else on a chat switch, same as Auto-advance).
  // Unlike Auto-advance this can't chain into extra generations on its own: it only ever narrates a
  // reply that already happened, so it carries none of Auto-advance's runaway-cost risk and needs
  // none of its safety caps.
  const autoVoiceSpokenIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!autoVoice || !dialogueComplete || !lastCharMsg) return
    if (autoVoiceSpokenIdRef.current === lastCharMsg.id) return
    autoVoiceSpokenIdRef.current = lastCharMsg.id
    startSpeaking(lastCharMsg.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoVoice, dialogueComplete, lastCharMsg?.id])
  // Keeps the growing edge of the reveal (and, once done, the glyph right after it) in view instead
  // of leaving a long reply scrolled to its own top inside the capped-height box.
  const dialogueBoxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    dialogueBoxRef.current?.scrollTo({ top: dialogueBoxRef.current.scrollHeight })
  }, [shownDialogueText])

  // Auto mode: once a reply's typewriter finishes, wait a beat scaled to its length, then hand off
  // to `onAutoAdvanceFire` — real VN autoplay. Keyed on the message id + completion flag so this
  // schedules exactly once per newly-completed reply, not on every unrelated re-render while it
  // stays complete. A "latest callback" ref means the fire, whenever it lands, always sees
  // `ChatWindow`'s current guards (isGenerating/activeChoices/live-date/etc.), not a stale closure
  // from the moment the timer was scheduled.
  const onAutoAdvanceFireRef = useRef(onAutoAdvanceFire)
  useEffect(() => {
    onAutoAdvanceFireRef.current = onAutoAdvanceFire
  })
  useEffect(() => {
    if (!autoAdvance || !dialogueComplete) return
    const delayMs = Math.min(8000, Math.max(900, 700 + shownDialogueText.length * 22))
    const t = setTimeout(() => onAutoAdvanceFireRef.current?.(), delayMs)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdvance, dialogueComplete, lastCharMsg?.id])

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

  // Per-line controls, floated above the box's top-right corner and faded until hover — they act on
  // the line being shown, but they aren't part of reading it, so they don't get a row inside the frame.
  const utilities =
    !isWriting && (canSwipe || (lastCharMsg && !isStreamingThis && !showUserAsCurrent)) ? (
      <>
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
            <button
              onClick={() => onRegenerate(lastCharMsg!.id)}
              title="Regenerate"
              aria-label="Regenerate"
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10"
            >
              <RotateCcw size={14} strokeWidth={2} />
            </button>
            <button
              onClick={() => onFork(lastCharMsg!.id)}
              title="Fork chat from here"
              aria-label="Fork chat from here"
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10"
            >
              <GitFork size={14} strokeWidth={2} />
            </button>
          </>
        )}
        {lastCharMsg && !isStreamingThis && !showUserAsCurrent && (
          <>
            {canSwipe && <span className="mx-1 h-4 w-px bg-white/15" />}
            <button
              onClick={speakLine}
              title={speakState === 'idle' ? 'Read this line aloud' : speakState === 'loading' ? 'Loading…' : 'Stop'}
              aria-label={speakState === 'idle' ? 'Read this line aloud' : 'Stop reading aloud'}
              className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10 ${speakState !== 'idle' ? 'text-accent' : 'text-white/70'}`}
            >
              {speakState === 'loading' ? (
                <Loader2 size={14} strokeWidth={2} className="animate-spin" />
              ) : speakState === 'playing' ? (
                <Volume2 size={14} strokeWidth={2} />
              ) : (
                <Volume1 size={14} strokeWidth={2} />
              )}
            </button>
            <button
              onClick={() => setAutoVoice((v) => !v)}
              title={autoVoice ? 'Auto-voice: on. Reads each new reply aloud' : 'Auto-voice: read each new reply aloud automatically'}
              aria-label={autoVoice ? 'Auto-voice: on' : 'Auto-voice: off'}
              aria-pressed={autoVoice}
              className={`relative flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold transition-colors hover:bg-white/10 ${
                autoVoice ? 'text-accent' : 'text-white/70'
              }`}
            >
              A
              {autoVoice && <span className="vn-auto-pulse absolute right-0.5 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
            </button>
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
      </>
    ) : undefined

  // Both captions only ever apply to a failed generation being shown as the player's own last line.
  const dialogueCaption = showUserAsCurrent ? (
    <>
      {lastUserMsg!.intimacyAction && (
        <span
          className="mt-2.5 flex w-fit items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/70"
          title={`Sent from the Relationship panel's Unlocks tab (${lastUserMsg!.intimacyAction.category.replace('_', ' ')}): "${lastUserMsg!.intimacyAction.label}"`}
        >
          <Heart size={9} strokeWidth={2.25} className="shrink-0" />
          {lastUserMsg!.intimacyAction.label}
        </span>
      )}
      {/* The failure as a small caption rather than the main line — the player's actual words stay
          the primary content; this just explains the silence. */}
      <p className="mt-2 text-[12px] text-danger/90">
        ⚠ {activeMember?.name ?? character?.card.name ?? 'Their'}'s reply failed. Try regenerating (⟲) from the log.
      </p>
    </>
  ) : undefined

  return (
    <div
      className="relative flex flex-1 flex-col overflow-hidden"
      // Click-anywhere-on-scene: brings the UI back first if it's hidden (the universal way back —
      // no on-screen hint needed), otherwise skips an in-progress typewriter reveal. Both are
      // harmless no-ops the rest of the time; nested buttons/inputs still get their own click first,
      // this never blocks or duplicates their own action.
      onClick={() => {
        if (hideUI) {
          setHideUI(false)
          return
        }
        if (!showLog && typewriterActive && !dialogueRevealDone) skipTypewriter()
      }}
    >
      {/* The outgoing scene stays painted underneath while the incoming one fades in over it — a
          `background` property can't be transitioned, so a change used to be a hard cut. */}
      {outgoingBgStyle && <div className="absolute inset-0" style={outgoingBgStyle} />}
      <div key={bgKey} className="vn-backdrop-in absolute inset-0" style={bgStyle} />
      {triggeredCgEntry && triggeredCgImageUrl && (
        // Full-bleed CG in place of the ordinary background — sprites are skipped below while one's
        // showing. `key` remounts per distinct CG, which is what replays `.vn-cg-reveal` each time.
        <img
          key={triggeredCgEntry.id}
          src={triggeredCgImageUrl}
          alt={triggeredCgEntry.title}
          className="vn-cg-reveal absolute inset-0 h-full w-full object-cover"
        />
      )}
      {/* Lighter than it used to be: the dialogue box now carries its own glass backdrop, so the
          page-wide scrim only has to keep the top HUD legible and give the box's blur something to
          sit on. Any more and the art stops being the subject. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/[0.04] to-black/25" />
      {/* Cinematic vignette rather than a flat scrim. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 82% 68% at 50% 40%, transparent 58%, rgb(0 0 0 / 0.30) 100%)' }}
      />
      {showPetals && <SakuraPetals />}

      {/* Hidden along with the rest of the chrome under Hide-UI — click the scene to bring it back. */}
      {!hideUI && (
      <>
      {/* One flex container (not two absolute overlays) so the HUD card and toolbar can't collide.
          Stacked on a phone — side by side there left the card crushed to an unreadable stub. */}
      <div className="absolute inset-x-3 top-3 z-20 flex flex-col-reverse items-end gap-2 sm:inset-x-4 sm:top-4 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="vn-glass min-w-0 self-start overflow-hidden rounded-2xl text-white sm:max-w-[58%] sm:self-auto">
          {(personaName || chat.mode || parentChatLink) && (
            <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-2 text-[11px] text-white/70">
              {personaName && <span className="truncate">as {personaName}</span>}
              {chat.mode && (
                <>
                  {personaName && <span className="text-white/30">·</span>}
                  <span className="truncate">{getWorldTemplate(chat.mode).label}</span>
                </>
              )}
              {parentChatLink && (
                <>
                  {(personaName || chat.mode) && <span className="text-white/30">·</span>}
                  {parentChatLink}
                </>
              )}
            </div>
          )}
          <StageRow variant="vn" first={!(personaName || chat.mode || parentChatLink)} className="!py-2">
            <div className="mb-1 flex min-w-0 items-center gap-1.5">
              <Heart size={11} strokeWidth={2.25} className="shrink-0 text-romance" fill="currentColor" fillOpacity={0.4} />
              <StageLabel variant="vn">
                {/* Named only when there's more than one cast member to disambiguate. */}
                Bond{isGroupScene ? ` · ${activeMember?.name ?? ''}` : ''}
              </StageLabel>
              <span className="truncate font-semibold capitalize text-romance">{formatRelationshipStage(relationshipStage)}</span>
              <span className="shrink-0 text-white/90">{warmth}</span>
            </div>
            <StageMeter value={warmth} variant="vn" className="w-28 max-w-full" />
          </StageRow>
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
          {activeIntimacyScene && activeSpeakerId && (
            // Compact on purpose: the stage HUD says what's happening and roughly how far along,
            // and the Relationship panel carries the full readout (meters, clothing, contact).
            <div className="border-t border-white/10">
              <SceneStateCard
                scene={activeIntimacyScene}
                viewingId={activeSpeakerId}
                nameOf={(id) => cast.find((c) => c.id === id)?.card.name ?? 'Someone else'}
                userName={persona?.name || 'You'}
                charReplyCount={charRepliesNow}
                graph={scenarioById(getScenarioCatalog(world), activeIntimacyScene.scenarioId)}
                variant="vn"
                compact
                className="!rounded-none !bg-transparent !backdrop-blur-none"
              />
            </div>
          )}
        </div>

        <div className="vn-glass flex h-9 shrink-0 items-center gap-1 rounded-full px-1">
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
          {/* Minimal VN quick menu — History (the log below), Auto, Skip, Hide-UI. Icon-only; each
              has its own tooltip/aria-label rather than a text chip, so the row stays compact
              enough to sit beside the title block down to phone width. */}
          {onToggleAutoAdvance && (
            <button
              onClick={onToggleAutoAdvance}
              title={autoAdvance ? 'Auto-advance: on. Click to stop' : 'Auto-advance the story after each reply'}
              aria-label={autoAdvance ? 'Auto-advance: on' : 'Auto-advance: off'}
              aria-pressed={autoAdvance}
              className={`relative flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/15 ${
                autoAdvance ? 'text-accent' : 'text-white/85 hover:text-white'
              }`}
            >
              <Play size={13} strokeWidth={2} fill={autoAdvance ? 'currentColor' : 'none'} />
              {autoAdvance && <span className="vn-auto-pulse absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />}
            </button>
          )}
          <button
            onClick={() => {
              if (typewriterActive && !dialogueRevealDone) skipTypewriter()
            }}
            disabled={!typewriterActive || dialogueRevealDone}
            title="Skip ahead"
            aria-label="Skip typewriter reveal"
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-30"
          >
            <ChevronsRight size={15} strokeWidth={2} />
          </button>
          <button
            onClick={() => setHideUI(true)}
            title="Hide UI. Click the scene to bring it back"
            aria-label="Hide UI"
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white"
          >
            <EyeOff size={14} strokeWidth={2} />
          </button>
          <span className="h-4 w-px bg-white/15" />
          <button
            onClick={() => setShowLog((v) => !v)}
            title={showLog ? 'Close history' : 'Open history'}
            aria-label={showLog ? 'Close history' : 'Open history'}
            className="flex h-7 items-center gap-1.5 rounded-full px-2 text-xs text-white/85 transition-colors hover:bg-white/15 hover:text-white sm:pr-3"
          >
            {showLog ? <X size={14} strokeWidth={2} /> : <History size={14} strokeWidth={2} />}
            <span className="hidden sm:inline">{showLog ? 'Close' : 'History'}</span>
          </button>
        </div>
      </div>
      </>
      )}

      {showLog ? (
        // Top padding clears the floating HUD card, which stays up over the backlog; the width cap
        // keeps a long transcript readable on a wide monitor instead of running the full stage.
        <div ref={logRef} className="relative z-10 flex-1 overflow-y-auto bg-bg/95 px-6 pb-6 pt-24 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl">
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
        </div>
      ) : (
        <>
          {/* The cast fills the whole stage and the dialogue box floats over their feet, the way a
              real VN composes a shot — rather than the two splitting the available height between
              them, which is what kept the character small. */}
          <div
            // On a phone the sprite is width-bound long before it is height-bound, so standing it on
            // the stage floor left almost all of it behind the dialogue box. There it stands on the
            // box's top edge instead; from `sm` up it goes back to the floor (and a little below it).
            className={`absolute inset-x-0 bottom-0 top-0 z-0 flex items-end justify-center px-4 pb-[24vh] sm:-bottom-[4%] sm:px-6 sm:pb-0 ${
              // Extra top padding for group scenes so the outer figure clears the HUD card.
              isGroupScene ? 'pt-10 sm:pt-16 md:pt-20' : 'pt-2 sm:pt-4 md:pt-6'
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
              {departedMembers.map((m) => (
                <VNCharacterSprite
                  key={m.id}
                  spriteUrl={m.spriteUrl}
                  name={m.name}
                  hue={m.hue}
                  isActive={m.isActive}
                  dim={!m.isActive}
                  slotClass={slotClass}
                  phase="exiting"
                />
              ))}
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
                  phase={enteringIds.has(m.id) ? 'entering' : undefined}
                />
              ))}
            </div>
            )}
          </div>

          {/* Hidden under Hide-UI too — only the background/sprites/CG stay up, full-scene. */}
          {!hideUI && (
          <>
          {/* Everything that isn't dialogue floats above the box instead of stacking inside it.
              That separation is what lets the box hold one fixed height while choices, quick
              replies and the assist strip come and go underneath the scene's own composition. */}
          <div className="vn-stack relative z-10 mt-auto pb-2">
            <div className="flex flex-col gap-2">
              {locationCaption && (
                // Only ever shown over a placeholder gradient — real art says where it is by itself.
                <span className="px-1 text-[10px] uppercase tracking-[0.18em] text-white/35">{locationCaption}</span>
              )}
              {assistSlot}
              {activeChoiceData && vnChoiceStyle === 'docked' && (
                <div className="max-h-[16vh] overflow-y-auto">
                  <ChoiceList
                    variant="vn"
                    choices={activeChoiceData.choices}
                    onPick={activeChoiceData.onPick}
                    onRefresh={activeChoiceData.onRefresh}
                    refreshing={activeChoiceData.refreshing}
                  />
                </div>
              )}
              {choiceListSlot}
            </div>
          </div>

          <div className="relative z-10">
            <VNDialogueBox
              ref={dialogueBoxRef}
              speakerName={speakerName}
              speakerAvatarUrl={speakerAvatarUrl}
              initials={initialsOf(speakerName)}
              plate={plate}
              personaLabel={persona?.name || 'You'}
              writing={isWriting}
              onStartWriting={inlineInput ? () => setWriting(true) : undefined}
              onStopWriting={() => setWriting(false)}
              composer={composerSlot}
              streaming={isStreamingThis}
              complete={dialogueComplete}
              utilities={utilities}
              caption={dialogueCaption}
            >
              {renderMessageText(shownDialogueText, regexScripts, dialogueSfx)}
            </VNDialogueBox>
          </div>

          {/* 'docked' input mode keeps the composer as its own bar under the box — for anyone who'd
              rather always see it than have the box change hands. */}
          {!inlineInput && (
            <div className="vn-stack relative z-10 pb-3 sm:pb-5">
              <div className="vn-glass rounded-2xl px-3 py-1.5">{composerSlot}</div>
            </div>
          )}
          </>
          )}

          {/* The 'centered' choice style: a full-stage, scene-dimmed decision moment instead of the
              docked pills above — a real VN choice screen. Sits outside the Hide-UI gate above on
              purpose in the sense that it's its own conditional, but still never shows while
              Hide-UI is on (a pending choice just waits; clicking the scene restores the UI first). */}
          {activeChoiceData && vnChoiceStyle === 'centered' && !hideUI && (
            <VNCenteredChoices
              choices={activeChoiceData.choices}
              onPick={activeChoiceData.onPick}
              onRefresh={activeChoiceData.onRefresh}
              refreshing={activeChoiceData.refreshing}
            />
          )}
        </>
      )}
    </div>
  )
}
