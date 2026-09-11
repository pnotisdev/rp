import { useState } from 'react'
import {
  ArrowUpRight,
  Cake,
  CheckCircle2,
  BookMarked,
  Gauge,
  Gift,
  Heart,
  History,
  ImageIcon,
  KeyRound,
  Lock,
  Package,
  Settings2,
  ShoppingBag,
  Sparkles,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { Character, GalleryEntry } from '@/lib/characters/cardSpec'
import type { Chat, WorldCard } from '@/lib/types'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { chatFactsApi, chatsApi, relationshipEventsApi } from '@/lib/api/client'
import { getGiftCatalog, giftTasteLabel } from '@/lib/dating/gifts'
import { getItemCatalog, itemEffectSummary } from '@/lib/dating/items'
import {
  canActuallyAskForCommitment,
  canInitiateFirstTime,
  commitmentLockReason,
  commitmentTierThreshold,
  computeWarmth,
  findActiveIntimacyScene,
  formatCommitmentStatus,
  formatRelationshipStage,
  combinedSceneFlags,
  FIRST_KISS_FLAG,
  getRelationshipStats,
  getRelationshipTrack,
  lowestWarmthDimension,
  nextCommitmentTier,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import {
  allowedIntimacyCategories,
  getIntimacyCatalog,
  getUnlockedIntimacyOptions,
  nextLockedInCategory,
  type IntimacyCategory,
  type IntimacyUnlockable,
} from '@/lib/dating/intimacyCatalog'
import { resolveIntimacyLevel } from '@/lib/prompt/intimacyGuidance'
import { AFTERGLOW_TURNS, afterglowTurnsSince } from '@/lib/dating/aftercare'
import { describeInitiativeBalance, describeMomentum } from '@/lib/dating/momentum'
import { isRebuffActive } from '@/lib/dating/rebuff'
import { isIntimacySceneActive } from '@/lib/dating/intimacyScene'
import { isSceneParticipant } from '@/lib/dating/sceneParticipants'
import { getScenarioCatalog, scenarioById } from '@/lib/dating/scenarios'
import { SceneStateCard } from '@/components/chat/SceneStateCard'
import { StageLabel, StageMeter } from '@/components/ui/Stage'
import { WORLD_TEMPLATES, normalizeWorldTemplateId, type WorldTemplateId } from '@/lib/world/worldTemplates'
import { daysUntilAnnualDate } from '@/lib/world/calendar'
import type { CommitmentStatus } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { resolveSceneBackground } from '@/lib/vn/resolveBackground'
import { TabRail, type TabRailItem } from '@/components/ui/TabRail'
import { Section } from '@/components/ui/Section'
import { CatalogAction, CatalogCard, CoinBalance } from '@/components/ui/CatalogCard'
import { catalogIcon, DIMENSION_ICONS, INTIMACY_CATEGORY_ICONS } from '@/lib/dating/catalogVisuals'
import { SelectField } from '@/components/ui/Field'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

/**
 * The "Relationship" modal: bond/warmth summary, per-dimension stats, intimacy unlocks, the gift/
 * item/toy shop, and chat-level settings + remembered facts + event history. Supports a tab
 * switcher across every character this chat tracks a relationship for (primary + participants).
 */
const ALL_STAT_KEYS =['affection', 'trust', 'chemistry', 'comfort', 'respect', 'curiosity', 'tension'] as const

const DIMENSION_LABELS: Record<(typeof ALL_STAT_KEYS)[number], string> = {
  affection: 'Affection',
  trust: 'Trust',
  chemistry: 'Chemistry',
  comfort: 'Comfort',
  respect: 'Respect',
  curiosity: 'Curiosity',
  tension: 'Tension',
}

/** One "what unlocks next" line: a glyph, what it is, and the number it's waiting on. */
function ProgressRow({ icon: Icon, label, at }: { icon: LucideIcon; label: string; at?: string | number }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={11} strokeWidth={1.75} className="shrink-0 opacity-60" />
      <span className="min-w-0 truncate">{label}</span>
      {at !== undefined && <span className="ml-auto shrink-0 tabular-nums opacity-70">@ {at}</span>}
    </div>
  )
}

/** A count riding on a tab-rail label, e.g. how many intimate options are unlocked. */
function RailCount({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-current/15 px-1.5 text-[11px] font-medium tabular-nums opacity-80">{children}</span>
  )
}

const INTIMACY_CATEGORIES: { id: IntimacyCategory; label: string }[] = [
  { id: 'affection', label: 'Closeness' },
  { id: 'kissing_spot', label: 'Kissing spots' },
  { id: 'position', label: 'Positions' },
  { id: 'toy', label: 'Toys' },
  { id: 'activity', label: 'Activities' },
]

type PanelTab = 'overview' | 'unlocks' | 'shop' | 'more'

interface RelationshipPanelProps {
  chat: Chat
  character?: Character
  /** Extra characters able to speak in this chat (group scenes); drives the tab switcher below. */
  participantCharacters?: Character[]
  world?: WorldCard
  onClose: () => void
  onBuyGift: (giftId: string) => Promise<void>
  onBuyItem: (itemId: string) => Promise<void>
  onBuyToy: (toyId: string) => Promise<void>
  onAskCommitment: (tier: Exclude<CommitmentStatus, 'none'>, characterId?: string) => Promise<void>
  /** The "First time together" milestone ask — see `stage.ts`'s `canInitiateFirstTime`. */
  onInitiateFirstTime: (characterId?: string) => Promise<void>
  onEndRelationship: (characterId?: string) => Promise<void>
  /** Jumps to the bound world's "Dating sim" tab; absent when there's nowhere to route to. */
  onNavigateToWorld?: (worldId: string, tab?: string) => void
  /** Adapts the option's action text to the scene and drops it in the composer for review; resolves once populated. */
  onIntimacyAction: (option: IntimacyUnlockable) => Promise<void>
  /** Answers a branch the scene is blocked on, by the option's own id (`intimacyStages.ts`'s `PendingChoiceOption`). */
  onIntimacyChoice: (characterId: string, optionId: string) => Promise<void>
  /** How many replies the character has given — the unit the aftercare window is counted in. */
  charReplyCount: number
  /** The player's own display name, for the scene readout's player-side rows. */
  personaName?: string
}

function upcomingGallery(gallery: GalleryEntry[], unlocked: Set<string>, affection: number, flags: Set<string>) {
  return gallery
    .filter((g) => !unlocked.has(g.id))
    .map((g) => {
      const missingFlags = (g.requiredFlags ?? []).filter((f) => !flags.has(f))
      return {
        ...g,
        missingAffection: Math.max(0, g.unlockAffection - affection),
        missingFlags,
      }
    })
    .sort((a, b) => a.missingAffection - b.missingAffection)
}

function formatDeltas(deltas: Partial<Record<string, number>>): string {
  return Object.entries(deltas)
    .filter(([, v]) => v)
    .map(([key, v]) => `${(v as number) > 0 ? '+' : ''}${v} ${DIMENSION_LABELS[key as keyof typeof DIMENSION_LABELS] ?? key}`)
    .join(', ')
}

/** Shared by the Unlocks and Shop tabs; renders nothing when there's no bound world to send the player to. */
function CustomizeLink({ world, onNavigateToWorld }: { world?: WorldCard; onNavigateToWorld?: (worldId: string, tab?: string) => void }) {
  if (!world || !onNavigateToWorld) return null
  return (
    <button
      onClick={() => onNavigateToWorld(world.id, 'dating')}
      className="flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-accent"
    >
      Customize in World editor
      <ArrowUpRight size={12} strokeWidth={2} />
    </button>
  )
}

export function RelationshipPanel({
  chat,
  character,
  participantCharacters = [],
  world,
  onClose,
  onBuyGift,
  onBuyItem,
  onBuyToy,
  onAskCommitment,
  onInitiateFirstTime,
  onEndRelationship,
  onNavigateToWorld,
  onIntimacyAction,
  onIntimacyChoice,
  charReplyCount,
  personaName = 'You',
}: RelationshipPanelProps) {
  // Everyone this chat tracks a relationship for; falls back to the primary if a picked participant leaves the roster.
  const trackedCharacters = character ? [character, ...participantCharacters] : participantCharacters
  const [viewingId, setViewingId] = useState(character?.id ?? '')
  const viewingCharacter = trackedCharacters.find((c) => c.id === viewingId) ?? character

  const track = viewingCharacter ? getRelationshipTrack(chat, viewingCharacter.id) : {}
  const affection = Math.max(0, Math.min(100, track.affection ?? 0))
  const stats = getRelationshipStats(track)
  const warmth = computeWarmth(affection, stats)
  const unlocked = new Set(track.unlockedGalleryIds ?? [])
  const flags = new Set(chat.sceneFlags ?? [])
  const inventory = chat.giftInventory ?? {}
  const itemInventory = chat.itemInventory ?? {}
  const toyInventory = chat.toyInventory ?? {}
  const milestones = relationshipMilestonesFor(world?.relationshipThresholds)
  const nextMilestone = milestones.find((m) => warmth < m.at)
  const relationshipStage = relationshipStageForWarmth(warmth, milestones)
  const giftCatalog = getGiftCatalog(world)
  const itemCatalog = getItemCatalog(world)
  const gallery = viewingCharacter?.gallery ?? []
  const upcoming = upcomingGallery(gallery, unlocked, affection, flags)
  const knownFlags = combinedSceneFlags(world?.customSceneFlags)
  const commitmentStatus = track.commitmentStatus ?? 'none'
  const nextTier = nextCommitmentTier(commitmentStatus)
  // Gates the commitment ladder on physical milestones too, not warmth alone — see `commitmentLockReason`/`canActuallyAskForCommitment`.
  const physical = { hasKissed: flags.has(FIRST_KISS_FLAG), firstIntimateSceneAt: track.firstIntimateSceneAt }
  const nextTierLockReason = nextTier ? commitmentLockReason(nextTier, warmth, physical, milestones) : undefined
  const eligibleForNextTier = nextTier ? canActuallyAskForCommitment(nextTier, warmth, physical, milestones) : false
  const [asking, setAsking] = useState(false)
  const [ending, setEnding] = useState(false)
  const [initiatingFirstTime, setInitiatingFirstTime] = useState(false)
  const [buyingToyId, setBuyingToyId] = useState<string | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [pendingChoiceEdge, setPendingChoiceEdge] = useState<string | null>(null)

  // Eligible toys regardless of ownership — the panel needs to render an unbought-but-eligible toy's "Buy" state.
  // Filtered by this character's own limits, so an entry they've ruled out is never rendered at all —
  // the enforcement point for `touchProfile`/`kinkProfile` (`dating/kinks.ts` explains why it's here
  // and not in a prompt instruction).
  const intimacyProfiles = { touch: viewingCharacter?.touchProfile, kinks: viewingCharacter?.kinkProfile }
  // Where the scene actually is, so a location-tied entry ("the edge of the onsen") isn't offered
  // in a classroom. The same resolution VN mode paints with, so the two can never disagree about
  // where this is happening.
  const sceneBackgroundId = resolveSceneBackground({
    taggedBackground: undefined,
    chat,
    world,
    affection,
    narration: undefined,
  }).id
  const intimacyUnlocked = getUnlockedIntimacyOptions(
    warmth,
    commitmentStatus,
    world,
    undefined,
    intimacyProfiles,
    sceneBackgroundId,
  )
  // The full catalog (not just `intimacyUnlocked`), so a locked toy is still shown with its requirement rather than hidden.
  const toyCatalogAll = getIntimacyCatalog(world).filter((i) => i.category === 'toy')
  const unlockedToyIds = new Set(intimacyUnlocked.filter((i) => i.category === 'toy').map((i) => i.id))
  // The content rating governs this panel too, not just the prompt; the world's rating wins over the global setting.
  const globalIntimacyLevel = useSettingsStore((st) => st.intimacyLevel)
  // How much of the post-intimacy window is left, or null when none is open (`dating/aftercare.ts`).
  const afterglowSince = afterglowTurnsSince(track.afterglow ?? undefined, charReplyCount)
  const afterglowRemaining =
    afterglowSince !== null && afterglowSince < AFTERGLOW_TURNS ? AFTERGLOW_TURNS - afterglowSince : null
  const effectiveIntimacyLevel = resolveIntimacyLevel(world?.intimacyLevel, globalIntimacyLevel)
  const allowedCategories = allowedIntimacyCategories(effectiveIntimacyLevel)
  const canTakeFirstTime = canInitiateFirstTime(warmth, commitmentStatus)

  const handleUseIntimacyOption = async (option: IntimacyUnlockable) => {
    if (pendingActionId) return
    setPendingActionId(option.id)
    try {
      await onIntimacyAction(option)
      onClose()
    } finally {
      setPendingActionId(null)
    }
  }

  // The one shared scene, resolved chat-wide rather than off this character's own track: a scene is
  // shared by everyone in it and stored on its owner's (`sceneParticipants.ts`), so a character who
  // joined one would otherwise show no scene here and, worse, no way to answer its open branch.
  const activeScene = findActiveIntimacyScene(chat, (sc) => isIntimacySceneActive(sc, charReplyCount))
  const viewingScene =
    activeScene && isSceneParticipant(activeScene.scene, viewingId, activeScene.ownerId) ? activeScene.scene : undefined

  // A branch the scene has reached and will not cross on its own — the player's to answer. Shown
  // whether or not the option carries a catalog entry: taking one that does routes through the same
  // clicked-action path as the Unlocks tab, and one that doesn't simply moves the stage.
  const pendingChoice = viewingScene?.pendingChoice

  const handleChoice = async (optionId: string) => {
    if (pendingChoiceEdge) return
    setPendingChoiceEdge(optionId)
    try {
      await onIntimacyChoice(viewingId, optionId)
      onClose()
    } finally {
      setPendingChoiceEdge(null)
    }
  }

  const handleBuyToy = async (toyId: string) => {
    setBuyingToyId(toyId)
    try {
      await onBuyToy(toyId)
    } finally {
      setBuyingToyId(null)
    }
  }

  const handleInitiateFirstTime = async () => {
    if (!viewingCharacter) return
    setInitiatingFirstTime(true)
    try {
      await onInitiateFirstTime(viewingCharacter.id)
    } finally {
      setInitiatingFirstTime(false)
    }
  }

  const [tab, setTab] = useState<PanelTab>('overview')
  const hasShop = giftCatalog.length > 0 || itemCatalog.length > 0 || (allowedCategories.includes('toy') && toyCatalogAll.length > 0)
  // Counts on the rail so the menu says what's behind a tab without opening it — the Unlocks badge
  // in particular is the whole progression loop at a glance.
  const tabs: TabRailItem<PanelTab>[] = [
    { id: 'overview', label: 'Overview', icon: Gauge },
    {
      id: 'unlocks',
      label: 'Unlocks',
      icon: KeyRound,
      badge: intimacyUnlocked.length ? <RailCount>{intimacyUnlocked.length}</RailCount> : undefined,
    },
    ...(hasShop ? [{ id: 'shop' as const, label: 'Shop', icon: ShoppingBag }] : []),
    { id: 'more', label: 'More', icon: Settings2 },
  ]
  // Falls back off the shop tab if it stops applying (re-derived from the catalogs every render).
  const activeTab: PanelTab = tab === 'shop' && !hasShop ? 'overview' : tab

  const handleAsk = async () => {
    if (!nextTier || !viewingCharacter) return
    setAsking(true)
    try {
      await onAskCommitment(nextTier, viewingCharacter.id)
    } finally {
      setAsking(false)
    }
  }

  const handleEnd = async () => {
    const ok = await confirmDialog({
      title: `End things with ${viewingCharacter?.card.name ?? 'them'}?`,
      body: 'This can be reconciled later, but it leaves a lasting mark on the relationship.',
      confirmLabel: 'End the relationship',
      tone: 'danger',
    })
    if (!ok || !viewingCharacter) return
    setEnding(true)
    try {
      await onEndRelationship(viewingCharacter.id)
    } finally {
      setEnding(false)
    }
  }

  const overrideValue = (key: 'autoTrackRelationship' | 'autoSuggestChoices'): 'default' | 'on' | 'off' => {
    const v = chat.assistOverrides?.[key]
    return v === undefined ? 'default' : v ? 'on' : 'off'
  }
  const setOverride = async (key: 'autoTrackRelationship' | 'autoSuggestChoices', value: 'default' | 'on' | 'off') => {
    const next = { ...(chat.assistOverrides ?? {}) }
    if (value === 'default') delete next[key]
    else next[key] = value === 'on'
    await chatsApi.update(chat.id, { assistOverrides: next })
  }
  // Its own pair, distinct from the two above — `visualNovelMode` is a tri-state (`'auto'` resolves
  // live in `ChatWindow` via `isVnReady`), not a plain boolean.
  const vnModeOverrideValue = (): 'default' | 'on' | 'off' | 'auto' => {
    const v = chat.assistOverrides?.visualNovelMode
    if (v === undefined) return 'default'
    if (v === 'auto') return 'auto'
    return v ? 'on' : 'off'
  }
  const setVnModeOverride = async (value: 'default' | 'on' | 'off' | 'auto') => {
    const next = { ...(chat.assistOverrides ?? {}) }
    if (value === 'default') delete next.visualNovelMode
    else if (value === 'auto') next.visualNovelMode = 'auto'
    else next.visualNovelMode = value === 'on'
    await chatsApi.update(chat.id, { assistOverrides: next })
  }
  // Purely a display label (`NewChatDialog`'s Play style picker) — changing it later doesn't
  // retroactively touch `assistOverrides`, same as switching a world's own template doesn't touch
  // an already-created chat's overrides.
  const setChatMode = async (value: WorldTemplateId) => {
    await chatsApi.update(chat.id, { mode: value })
  }

  const allEvents = useApiQuery('relationship-events', () => relationshipEventsApi.listByChat(chat.id), [chat.id]) ?? []
  // A missing characterId predates multi-character tracking and belonged to the primary.
  const events = allEvents.filter((e) => (e.characterId ?? chat.characterId) === viewingCharacter?.id)
  // Counts deflects at the current tier: an acceptance would have already advanced past it, so every logged attempt here was a deflect.
  const nextTierAskAttempts = nextTier ? events.filter((e) => e.reason.startsWith(`Asked to be ${formatCommitmentStatus(nextTier)}:`)).length : 0
  const facts = useApiQuery('chat-facts', () => chatFactsApi.listByChat(chat.id), [chat.id]) ?? []
  // Guards against a malformed row rendering an object as a React child and white-screening the panel.
  const activeFacts = facts.filter((f) => f.active && typeof f.text === 'string')
  const [newFactText, setNewFactText] = useState('')

  const addFact = async () => {
    const text = newFactText.trim()
    if (!text) return
    setNewFactText('')
    await chatFactsApi.create({ chatId: chat.id, text })
  }

  const retireFact = async (id: string) => {
    await chatFactsApi.update(id, { active: false })
  }

  const nextSpriteUnlock = Object.entries(viewingCharacter?.spriteUnlocks ?? {})
    .filter(([, n]) => Number(n) > affection)
    .sort((a, b) => Number(a[1]) - Number(b[1]))[0]
  const nextBackgroundUnlock = Object.entries(world?.backgroundUnlocks ?? {})
    .filter(([, n]) => Number(n) > affection)
    .sort((a, b) => Number(a[1]) - Number(b[1]))[0]

  return (
    <Modal
      onClose={onClose}
      title="Relationship"
      size="3xl"
      scrollable
      compact
      // The one number a shop should never bury, and it's read from three of the four tabs — so it
      // lives in the shell's header rather than inside the Shop tab's first section.
      headerExtra={hasShop ? <CoinBalance coins={chat.giftCoins ?? 0} /> : undefined}
    >
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Pinned: never scrolls away, regardless of which tab below is open. */}
      <div className="shrink-0">
      {trackedCharacters.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1 rounded-xl bg-bg-sunken p-1">
          {trackedCharacters.map((c) => (
            <button
              key={c.id}
              onClick={() => setViewingId(c.id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                viewingCharacter?.id === c.id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text'
              }`}
            >
              {c.avatarDataUrl && (
                <img src={c.avatarDataUrl} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
              )}
              <span className="truncate font-display">{c.card.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Pinned above the tabs: who this is, bond/warmth, current emotional read, and the at-risk
          banner if any. Laid out as a character card — portrait, name, stage, meter — rather than
          the stack of full-width paragraphs it was, which cost most of the panel's height before
          any tab content got a look in. */}
      <div className="mb-3 rounded-xl bg-bg-sunken p-3">
        <div className="flex items-center gap-3">
          {viewingCharacter?.avatarDataUrl ? (
            <img
              src={viewingCharacter.avatarDataUrl}
              alt=""
              className="h-12 w-12 shrink-0 rounded-xl object-cover ring-1 ring-romance/25"
            />
          ) : (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-romance/12 text-romance">
              <Heart size={20} strokeWidth={1.75} fill="currentColor" fillOpacity={0.25} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {/* The VN HUD's own Bond row, same label treatment and same meter (`ui/Stage`) — the two
                are the same components now rather than two drifting copies of one look. */}
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate font-display text-sm text-text">{viewingCharacter?.card.name ?? 'Relationship'}</span>
              <span className="truncate text-xs font-semibold capitalize text-romance">
                {formatRelationshipStage(relationshipStage)}
              </span>
              <span className="ml-auto shrink-0 text-sm tabular-nums text-text">{warmth}</span>
            </div>
            <StageMeter value={warmth} className="mt-1.5" />
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-text-muted">
              <StageLabel>{nextMilestone ? 'Next' : 'Bond'}</StageLabel>
              {nextMilestone
                ? `${formatRelationshipStage(nextMilestone.stage)} at ${nextMilestone.at}`
                : 'Max stage reached'}
            </p>
          </div>
        </div>
        {(track.mood || track.currentNeed || describeMomentum(track.momentum) || describeInitiativeBalance(track.initiativeBalance)) && (
          <p className="mt-2 border-t border-bg-elevated pt-2 text-xs italic text-text-muted">
            Right now:{' '}
            {[
              track.mood ?? '',
              track.currentNeed ? `could use more ${track.currentNeed}` : '',
              describeMomentum(track.momentum) ?? '',
              describeInitiativeBalance(track.initiativeBalance) ?? '',
            ]
              .filter(Boolean)
              .join(' · ')}
            {'. '}A passing read, separate from the bond above.
          </p>
        )}
        {viewingScene && (
          // The full engine-tracked scene, in the VN HUD's own idiom (`SceneStateCard`): stage,
          // every participant's own meter, what's off, and who is touching whom. All of it was
          // already being injected into the prompt and none of it was visible before.
          <div className="mt-3 border-t border-bg-elevated pt-3">
            <SceneStateCard
              scene={viewingScene}
              viewingId={viewingId}
              nameOf={(id) => trackedCharacters.find((c) => c.id === id)?.card.name ?? 'Someone else'}
              userName={personaName}
              charReplyCount={charReplyCount}
              graph={scenarioById(getScenarioCatalog(world), viewingScene.scenarioId)}
            />
          </div>
        )}
        {afterglowRemaining !== null && (
          // Says what's true, not what to do — the window scores what the player does with it.
          <p className="mt-2 border-t border-bg-elevated pt-2 text-xs italic text-romance">
            Still in the hours after being intimate. {afterglowRemaining} more{' '}
            {afterglowRemaining === 1 ? 'reply' : 'replies'} before it settles into how it felt.
          </p>
        )}
        {!!track.discoveredRegions?.length && (
          // The discovery loop (`dating/touch.ts`): what the player has learned this character
          // actually responds to. Says what was found, not what to do with it.
          <p className="mt-2 border-t border-bg-elevated pt-2 text-xs italic text-romance">
            You've learned they respond to: {track.discoveredRegions.map((r) => r.replace(/_/g, ' ')).join(', ')}.
          </p>
        )}
        {isRebuffActive(track.recentRebuff, charReplyCount) && (
          // Same restraint as the afterglow line above: says what's true, not what to do about it.
          <p className="mt-2 border-t border-bg-elevated pt-2 text-xs italic text-text-muted">
            Still a little guarded since {track.recentRebuff!.kind === 'commitment' ? 'the last ask' : 'last time'} was put off
            {track.recentRebuff!.severity === 'backfire' ? '. That one genuinely stung' : ''}.
          </p>
        )}
      </div>

      {pendingChoice && (
        <div className="mb-3 rounded-xl bg-romance/10 p-3 ring-1 ring-romance/30">
          <div className="text-sm font-semibold text-romance">The scene is waiting on you</div>
          <p className="mt-1 text-xs text-text-muted">
            It won't move past this on its own. Pick where it goes.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {pendingChoice.options.map((option) => (
              <button
                key={option.id}
                onClick={() => handleChoice(option.id)}
                disabled={!!pendingChoiceEdge}
                className="rounded-lg border border-romance/40 bg-bg-elevated px-3 py-1.5 text-xs font-medium text-romance transition-colors hover:bg-romance/15 disabled:opacity-50"
              >
                {pendingChoiceEdge === option.id ? 'Working…' : option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {track.relationshipWarning && (
        <div className="mb-3 rounded-xl bg-danger/10 p-3 ring-1 ring-danger/30">
          <div className="text-sm font-semibold text-danger">On the rocks</div>
          <p className="mt-1 text-xs text-text-muted">
            {track.relationshipWarning.reason.charAt(0).toUpperCase() + track.relationshipWarning.reason.slice(1)} if this
            isn't resolved soon, the relationship will break on its own.
          </p>
        </div>
      )}

      <TabRail items={tabs} value={activeTab} onChange={setTab} className="mb-3" />
      </div>

      {/* The only part that scrolls — bounded by the Modal's max-height regardless of tab content. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
      {activeTab === 'overview' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bg-sunken p-3">
            <div>
              <StageLabel>Status</StageLabel>
              <div className="text-sm capitalize text-text">{formatCommitmentStatus(commitmentStatus)}</div>
              {track.breakupCount ? (
                <div className="mt-0.5 text-[11px] text-text-muted">
                  Broken up before ({track.breakupCount}×). Trust, comfort, and chemistry still carry that scar.
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {commitmentStatus !== 'none' && (
                <Button variant="ghost" onClick={handleEnd} disabled={ending}>
                  {ending ? 'Ending…' : 'End things'}
                </Button>
              )}
              {nextTier &&
                (eligibleForNextTier ? (
                  <div className="flex flex-col items-end gap-1">
                    <Button variant="primary" onClick={handleAsk} disabled={asking}>
                      {asking ? 'Asking…' : `Ask to be ${formatCommitmentStatus(nextTier)}`}
                    </Button>
                    {/* After a few deflects, point at whichever tracked dimension is lagging behind. */}
                    {nextTierAskAttempts >= 3 && (
                      <p className="max-w-[16rem] text-right text-[11px] text-text-muted">
                        Deflected {nextTierAskAttempts}× so far. {viewingCharacter?.card.name ?? 'their'}{' '}
                        {DIMENSION_LABELS[lowestWarmthDimension(stats)].toLowerCase()} has been trailing the rest; worth warming that up before asking again.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-right text-xs text-text-muted">
                    {/* Once warmth is met, the lock is physical — say so instead of repeating a cleared number. */}
                    {nextTierLockReason === 'kiss'
                      ? `Kiss ${viewingCharacter?.card.name ?? 'them'} first`
                      : nextTierLockReason === 'first_time'
                        ? 'Share a first time together first'
                        : `${formatCommitmentStatus(nextTier)} unlocks at ${commitmentTierThreshold(nextTier, milestones)} warmth`}
                  </div>
                ))}
            </div>
          </div>

          <Section title="Relationship stats" icon={Gauge} surface="sunken" contentClassName="!p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ALL_STAT_KEYS.map((key) => {
                const value = key === 'affection' ? affection : stats[key]
                const DimIcon = DIMENSION_ICONS[key] ?? Heart
                // Tension isn't a "more is better" dimension, so it stays neutral rather than romance-tinted.
                const neutral = key === 'tension'
                return (
                  <div key={key} className="rounded-lg bg-bg-elevated px-2.5 py-2">
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] text-text-muted">
                      <DimIcon size={12} strokeWidth={1.75} className={`shrink-0 ${neutral ? '' : 'text-romance/70'}`} />
                      <span className="truncate">{DIMENSION_LABELS[key]}</span>
                      <span className="ml-auto tabular-nums text-text">{value}</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-bg-sunken">
                      <div
                        className={`h-full rounded-full transition-[width] duration-500 ${neutral ? 'bg-text-muted/50' : 'bg-romance/70'}`}
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>
        </div>
      )}

      {activeTab === 'unlocks' && (
        <div className="space-y-3">
          <Section
            title="Scene flags"
            icon={CheckCircle2}
            action={
              <span className="text-[11px] tabular-nums text-text-muted">
                {knownFlags.filter((f) => flags.has(f.id)).length}/{knownFlags.length}
              </span>
            }
            surface="sunken"
            contentClassName="!p-3"
          >
            <div className="flex flex-wrap gap-1.5">
              {/* Earned vs not is the whole point of this list, so it's carried by a glyph as well
                  as a tint — a colour difference alone read as decoration rather than progress. */}
              {knownFlags.map((f) => {
                const earned = flags.has(f.id)
                return (
                  <span
                    key={f.id}
                    className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${
                      earned ? 'bg-romance/15 text-romance' : 'bg-bg-elevated text-text-muted/70'
                    }`}
                  >
                    {earned ? <CheckCircle2 size={11} strokeWidth={2.25} /> : <Lock size={10} strokeWidth={2.25} />}
                    {f.label}
                  </span>
                )
              })}
            </div>
          </Section>

          <Section
            title="Intimate unlocks"
            icon={KeyRound}
            description="Kissing spots, positions, toys, and other beats this relationship has earned. Click one and the model writes your move into it, adapted to where the scene is, for you to review in the composer before you send."
            surface="sunken"
            contentClassName="!p-3"
          >
            <div className="space-y-1.5">
              {INTIMACY_CATEGORIES.filter((c) => allowedCategories.includes(c.id)).map(({ id, label }) => {
                const items = intimacyUnlocked.filter((i) => i.category === id)
                const next = nextLockedInCategory(id, warmth, commitmentStatus, world)
                const CatIcon = INTIMACY_CATEGORY_ICONS[id] ?? Sparkles
                return (
                  <div key={id} className="rounded-lg bg-bg-elevated px-2.5 py-2">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
                      <CatIcon size={12} strokeWidth={1.75} className="shrink-0 text-romance/70" />
                      {label}
                      {items.length > 0 && <span className="ml-auto tabular-nums">{items.length}</span>}
                    </div>
                    {items.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {items.map((i) => {
                          // An unpriced toy is treated as free/pre-owned; only a priced, not-yet-bought toy needs a purchase step.
                          const needsPurchase = i.category === 'toy' && (i.price ?? 0) > 0 && (toyInventory[i.id] ?? 0) <= 0
                          if (!needsPurchase) {
                            return (
                              <button
                                key={i.id}
                                onClick={() => handleUseIntimacyOption(i)}
                                disabled={!!pendingActionId}
                                title={`${i.label}. The model writes your move into it, adapted to the scene, for you to review`}
                                className="flex items-center gap-1.5 rounded-lg bg-romance/15 px-2 py-1 text-xs text-romance transition-colors first-letter:uppercase hover:bg-romance/25 disabled:opacity-40"
                              >
                                <Sparkles size={10} strokeWidth={2.25} className="shrink-0 opacity-70" />
                                {pendingActionId === i.id ? 'Writing…' : i.label}
                              </button>
                            )
                          }
                          return (
                            <button
                              key={i.id}
                              onClick={() => handleBuyToy(i.id)}
                              disabled={buyingToyId === i.id || (chat.giftCoins ?? 0) < (i.price ?? 0)}
                              title={`Buy ${i.label} for ${i.price} coins`}
                              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-romance/80 ring-1 ring-romance/35 transition-colors first-letter:uppercase hover:bg-romance/10 disabled:opacity-40"
                            >
                              <ShoppingBag size={10} strokeWidth={2.25} className="shrink-0 opacity-70" />
                              {buyingToyId === i.id ? 'Buying…' : `${i.label} · ${i.price}◆`}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="text-xs text-text-muted/70">Nothing unlocked yet.</div>
                    )}
                    {next && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-muted">
                        <Lock size={10} strokeWidth={2.25} className="shrink-0 opacity-70" />
                        <span className="truncate first-letter:uppercase">{next.label}</span>
                        <span className="shrink-0 opacity-70">
                          at {next.minWarmth}
                          {next.minCommitment ? ` · ${formatCommitmentStatus(next.minCommitment)}` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Section>

          {(canTakeFirstTime || track.firstIntimateSceneAt) && (
            <Section title="Milestone" icon={Sparkles} surface="sunken" contentClassName="!p-3">
              {track.firstIntimateSceneAt ? (
                <p className="text-xs text-text-muted">Already happened. Their first time together.</p>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-text-muted">Ready to take things all the way, for the first time.</p>
                  <Button variant="primary" onClick={handleInitiateFirstTime} disabled={initiatingFirstTime}>
                    {initiatingFirstTime ? 'Asking…' : 'First time together'}
                  </Button>
                </div>
              )}
            </Section>
          )}

          <Section title="Coming up" icon={ImageIcon} surface="sunken" contentClassName="!p-3">
            <div className="space-y-1 text-xs text-text-muted">
              <ProgressRow icon={Sparkles} label={nextSpriteUnlock ? `Expression: ${nextSpriteUnlock[0]}` : 'No locked expressions'} at={nextSpriteUnlock?.[1]} />
              <ProgressRow icon={ImageIcon} label={nextBackgroundUnlock ? `Background: ${nextBackgroundUnlock[0]}` : 'No locked backgrounds'} at={nextBackgroundUnlock?.[1]} />
              {upcoming.slice(0, 4).map((g) => (
                <ProgressRow
                  key={g.id}
                  icon={ImageIcon}
                  label={`Gallery: ${g.title}${g.missingFlags.length > 0 ? ` · needs ${g.missingFlags.join(', ')}` : ''}`}
                  at={g.missingAffection > 0 ? `+${g.missingAffection}` : undefined}
                />
              ))}
              {upcoming.length === 0 && <div>Everything unlocked for this character.</div>}
            </div>
          </Section>

          <div className="flex justify-end">
            <CustomizeLink world={world} onNavigateToWorld={onNavigateToWorld} />
          </div>
        </div>
      )}

      {activeTab === 'shop' && hasShop && (
        <div className="space-y-4">
          {viewingCharacter?.birthday !== undefined &&
            world &&
            daysUntilAnnualDate(world.currentDay ?? 0, viewingCharacter.birthday) === 0 && (
              <div className="flex items-center gap-2.5 rounded-xl bg-romance/10 px-3 py-2.5 text-sm text-romance">
                <Cake size={16} strokeWidth={1.75} className="shrink-0" />
                <span>
                  It's {viewingCharacter.card.name}'s birthday today — a gift lands far harder than usual.
                </span>
              </div>
            )}
          <Section
            title="Gifts"
            description={`Given in person, in the scene. ${viewingCharacter?.card.name ?? 'They'} reacts to what you pick.`}
            icon={Gift}
            surface="sunken"
            contentClassName="!p-3"
          >
            <div className="space-y-1.5">
              {giftCatalog.map((gift) => {
                const qty = inventory[gift.id] ?? 0
                // Progressive taste reveal: only once this exact gift has actually been given at
                // least once — the shop never spoils an authored preference up front.
                const discovered = (track.giftsGiven?.[gift.id] ?? 0) > 0
                const tasteLabel = discovered ? giftTasteLabel(viewingCharacter?.card.name ?? '', viewingCharacter?.giftPreferences?.[gift.id] ?? 0) : ''
                return (
                  <CatalogCard
                    key={gift.id}
                    icon={catalogIcon(gift.tags)}
                    name={gift.name}
                    tone={gift.rarity}
                    owned={qty}
                    meta={gift.rarity === 'common' ? gift.tags.join(', ') : `${gift.rarity} · ${gift.tags.join(', ')}`}
                    note={tasteLabel || undefined}
                    action={
                      <CatalogAction
                        label="Buy"
                        price={gift.price}
                        onClick={() => onBuyGift(gift.id)}
                        disabled={(chat.giftCoins ?? 0) < gift.price}
                      />
                    }
                  />
                )
              })}
            </div>
          </Section>

          {itemCatalog.length > 0 && (
            <Section
              title="Items"
              icon={Package}
              description="Bought here, used from the Bag for an immediate effect."
              surface="sunken"
              contentClassName="!p-3"
            >
              <div className="space-y-1.5">
                {itemCatalog.map((item) => (
                  <CatalogCard
                    key={item.id}
                    icon={catalogIcon(item.tags, Package)}
                    name={item.name}
                    tone={item.rarity}
                    owned={itemInventory[item.id] ?? 0}
                    meta={itemEffectSummary(item)}
                    action={
                      // A zero-price item is a job, not a purchase (`part-time-shift` pays coins
                      // *in*) — "Buy 0 ◆" reads as a bug, so it gets a free action's treatment.
                      <CatalogAction
                        label={item.price > 0 ? 'Buy' : 'Take'}
                        price={item.price > 0 ? item.price : undefined}
                        onClick={() => onBuyItem(item.id)}
                        disabled={(chat.giftCoins ?? 0) < item.price}
                      />
                    }
                  />
                ))}
              </div>
            </Section>
          )}

          {allowedCategories.includes('toy') && toyCatalogAll.length > 0 && (
            <Section
              title="Toys"
              icon={Wand2}
              description="Warmth and commitment decide which of these are buyable. Also reachable from Unlocks once one is eligible."
              surface="sunken"
              contentClassName="!p-3"
            >
              <div className="space-y-1.5">
                {toyCatalogAll.map((toy) => {
                  const owned = (toyInventory[toy.id] ?? 0) > 0
                  const eligible = unlockedToyIds.has(toy.id)
                  const price = toy.price ?? 0
                  return (
                    <CatalogCard
                      key={toy.id}
                      icon={Heart}
                      name={toy.label}
                      tone="intimate"
                      locked={!eligible}
                      owned={owned ? 1 : 0}
                      meta={
                        eligible
                          ? owned
                            ? 'Yours — use it from Unlocks'
                            : price > 0
                              ? 'Available now'
                              : 'Free'
                          : `Unlocks at ${toy.minWarmth} warmth${toy.minCommitment ? ` and ${formatCommitmentStatus(toy.minCommitment)}` : ''}`
                      }
                      action={
                        owned ? undefined : (
                          <CatalogAction
                            label={buyingToyId === toy.id ? 'Buying…' : 'Buy'}
                            price={price > 0 ? price : undefined}
                            tone="romance"
                            onClick={() => handleBuyToy(toy.id)}
                            disabled={!eligible || buyingToyId === toy.id || (chat.giftCoins ?? 0) < price}
                          />
                        )
                      }
                    />
                  )
                })}
              </div>
            </Section>
          )}

          <div className="flex justify-end">
            <CustomizeLink world={world} onNavigateToWorld={onNavigateToWorld} />
          </div>
        </div>
      )}

      {activeTab === 'more' && (
        <div className="space-y-3">
          <Section
            title="Chat settings"
            icon={Settings2}
            surface="sunken"
            contentClassName="!p-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <SelectField
              label="Play style"
              hint="Just a label, shown in the header and chat list. It doesn't touch the toggles below."
              value={normalizeWorldTemplateId(chat.mode)}
              onChange={(e) => setChatMode(e.target.value as WorldTemplateId)}
            >
              {WORLD_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Track relationship for this chat"
              hint="Overrides the global Settings → Generation default, just for this chat."
              value={overrideValue('autoTrackRelationship')}
              onChange={(e) => setOverride('autoTrackRelationship', e.target.value as 'default' | 'on' | 'off')}
            >
              <option value="default">Use global default</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </SelectField>
            <SelectField
              label="Suggest choices for this chat"
              hint="Overrides the global Settings → Generation default, just for this chat."
              value={overrideValue('autoSuggestChoices')}
              onChange={(e) => setOverride('autoSuggestChoices', e.target.value as 'default' | 'on' | 'off')}
            >
              <option value="default">Use global default</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </SelectField>
            <SelectField
              label="Visual Novel mode for this chat"
              hint="Overrides the global Settings → Appearance default, just for this chat. 'Auto' turns it on only once this character has sprites and the world has scene art."
              value={vnModeOverrideValue()}
              onChange={(e) => setVnModeOverride(e.target.value as 'default' | 'on' | 'off' | 'auto')}
            >
              <option value="default">Use global default</option>
              <option value="on">On</option>
              <option value="auto">Auto</option>
              <option value="off">Off</option>
            </SelectField>
          </Section>

          {/* Chat-wide, not per-character — stays the same across the character switcher above. */}
          <Section title="What's remembered in this chat" icon={BookMarked} surface="sunken" contentClassName="!p-3">
            <div className="mb-3 flex flex-wrap gap-2">
              {activeFacts.map((f) => (
                <button
                  key={f.id}
                  onClick={() => retireFact(f.id)}
                  title="Click to forget this"
                  className="flex items-center gap-1.5 rounded-full bg-bg-elevated px-3 py-1 text-xs text-text hover:text-danger"
                >
                  {f.text}
                  <X size={11} strokeWidth={2} />
                </button>
              ))}
              {activeFacts.length === 0 && <span className="text-xs text-text-muted">Nothing remembered yet.</span>}
            </div>
            <div className="flex gap-2">
              <input
                value={newFactText}
                onChange={(e) => setNewFactText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addFact()}
                placeholder="Add a fact by hand (e.g. &quot;Allergic to cats&quot;)"
                className="flex-1 rounded-xl bg-bg-elevated px-3 py-2 text-xs text-text outline-none"
              />
              <Button onClick={addFact} disabled={!newFactText.trim()}>Add</Button>
            </div>
          </Section>

          <details className="rounded-xl bg-bg-sunken p-3">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-text">
              <History size={14} strokeWidth={2} className="shrink-0 text-text-muted" />
              History ({events.length})
            </summary>
            <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
              {events.map((e) => (
                <div key={e.id} className="rounded-lg bg-bg-elevated px-3 py-2 text-xs">
                  <div className="text-text">{e.reason}</div>
                  <div className="text-text-muted">
                    {new Date(e.createdAt).toLocaleString()}
                    {formatDeltas(e.deltas) ? ` · ${formatDeltas(e.deltas)}` : ''}
                    {e.newFlags?.length ? ` · +${e.newFlags.join(', ')}` : ''}
                  </div>
                </div>
              ))}
              {events.length === 0 && <div className="text-xs text-text-muted">Nothing logged yet.</div>}
            </div>
          </details>
        </div>
      )}
      </div>
    </div>
    </Modal>
  )
}
