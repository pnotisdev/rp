import { useState } from 'react'
import { ArrowUpRight, X } from 'lucide-react'
import type { Character, GalleryEntry } from '@/lib/characters/cardSpec'
import type { Chat, WorldCard } from '@/lib/types'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { chatFactsApi, chatsApi, relationshipEventsApi } from '@/lib/api/client'
import { getGiftCatalog } from '@/lib/dating/gifts'
import { getItemCatalog } from '@/lib/dating/items'
import {
  canAskForCommitment,
  canInitiateFirstTime,
  commitmentTierThreshold,
  computeWarmth,
  formatCommitmentStatus,
  formatRelationshipStage,
  combinedSceneFlags,
  getRelationshipStats,
  getRelationshipTrack,
  nextCommitmentTier,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import { allowedIntimacyCategories, composeIntimacyActionText, getUnlockedIntimacyOptions, nextLockedInCategory, type IntimacyCategory, type IntimacyUnlockable } from '@/lib/dating/intimacyCatalog'
import { resolveIntimacyLevel } from '@/lib/prompt/intimacyGuidance'
import { AFTERGLOW_TURNS, afterglowTurnsSince } from '@/lib/dating/aftercare'
import type { CommitmentStatus } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Section } from '@/components/ui/Section'
import { SelectField } from '@/components/ui/Field'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

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

const INTIMACY_CATEGORIES: { id: IntimacyCategory; label: string }[] = [
  { id: 'kissing_spot', label: 'Kissing spots' },
  { id: 'position', label: 'Positions' },
  { id: 'toy', label: 'Toys' },
  { id: 'activity', label: 'Activities' },
]

type PanelTab = 'overview' | 'unlocks' | 'shop' | 'more'

