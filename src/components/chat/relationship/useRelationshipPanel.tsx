import { useState } from 'react'
import {
  Gauge,
  
  
  
  
  KeyRound,
  
  
  Settings2,
  
  ShoppingBag,
  
  
  
  
} from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { chatFactsApi, chatsApi, relationshipEventsApi } from '@/lib/api/client'
import { getGiftCatalog } from '@/lib/dating/gifts'
import { getItemCatalog } from '@/lib/dating/items'
import {
  canActuallyAskForCommitment,
  canInitiateFirstTime,
  commitmentLockReason,
  
  computeWarmth,
  findActiveIntimacyScene,
  formatCommitmentStatus,
  
  combinedSceneFlags,
  FIRST_KISS_FLAG,
  getRelationshipStats,
  getRelationshipTrack,
  
  nextCommitmentTier,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import {
  allowedIntimacyCategories,
  getIntimacyCatalog,
  getUnlockedIntimacyOptions,
  
  
  type IntimacyUnlockable,
} from '@/lib/dating/intimacyCatalog'
import { resolveIntimacyLevel } from '@/lib/prompt/intimacyGuidance'
import { AFTERGLOW_TURNS, afterglowTurnsSince } from '@/lib/dating/aftercare'
import { isIntimacySceneActive } from '@/lib/dating/intimacyScene'
import { isSceneParticipant } from '@/lib/dating/sceneParticipants'
import { type WorldTemplateId } from '@/lib/world/worldTemplates'
import { resolveSceneBackground } from '@/lib/vn/resolveBackground'
import { purchasableOutfits } from '@/lib/vn/outfits'
import { type TabRailItem } from '@/components/ui/TabRail'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { RailCount, PanelTab, RelationshipPanelProps, upcomingGallery } from './helpers'

export function useRelationshipPanel({
  chat,
  character,
  participantCharacters = [],
  world,
  onClose,
  onBuyGift,
  onBuyItem,
  onBuyToy,
  onBuyOutfit,
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
  const intimacyProfiles = { touch: viewingCharacter?.touchProfile, kinks: viewingCharacter?.kinkProfile }
  // Where the scene actually is, so a location-tied entry ("the edge of the onsen") isn't offered in a classroom.
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

  // The one shared scene, resolved chat-wide rather than off this character's own track
  const activeScene = findActiveIntimacyScene(chat, (sc) => isIntimacySceneActive(sc, charReplyCount))
  const viewingScene =
    activeScene && isSceneParticipant(activeScene.scene, viewingId, activeScene.ownerId) ? activeScene.scene : undefined

  // A branch the scene has reached and will not cross on its own — the player's to answer.
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

  const [buyingOutfitId, setBuyingOutfitId] = useState<string | null>(null)
  const handleBuyOutfit = async (outfitId: string) => {
    if (!viewingCharacter) return
    setBuyingOutfitId(outfitId)
    try {
      await onBuyOutfit(viewingCharacter.id, outfitId)
    } finally {
      setBuyingOutfitId(null)
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
  const outfitsForSale = purchasableOutfits(viewingCharacter?.outfits, viewingCharacter?.sprites, affection, flags)
  const hasShop =
    giftCatalog.length > 0 ||
    itemCatalog.length > 0 ||
    outfitsForSale.length > 0 ||
    (allowedCategories.includes('toy') && toyCatalogAll.length > 0)
  // Counts on the rail so the menu says what's behind a tab without opening it
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
  // Its own pair, distinct from the two above
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
  // Purely a display label (`NewChatDialog`'s Play style picker)
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

  return {
    chat,
    character,
    participantCharacters,
    world,
    onClose,
    onBuyGift,
    onBuyItem,
    onBuyToy,
    onBuyOutfit,
    onAskCommitment,
    onInitiateFirstTime,
    onEndRelationship,
    onNavigateToWorld,
    onIntimacyAction,
    onIntimacyChoice,
    charReplyCount,
    personaName,
    trackedCharacters,
    viewingId,
    setViewingId,
    viewingCharacter,
    track,
    affection,
    stats,
    warmth,
    unlocked,
    flags,
    inventory,
    itemInventory,
    toyInventory,
    milestones,
    nextMilestone,
    relationshipStage,
    giftCatalog,
    itemCatalog,
    gallery,
    upcoming,
    knownFlags,
    commitmentStatus,
    nextTier,
    physical,
    nextTierLockReason,
    eligibleForNextTier,
    asking,
    setAsking,
    ending,
    setEnding,
    initiatingFirstTime,
    setInitiatingFirstTime,
    buyingToyId,
    setBuyingToyId,
    pendingActionId,
    setPendingActionId,
    pendingChoiceEdge,
    setPendingChoiceEdge,
    intimacyProfiles,
    sceneBackgroundId,
    intimacyUnlocked,
    toyCatalogAll,
    unlockedToyIds,
    globalIntimacyLevel,
    afterglowSince,
    afterglowRemaining,
    effectiveIntimacyLevel,
    allowedCategories,
    canTakeFirstTime,
    handleUseIntimacyOption,
    activeScene,
    viewingScene,
    pendingChoice,
    handleChoice,
    buyingOutfitId,
    setBuyingOutfitId,
    handleBuyOutfit,
    handleBuyToy,
    handleInitiateFirstTime,
    tab,
    setTab,
    outfitsForSale,
    hasShop,
    tabs,
    activeTab,
    handleAsk,
    handleEnd,
    overrideValue,
    setOverride,
    vnModeOverrideValue,
    setVnModeOverride,
    setChatMode,
    allEvents,
    events,
    nextTierAskAttempts,
    facts,
    activeFacts,
    newFactText,
    setNewFactText,
    addFact,
    retireFact,
    nextSpriteUnlock,
    nextBackgroundUnlock,
  }
}

export type EditorState = ReturnType<typeof useRelationshipPanel>
