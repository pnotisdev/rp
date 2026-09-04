import { chatsApi, messagesApi } from '@/lib/api/client'
import type { KoboldClient } from '@/lib/api/kobold'
import type { Character } from '@/lib/characters/cardSpec'
import { substituteMacros } from '@/lib/characters/macros'
import { computeWarmth, getRelationshipStats, relationshipMilestonesFor, relationshipStageForWarmth } from '@/lib/dating/stage'
import { defaultGiftInventory } from '@/lib/dating/gifts'
import { assistOverridesForTemplate } from '@/lib/world/worldTemplates'
import { detectGreetingScene } from '@/lib/vn/sceneVision'
import { getUnlockedBackgroundIds, getUnlockedExpressionIds } from '@/lib/vn/unlocks'
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
  /** Optional — when given, fires a best-effort `detectGreetingScene` pass so the static opening greeting gets an expression/background tag too (see that function's doc comment). Omit from a context with no client handy; the chat still works fine, VN mode just starts on a placeholder until the first real reply. */
  client?: KoboldClient
}

/**
 * The one place a chat actually gets created — `NewChatDialog`'s full picker flow and
 * `ChatsPanel`'s one-click "New chat, same character & persona" (section 14's "chat management
 * basics") both call this, so the starting-state fields (gift coins, starting inventory, assist
 * overrides, warmth-derived stage) can't drift between the two entry points the way they would as
 * two independently-maintained copies.
 */
export async function createChat(opts: CreateChatOptions): Promise<Chat> {
  const { character, world, personaId, personaName, participantIds, startingAffection = 0, summary, greetingIndex = 0, client } = opts

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
    const greetingMessage = await messagesApi.create({
      chatId: chat.id,
      role: 'char',
      name: character.card.name,
      text: rendered[activeSwipe],
      swipes: rendered,
      activeSwipe,
    })

    // Best-effort, fire-and-forget — never blocks chat creation/navigation, and a failed or skipped
    // call just leaves VN mode showing its placeholder gradient until the first real reply lands.
    // Only worth a model call when there's actual custom art to pick between; the built-in default
    // ids with no uploaded art are just differently-hued placeholder gradients either way.
    const hasCustomArt =
      Object.values(world?.backgrounds ?? {}).some(Boolean) || Object.keys(character.sprites ?? {}).length > 0
    if (client && hasCustomArt) {
      detectGreetingScene(client, {
        text: rendered[activeSwipe],
        expressionIds: getUnlockedExpressionIds(character, startingAffection),
        backgroundIds: getUnlockedBackgroundIds(world, startingAffection),
      })
        .then((scene) => {
          if (!scene) return
          const swipeScenes = rendered.map((_, i) => (i === activeSwipe ? scene : undefined))
          return messagesApi.update(greetingMessage.id, { scene, swipeScenes })
        })
        .catch(() => {})
    }
  }

  return chat
}
