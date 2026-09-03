import { chatsApi, messagesApi } from '@/lib/api/client'
import type { Character } from '@/lib/characters/cardSpec'
import { substituteMacros } from '@/lib/characters/macros'
import { computeWarmth, getRelationshipStats, relationshipMilestonesFor, relationshipStageForWarmth } from '@/lib/dating/stage'
import { defaultGiftInventory } from '@/lib/dating/gifts'
import { assistOverridesForTemplate } from '@/lib/world/worldTemplates'
import type { Chat, RelationshipDimension, WorldCard } from '@/lib/types'

function parseGreetingGate(line: string): { minAffection: number; text: string } {
  const match = line.match(/^\s*\[affection>=\s*(\d{1,3})\]\s*/i)
  const minAffection = match ? Math.max(0, Math.min(100, Number(match[1]) || 0)) : 0
  const text = match ? line.slice(match[0].length) : line
  return { minAffection, text: text.trim() }
}

/** Every ungated (no `[affection>=N]` gate) opening line available at creation time — `first_mes` plus `alternate_greetings`, in card order. A gated greeting only becomes reachable via a swipe later, once affection actually clears its bar, so it's never offered here. */
export function availableGreetings(character: Character): string[] {
  return [character.card.first_mes, ...(character.card.alternate_greetings ?? [])]
    .filter((g): g is string => !!g?.trim())
    .map(parseGreetingGate)
    .filter((g) => g.minAffection <= 0)
    .map((g) => g.text)
}

export interface CreateChatOptions {
  character: Character
  world: WorldCard | undefined
  personaId: string
  personaName?: string
  participantIds?: string[]
  startingAffection?: number
  summary?: string
  /** Index into `availableGreetings(character)` — defaults to the card's own opening line (index 0). Pass -1 to start with no opening message at all. */
  greetingIndex?: number
}

/**
 * The one place a chat actually gets created — `NewChatDialog`'s full picker flow and
 * `ChatsPanel`'s one-click "New chat, same character & persona" (section 14's "chat management
 * basics") both call this, so the starting-state fields (gift coins, starting inventory, assist
 * overrides, warmth-derived stage) can't drift between the two entry points the way they would as
 * two independently-maintained copies.
 */
export async function createChat(opts: CreateChatOptions): Promise<Chat> {
  const { character, world, personaId, personaName, participantIds, startingAffection = 0, summary, greetingIndex = 0 } = opts

  // A starter describes existing closeness, not built-up conflict or a curiosity spike, so it only
  // seeds the four warmth-composing dimensions — curiosity/tension stay at a neutral 0.
  const startingStats: Partial<Record<RelationshipDimension, number>> | undefined =
    startingAffection > 0
      ? { trust: startingAffection, chemistry: startingAffection, comfort: startingAffection, respect: startingAffection }
      : undefined
  const warmth = computeWarmth(startingAffection, getRelationshipStats({ relationshipStats: startingStats }))

  const chat = await chatsApi.create({
    characterId: character.id,
    participants: participantIds?.length ? participantIds : undefined,
    personaId,
    title: character.card.name,
    affection: startingAffection,
    relationshipStats: startingStats,
    relationshipStage: relationshipStageForWarmth(warmth, relationshipMilestonesFor(world?.relationshipThresholds)),
    sceneFlags: [],
    giftCoins: 24,
    giftInventory: defaultGiftInventory(world),
    giftsGiven: {},
    unlockedGalleryIds: [],
    summary,
    assistOverrides: assistOverridesForTemplate(world?.template),
  })

  const greetings = availableGreetings(character)
  if (greetingIndex >= 0 && greetings.length > 0) {
    const macroCtx = { charName: character.card.name, userName: personaName || 'You' }
    const rendered = greetings.map((g) => substituteMacros(g, macroCtx))
    const activeSwipe = Math.min(greetingIndex, rendered.length - 1)
    await messagesApi.create({
      chatId: chat.id,
      role: 'char',
      name: character.card.name,
      text: rendered[activeSwipe],
      swipes: rendered,
      activeSwipe,
    })
  }

  return chat
}
