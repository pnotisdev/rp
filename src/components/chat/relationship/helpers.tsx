import {
  ArrowUpRight,
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  type LucideIcon,
} from 'lucide-react'
import type { Character, GalleryEntry } from '@/lib/characters/cardSpec'
import type { Chat, WorldCard } from '@/lib/types'
import {
  type IntimacyCategory,
  type IntimacyUnlockable,
} from '@/lib/dating/intimacyCatalog'
import type { CommitmentStatus } from '@/lib/types'


/** The "Relationship" modal: bond/warmth summary, per-dimension stats, intimacy unlocks, the gift/ item/toy shop */
export const ALL_STAT_KEYS =['affection', 'trust', 'chemistry', 'comfort', 'respect', 'curiosity', 'tension'] as const

export const DIMENSION_LABELS: Record<(typeof ALL_STAT_KEYS)[number], string> = {
  affection: 'Affection',
  trust: 'Trust',
  chemistry: 'Chemistry',
  comfort: 'Comfort',
  respect: 'Respect',
  curiosity: 'Curiosity',
  tension: 'Tension',
}

/** One "what unlocks next" line: a glyph, what it is, and the number it's waiting on. */
export function ProgressRow({ icon: Icon, label, at }: { icon: LucideIcon; label: string; at?: string | number }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={11} strokeWidth={1.75} className="shrink-0 opacity-60" />
      <span className="min-w-0 truncate">{label}</span>
      {at !== undefined && <span className="ml-auto shrink-0 tabular-nums opacity-70">@ {at}</span>}
    </div>
  )
}

/** A count riding on a tab-rail label, e.g. how many intimate options are unlocked. */
export function RailCount({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-current/15 px-1.5 text-[11px] font-medium tabular-nums opacity-80">{children}</span>
  )
}

export const INTIMACY_CATEGORIES: { id: IntimacyCategory; label: string }[] = [
  { id: 'affection', label: 'Closeness' },
  { id: 'kissing_spot', label: 'Kissing spots' },
  { id: 'position', label: 'Positions' },
  { id: 'toy', label: 'Toys' },
  { id: 'activity', label: 'Activities' },
]

export type PanelTab = 'overview' | 'unlocks' | 'shop' | 'more'

export interface RelationshipPanelProps {
  chat: Chat
  character?: Character
  /** Extra characters able to speak in this chat (group scenes); drives the tab switcher below. */
  participantCharacters?: Character[]
  world?: WorldCard
  onClose: () => void
  onBuyGift: (giftId: string) => Promise<void>
  onBuyItem: (itemId: string) => Promise<void>
  onBuyToy: (toyId: string) => Promise<void>
  /** Buying a wardrobe state for this character — see `purchasableOutfits`. */
  onBuyOutfit: (characterId: string, outfitId: string) => Promise<void>
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

export function upcomingGallery(gallery: GalleryEntry[], unlocked: Set<string>, affection: number, flags: Set<string>) {
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

export function formatDeltas(deltas: Partial<Record<string, number>>): string {
  return Object.entries(deltas)
    .filter(([, v]) => v)
    .map(([key, v]) => `${(v as number) > 0 ? '+' : ''}${v} ${DIMENSION_LABELS[key as keyof typeof DIMENSION_LABELS] ?? key}`)
    .join(', ')
}

/** Shared by the Unlocks and Shop tabs; renders nothing when there's no bound world to send the player to. */
export function CustomizeLink({ world, onNavigateToWorld }: { world?: WorldCard; onNavigateToWorld?: (worldId: string, tab?: string) => void }) {
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