interface RelationshipPanelProps {
  chat: Chat
  character?: Character
  /** Extra characters able to speak in this chat (group scenes) — multi-character relationship tracking's own tab switcher, below. Empty for today's ordinary single-character chats. */
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
  /** The "Customize in World editor" link, when this character has a bound world — jumps straight to its "Dating sim" tab rather than just the world's overview. Absent when there's nowhere to route to (no view-switcher in scope). */
  onNavigateToWorld?: (worldId: string, tab?: string) => void
  /** Clicking an unlocked (and, for toys, owned) intimacy action — sends `composeIntimacyActionText`'s result as the player's own message, same mechanism Quick Replies already use. */
  /** `intimacyOptionId` lets the caller react to *which* action this was — an explicit-tier one switches the character's outfit (`intimateOutfitFor`). */
  onSendAction: (text: string, intimacyOptionId?: string) => void
  /** How many replies the character has given, the unit the aftercare window is counted in (`dating/aftercare.ts`). */
  charReplyCount: number
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

/** The small "Customize in World editor" link shared by the Unlocks and Shop tabs — a no-op render (not a disabled button) with no bound world, since there's genuinely nowhere to send the player. */
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
  onSendAction,
  charReplyCount,
}: RelationshipPanelProps) {
  // Multi-character relationship tracking: everyone this chat actually tracks a relationship for —
  // the primary plus any participant — with a tab switcher below when there's more than one. Falls
  // back to the primary the moment a picked participant leaves the roster (edited mid-chat) rather
  // than silently rendering an empty panel.
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
  const eligibleForNextTier = nextTier ? canAskForCommitment(nextTier, warmth, milestones) : false
  const [asking, setAsking] = useState(false)
  const [ending, setEnding] = useState(false)
  const [initiatingFirstTime, setInitiatingFirstTime] = useState(false)
  const [buyingToyId, setBuyingToyId] = useState<string | null>(null)

  // Eligible (warmth/commitment-met) toys regardless of ownership — the panel itself needs to see
  // an unbought-but-eligible toy too, to render its "Buy" state, unlike the prompt's own call
  // (`useChatSession.ts`), which passes `ownedToyIds` to filter those out before the model ever
  // sees them.
  const intimacyUnlocked = getUnlockedIntimacyOptions(warmth, commitmentStatus, world)
  // The content rating governs this panel too, not just the prompt. Before this, a chat set to
  // fade-to-black still rendered position/toy/activity as clickable buttons that send an explicit
  // action line as the player's own message — the dial held on one surface and not the other.
  // The world's own rating wins over the global setting (`resolveIntimacyLevel`).
  const globalIntimacyLevel = useSettingsStore((st) => st.intimacyLevel)
  // How much of the post-intimacy window is left, or null when none is open (`dating/aftercare.ts`).
  const afterglowSince = afterglowTurnsSince(track.afterglow ?? undefined, charReplyCount)
  const afterglowRemaining =
    afterglowSince !== null && afterglowSince < AFTERGLOW_TURNS ? AFTERGLOW_TURNS - afterglowSince : null
  const effectiveIntimacyLevel = resolveIntimacyLevel(world?.intimacyLevel, globalIntimacyLevel)
  const allowedCategories = allowedIntimacyCategories(effectiveIntimacyLevel)
  const canTakeFirstTime = canInitiateFirstTime(warmth, commitmentStatus)

  const handleUseIntimacyOption = (option: IntimacyUnlockable) => {
    onSendAction(composeIntimacyActionText(option, viewingCharacter?.card.name ?? 'them'), option.id)
    onClose()
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
  const hasShop = giftCatalog.length > 0 || itemCatalog.length > 0
  const tabs: { id: PanelTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'unlocks', label: 'Unlocks' },
    ...(hasShop ? [{ id: 'shop' as const, label: 'Shop' }] : []),
    { id: 'more', label: 'More' },
  ]
  // A shop-less character never gets to see the tab in the first place — nothing to fall out of if
  // gifts/items are ever added later, since this re-derives from the catalogs on every render.
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

  const overrideValue = (key: 'autoTrackRelationship' | 'autoSuggestChoices' | 'visualNovelMode'): 'default' | 'on' | 'off' => {
    const v = chat.assistOverrides?.[key]
    return v === undefined ? 'default' : v ? 'on' : 'off'
  }
  const setOverride = async (key: 'autoTrackRelationship' | 'autoSuggestChoices' | 'visualNovelMode', value: 'default' | 'on' | 'off') => {
    const next = { ...(chat.assistOverrides ?? {}) }
    if (value === 'default') delete next[key]
    else next[key] = value === 'on'
    await chatsApi.update(chat.id, { assistOverrides: next })
  }

  const allEvents = useApiQuery('relationship-events', () => relationshipEventsApi.listByChat(chat.id), [chat.id]) ?? []
  // `characterId` is unset on every event logged before multi-character tracking existed — those
  // all belonged to the primary, so treat a missing id as a match for whichever character IS the
  // primary rather than only ever matching an explicit id.
  const events = allEvents.filter((e) => (e.characterId ?? chat.characterId) === viewingCharacter?.id)
  const facts = useApiQuery('chat-facts', () => chatFactsApi.listByChat(chat.id), [chat.id]) ?? []
  const activeFacts = facts.filter((f) => f.active)
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
    <Modal onClose={onClose} title="Relationship" size="3xl" scrollable>
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Pinned: never scrolls away, regardless of which tab below is open. */}
      <div className="shrink-0">
      {trackedCharacters.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5 rounded-xl bg-bg-sunken p-1.5">
          {trackedCharacters.map((c) => (
            <button
              key={c.id}
              onClick={() => setViewingId(c.id)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm capitalize transition-colors ${
                viewingCharacter?.id === c.id ? 'bg-bg-elevated text-text themed-shadow' : 'text-text-muted hover:text-text'
              }`}
            >
              {c.card.name}
            </button>
          ))}
        </div>
      )}

      {/* Pinned above the tabs — the things worth seeing no matter which tab is open: how close
          things are, what's going on emotionally right now, and (if things are genuinely at risk)
          the one banner that shouldn't ever be a tab-click away. */}
      <div className="mb-4 rounded-xl bg-bg-sunken p-4">
        <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
          <span>Bond with {viewingCharacter?.card.name ?? 'Character'}</span>
          <span className="capitalize">
            {formatRelationshipStage(relationshipStage)} • {warmth} warmth
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-bg-elevated">
          <div className="h-full rounded-full bg-romance transition-[width] duration-500" style={{ width: `${warmth}%` }} />
        </div>
        {nextMilestone ? (
          <p className="mt-2 text-xs text-text-muted">
            Next stage: {formatRelationshipStage(nextMilestone.stage)} at {nextMilestone.at} warmth
          </p>
        ) : (
          <p className="mt-2 text-xs text-text-muted">Max stage reached.</p>
        )}
        {(track.mood || track.currentNeed) && (
          <p className="mt-2 border-t border-bg-elevated pt-2 text-xs italic text-text-muted">
            Right now: {[track.mood, track.currentNeed ? `could use more ${track.currentNeed}` : ''].filter(Boolean).join(' · ')}
            {' — '}a passing read, separate from the bond above.
          </p>
        )}
        {afterglowRemaining !== null && (
          // Deliberately says what's true without saying what to do: the whole point of the window
          // is that it scores what the player does with it, and printing "be warm to them" would
          // turn a read of the character into a checklist.
          <p className="mt-2 border-t border-bg-elevated pt-2 text-xs italic text-romance">
            Still in the hours after being intimate — {afterglowRemaining} more{' '}
            {afterglowRemaining === 1 ? 'reply' : 'replies'} before it settles into how it felt.
          </p>
        )}
      </div>

      {track.relationshipWarning && (
        <div className="mb-4 rounded-xl border border-danger/40 bg-danger/10 p-4">
          <div className="text-sm font-semibold text-danger">On the rocks</div>
          <p className="mt-1 text-xs text-text-muted">
            {track.relationshipWarning.reason.charAt(0).toUpperCase() + track.relationshipWarning.reason.slice(1)} — if this
            isn't resolved soon, the relationship will break on its own.
          </p>
        </div>
      )}

      <div className="mb-4 flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-3 py-2 text-sm transition-colors ${
              activeTab === t.id ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      </div>

      {/* The only part that actually scrolls — bounded by the Modal's own max-height, so no tab
          can ever push the panel taller than the viewport regardless of how much it holds. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-bg-sunken p-4">
            <div>
              <div className="text-xs text-text-muted">Status</div>
              <div className="text-sm capitalize text-text">{formatCommitmentStatus(commitmentStatus)}</div>
              {track.breakupCount ? (
                <div className="mt-0.5 text-[11px] text-text-muted">
                  Broken up before ({track.breakupCount}×) — trust, comfort, and chemistry still carry that scar.
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
                  <Button variant="primary" onClick={handleAsk} disabled={asking}>
                    {asking ? 'Asking…' : `Ask to be ${formatCommitmentStatus(nextTier)}`}
                  </Button>
                ) : (
                  <div className="text-right text-xs text-text-muted">
                    {formatCommitmentStatus(nextTier)} unlocks at {commitmentTierThreshold(nextTier, milestones)} warmth
                  </div>
                ))}
            </div>
          </div>

          <Section title="Relationship stats" surface="sunken">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              {ALL_STAT_KEYS.map((key) => {
                const value = key === 'affection' ? affection : stats[key]
                return (
                  <div key={key}>
                    <div className="mb-0.5 flex items-center justify-between text-[11px] text-text-muted">
                      <span>{DIMENSION_LABELS[key]}</span>
                      <span>{value}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-bg-elevated">
                      <div
                        // Tension isn't a "more is better" romance dimension the way the other six
                        // are (see its glossary entry — rising tension "is not automatically a bad
                        // thing dramatically") — it stays neutral so its bar doesn't read as
                        // "progress" the way the romance-tinted ones do.
                        className={`h-full rounded-full transition-[width] duration-500 ${key === 'tension' ? 'bg-text-muted/50' : 'bg-romance/70'}`}
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
        <div className="space-y-4">
          <Section title="Scene flags" surface="sunken">
            <div className="flex flex-wrap gap-2">
              {knownFlags.map((f) => (
                <span key={f.id} className={`rounded-lg px-2 py-1 text-xs ${flags.has(f.id) ? 'bg-romance/15 text-romance' : 'bg-bg-elevated text-text-muted'}`}>
                  {f.label}
                </span>
              ))}
            </div>
          </Section>

          <Section
            title="Intimate unlocks"
            description="Kissing spots, positions, toys, and other beats this relationship has earned — click one to do it now."
            surface="sunken"
          >
            <div className="space-y-3">
              {INTIMACY_CATEGORIES.filter((c) => allowedCategories.includes(c.id)).map(({ id, label }) => {
                const items = intimacyUnlocked.filter((i) => i.category === id)
                const next = nextLockedInCategory(id, warmth, commitmentStatus, world)
                return (
                  <div key={id}>
                    <div className="mb-1 text-[11px] font-medium text-text-muted">{label}</div>
                    {items.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {items.map((i) => {
                          // A toy with no authored price (a world author left it unset) is treated
                          // as free/pre-owned, same as every non-toy category — only an actually
                          // priced, not-yet-bought toy needs the purchase step.
                          const needsPurchase = i.category === 'toy' && (i.price ?? 0) > 0 && (toyInventory[i.id] ?? 0) <= 0
                          if (!needsPurchase) {
                            return (
                              <button
                                key={i.id}
                                onClick={() => handleUseIntimacyOption(i)}
                                title={`${i.label} — click to do this now`}
                                className="rounded-lg bg-romance/15 px-2 py-1 text-xs text-romance transition-colors hover:bg-romance/25"
                              >
                                {i.label}
                              </button>
                            )
                          }
                          return (
                            <button
                              key={i.id}
                              onClick={() => handleBuyToy(i.id)}
                              disabled={buyingToyId === i.id || (chat.giftCoins ?? 0) < (i.price ?? 0)}
                              title={`Buy ${i.label} for ${i.price} coins`}
                              className="rounded-lg border border-romance/40 px-2 py-1 text-xs text-romance/80 transition-colors hover:bg-romance/10 disabled:opacity-40"
                            >
                              {buyingToyId === i.id ? 'Buying…' : `${i.label} · ${i.price}c`}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="text-xs text-text-muted">Nothing unlocked yet.</div>
                    )}
                    {next && (
                      <div className="mt-1 text-[11px] text-text-muted">
                        Next: {next.label} at {next.minWarmth} warmth
                        {next.minCommitment ? ` and ${formatCommitmentStatus(next.minCommitment)}` : ''}.
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Section>

          {(canTakeFirstTime || track.firstIntimateSceneAt) && (
            <Section title="Milestone" surface="sunken">
              {track.firstIntimateSceneAt ? (
                <p className="text-xs text-text-muted">Already happened — their first time together.</p>
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

          <Section title="Progress" surface="sunken">
            <div className="space-y-1 text-xs text-text-muted">
              <div>{nextSpriteUnlock ? `Expression ${nextSpriteUnlock[0]} @ ${nextSpriteUnlock[1]}` : 'No locked expressions'}</div>
              <div>{nextBackgroundUnlock ? `Background ${nextBackgroundUnlock[0]} @ ${nextBackgroundUnlock[1]}` : 'No locked backgrounds'}</div>
              {upcoming.slice(0, 4).map((g) => (
                <div key={g.id}>
                  Gallery: {g.title}
                  {g.missingAffection > 0 ? ` (+${g.missingAffection} affection)` : ''}
                  {g.missingFlags.length > 0 ? ` — missing flags: ${g.missingFlags.join(', ')}` : ''}
                </div>
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
          <Section title="Gift inventory" description={`Coins: ${chat.giftCoins ?? 0}`} surface="sunken">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {giftCatalog.map((gift) => {
                const qty = inventory[gift.id] ?? 0
                return (
                  <div key={gift.id} className="rounded-lg bg-bg-elevated p-3">
                    <div className="text-sm text-text">{gift.name}</div>
                    <div className="text-xs text-text-muted">{gift.rarity} • {gift.price} coins • owned {qty}</div>
                    <Button className="mt-2" onClick={() => onBuyGift(gift.id)} disabled={(chat.giftCoins ?? 0) < gift.price}>
                      Buy
                    </Button>
                  </div>
                )
              })}
            </div>
          </Section>

          {itemCatalog.length > 0 && (
            <Section title="Item shop" description="Buy here, use from the Bag for an immediate effect." surface="sunken">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {itemCatalog.map((item) => {
                  const qty = itemInventory[item.id] ?? 0
                  return (
                    <div key={item.id} className="rounded-lg bg-bg-elevated p-3">
                      <div className="text-sm text-text">{item.name}</div>
                      <div className="text-xs text-text-muted">{item.rarity} • {item.price} coins • owned {qty}</div>
                      <Button className="mt-2" onClick={() => onBuyItem(item.id)} disabled={(chat.giftCoins ?? 0) < item.price}>
                        Buy
                      </Button>
                    </div>
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
        <div className="space-y-4">
          <Section title="Chat settings" surface="sunken" contentClassName="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              hint="Overrides the global Settings → Appearance default, just for this chat."
              value={overrideValue('visualNovelMode')}
              onChange={(e) => setOverride('visualNovelMode', e.target.value as 'default' | 'on' | 'off')}
            >
              <option value="default">Use global default</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </SelectField>
          </Section>

          {/* Chat-wide, not per-character — a durable fact ("allergic to cats") isn't owed to
              whichever tab happens to be selected, so this stays the same across the switcher above. */}
          <Section title="What's remembered in this chat" surface="sunken">
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
                placeholder="Add a fact by hand — e.g. 'Allergic to cats'"
                className="flex-1 rounded-xl bg-bg-elevated px-3 py-2 text-xs text-text outline-none"
              />
              <Button onClick={addFact} disabled={!newFactText.trim()}>Add</Button>
            </div>
          </Section>

          <details className="rounded-xl bg-bg-sunken p-4">
            <summary className="cursor-pointer text-sm font-semibold text-text">History ({events.length})</summary>
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
