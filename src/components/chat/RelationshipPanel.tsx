import type { Character, GalleryEntry } from '@/lib/characters/cardSpec'
import type { Chat, WorldCard } from '@/lib/types'
import { getGiftCatalog } from '@/lib/dating/gifts'
import {
  computeWarmth,
  formatRelationshipStage,
  getRelationshipStats,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
  SCENE_FLAGS,
} from '@/lib/dating/stage'
import { Button } from '@/components/ui/Button'

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

export function RelationshipPanel({ chat, character, world, onClose, onBuyGift }: RelationshipPanelProps) {
  const affection = Math.max(0, Math.min(100, chat.affection ?? 0))
  const stats = getRelationshipStats(chat)
  const warmth = computeWarmth(affection, stats)
  const unlocked = new Set(chat.unlockedGalleryIds ?? [])
  const flags = new Set(chat.sceneFlags ?? [])
  const inventory = chat.giftInventory ?? {}
  const milestones = relationshipMilestonesFor(world?.relationshipThresholds)
  const nextMilestone = milestones.find((m) => warmth < m.at)
  const relationshipStage = relationshipStageForWarmth(warmth, milestones)
  const giftCatalog = getGiftCatalog(world)
  const gallery = character?.gallery ?? []
  const upcoming = upcomingGallery(gallery, unlocked, affection, flags)
  const knownFlags = SCENE_FLAGS

  const nextSpriteUnlock = Object.entries(character?.spriteUnlocks ?? {})
    .filter(([, n]) => Number(n) > affection)
    .sort((a, b) => Number(a[1]) - Number(b[1]))[0]
  const nextBackgroundUnlock = Object.entries(world?.backgroundUnlocks ?? {})
    .filter(([, n]) => Number(n) > affection)
    .sort((a, b) => Number(a[1]) - Number(b[1]))[0]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-bg-elevated p-7 themed-shadow">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Relationship</h2>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="mb-4 rounded-xl bg-bg-sunken p-4">
          <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
            <span>Bond with {character?.card.name ?? 'Character'}</span>
            <span className="capitalize">
              {formatRelationshipStage(relationshipStage)} • {warmth} warmth
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-bg-elevated">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${warmth}%` }} />
          </div>
          {nextMilestone ? (
            <p className="mt-2 text-xs text-text-muted">
              Next stage: {formatRelationshipStage(nextMilestone.stage)} at {nextMilestone.at} warmth
            </p>
          ) : (
            <p className="mt-2 text-xs text-text-muted">Max stage reached.</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 overflow-y-auto md:grid-cols-2">
          <section className="rounded-xl bg-bg-sunken p-4 md:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-text">Relationship stats</h3>
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
                        className="h-full rounded-full bg-accent/70 transition-[width] duration-500"
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-xl bg-bg-sunken p-4">
            <h3 className="mb-2 text-sm font-semibold text-text">Scene flags</h3>
            <div className="flex flex-wrap gap-2">
              {knownFlags.map((f) => (
                <span key={f} className={`rounded-lg px-2 py-1 text-xs ${flags.has(f) ? 'bg-accent/15 text-accent' : 'bg-bg-elevated text-text-muted'}`}>
                  {f.replace('_', ' ')}
                </span>
              ))}
            </div>
          </section>

          <section className="rounded-xl bg-bg-sunken p-4">
            <h3 className="mb-2 text-sm font-semibold text-text">Upcoming unlocks</h3>
            <div className="space-y-1 text-xs text-text-muted">
              <div>{nextSpriteUnlock ? `Expression ${nextSpriteUnlock[0]} @ ${nextSpriteUnlock[1]}` : 'No locked expressions'}</div>
              <div>{nextBackgroundUnlock ? `Background ${nextBackgroundUnlock[0]} @ ${nextBackgroundUnlock[1]}` : 'No locked backgrounds'}</div>
              <div>{upcoming[0] ? `Gallery: ${upcoming[0].title}${upcoming[0].missingAffection > 0 ? ` (+${upcoming[0].missingAffection} affection)` : ''}` : 'No locked gallery entries'}</div>
            </div>
          </section>

          <section className="rounded-xl bg-bg-sunken p-4 md:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-text">Gift inventory</h3>
            <div className="mb-3 text-xs text-text-muted">Coins: {chat.giftCoins ?? 0}</div>
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
          </section>

          <section className="rounded-xl bg-bg-sunken p-4 md:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-text">Gallery progress</h3>
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
          </section>
        </div>
      </div>
    </div>
  )
}
