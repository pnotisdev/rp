import { useState } from 'react'
import { X } from 'lucide-react'
import type { Character, GalleryEntry } from '@/lib/characters/cardSpec'
import type { Chat, WorldCard } from '@/lib/types'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { chatFactsApi, relationshipEventsApi } from '@/lib/api/client'
import { getGiftCatalog } from '@/lib/dating/gifts'
import { getItemCatalog } from '@/lib/dating/items'
import {
  canAskForCommitment,
  commitmentTierThreshold,
  computeWarmth,
  formatCommitmentStatus,
  formatRelationshipStage,
  combinedSceneFlags,
  getRelationshipStats,
  nextCommitmentTier,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import type { CommitmentStatus } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Section } from '@/components/ui/Section'

const ALL_STAT_KEYS = ['affection', 'trust', 'chemistry', 'comfort', 'respect', 'curiosity', 'tension'] as const

const DIMENSION_LABELS: Record<(typeof ALL_STAT_KEYS)[number], string> = {
  affection: 'Affection',
  trust: 'Trust',
  chemistry: 'Chemistry',
  comfort: 'Comfort',
  respect: 'Respect',
  curiosity: 'Curiosity',
  tension: 'Tension',
}

interface RelationshipPanelProps {
  chat: Chat
  character?: Character
  world?: WorldCard
  onClose: () => void
  onBuyGift: (giftId: string) => Promise<void>
  onBuyItem: (itemId: string) => Promise<void>
  onAskCommitment: (tier: Exclude<CommitmentStatus, 'none'>) => Promise<void>
  onEndRelationship: () => Promise<void>
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

export function RelationshipPanel({ chat, character, world, onClose, onBuyGift, onBuyItem, onAskCommitment, onEndRelationship }: RelationshipPanelProps) {
  const affection = Math.max(0, Math.min(100, chat.affection ?? 0))
  const stats = getRelationshipStats(chat)
  const warmth = computeWarmth(affection, stats)
  const unlocked = new Set(chat.unlockedGalleryIds ?? [])
  const flags = new Set(chat.sceneFlags ?? [])
  const inventory = chat.giftInventory ?? {}
  const itemInventory = chat.itemInventory ?? {}
  const milestones = relationshipMilestonesFor(world?.relationshipThresholds)
  const nextMilestone = milestones.find((m) => warmth < m.at)
  const relationshipStage = relationshipStageForWarmth(warmth, milestones)
  const giftCatalog = getGiftCatalog(world)
  const itemCatalog = getItemCatalog(world)
  const gallery = character?.gallery ?? []
  const upcoming = upcomingGallery(gallery, unlocked, affection, flags)
  const knownFlags = combinedSceneFlags(world?.customSceneFlags)
  const commitmentStatus = chat.commitmentStatus ?? 'none'
  const nextTier = nextCommitmentTier(commitmentStatus)
  const eligibleForNextTier = nextTier ? canAskForCommitment(nextTier, warmth, milestones) : false
  const [asking, setAsking] = useState(false)
  const [ending, setEnding] = useState(false)

  const handleAsk = async () => {
    if (!nextTier) return
    setAsking(true)
    try {
      await onAskCommitment(nextTier)
    } finally {
      setAsking(false)
    }
  }

  const handleEnd = async () => {
    if (!confirm(`End things with ${character?.card.name ?? 'them'}? This can be undone later, but it leaves a lasting mark on the relationship.`)) return
    setEnding(true)
    try {
      await onEndRelationship()
    } finally {
      setEnding(false)
    }
  }

  const events = useApiQuery('relationship-events', () => relationshipEventsApi.listByChat(chat.id), [chat.id]) ?? []
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

  const nextSpriteUnlock = Object.entries(character?.spriteUnlocks ?? {})
    .filter(([, n]) => Number(n) > affection)
    .sort((a, b) => Number(a[1]) - Number(b[1]))[0]
  const nextBackgroundUnlock = Object.entries(world?.backgroundUnlocks ?? {})
    .filter(([, n]) => Number(n) > affection)
    .sort((a, b) => Number(a[1]) - Number(b[1]))[0]

  return (
    <Modal onClose={onClose} title="Relationship" size="3xl" scrollable>
        <div className="mb-4 rounded-xl bg-bg-sunken p-4">
          <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
            <span>Bond with {character?.card.name ?? 'Character'}</span>
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
        </div>

        <div className="mb-4 flex items-center justify-between rounded-xl bg-bg-sunken p-4">
          <div>
            <div className="text-xs text-text-muted">Status</div>
            <div className="text-sm capitalize text-text">{formatCommitmentStatus(commitmentStatus)}</div>
            {chat.breakupCount ? (
              <div className="mt-0.5 text-[11px] text-text-muted">
                Broken up before ({chat.breakupCount}×) — trust, comfort, and chemistry still carry that scar.
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

        {chat.relationshipWarning && (
          <div className="mb-4 rounded-xl border border-danger/40 bg-danger/10 p-4">
            <div className="text-sm font-semibold text-danger">On the rocks</div>
            <p className="mt-1 text-xs text-text-muted">
              {chat.relationshipWarning.reason.charAt(0).toUpperCase() + chat.relationshipWarning.reason.slice(1)} — if this
              isn't resolved soon, the relationship will break on its own.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 overflow-y-auto md:grid-cols-2">
          <Section title="Relationship stats" surface="sunken" className="md:col-span-2">
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

          <Section title="Scene flags" surface="sunken">
            <div className="flex flex-wrap gap-2">
              {knownFlags.map((f) => (
                <span key={f.id} className={`rounded-lg px-2 py-1 text-xs ${flags.has(f.id) ? 'bg-romance/15 text-romance' : 'bg-bg-elevated text-text-muted'}`}>
                  {f.label}
                </span>
              ))}
            </div>
          </Section>

          <Section title="Upcoming unlocks" surface="sunken">
            <div className="space-y-1 text-xs text-text-muted">
              <div>{nextSpriteUnlock ? `Expression ${nextSpriteUnlock[0]} @ ${nextSpriteUnlock[1]}` : 'No locked expressions'}</div>
              <div>{nextBackgroundUnlock ? `Background ${nextBackgroundUnlock[0]} @ ${nextBackgroundUnlock[1]}` : 'No locked backgrounds'}</div>
              <div>{upcoming[0] ? `Gallery: ${upcoming[0].title}${upcoming[0].missingAffection > 0 ? ` (+${upcoming[0].missingAffection} affection)` : ''}` : 'No locked gallery entries'}</div>
            </div>
          </Section>

          <Section title="Gift inventory" description={`Coins: ${chat.giftCoins ?? 0}`} surface="sunken" className="md:col-span-2">
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
            <Section
              title="Item shop"
              description="Buy here, use from the Bag for an immediate effect."
              surface="sunken"
              className="md:col-span-2"
            >
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

          <Section title="Gallery progress" surface="sunken" className="md:col-span-2">
            <div className="space-y-2">
              {upcoming.slice(0, 5).map((g) => (
                <div key={g.id} className="rounded-lg bg-bg-elevated px-3 py-2 text-xs text-text-muted">
                  <div className="text-text">{g.title}</div>
                  <div>
                    {g.missingAffection > 0 ? `Need +${g.missingAffection} affection.` : 'Affection requirement met.'}
                    {g.missingFlags.length > 0 ? ` Missing flags: ${g.missingFlags.join(', ')}` : ''}
                  </div>
                </div>
              ))}
              {upcoming.length === 0 && <div className="text-xs text-text-muted">Everything unlocked for this character.</div>}
            </div>
          </Section>

          <Section title={`What ${character?.card.name ?? 'they'} remembers`} surface="sunken" className="md:col-span-2">
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

          <details className="rounded-xl bg-bg-sunken p-4 md:col-span-2">
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
    </Modal>
  )
}
