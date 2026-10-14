import { chatsApi, messagesApi } from '@/lib/api/client'
import type { ChatBackend } from '@/lib/api/chatBackend'
import type { Character } from '@/lib/characters/cardSpec'
import { substituteMacros } from '@/lib/characters/macros'
import { computeWarmth, getRelationshipStats, relationshipMilestonesFor, relationshipStageForWarmth } from '@/lib/dating/stage'
import { defaultGiftInventory } from '@/lib/dating/gifts'
import { assistOverridesForTemplate, normalizeWorldTemplateId, type WorldTemplateId } from '@/lib/world/worldTemplates'
import { detectGreetingScene } from '@/lib/vn/sceneVision'
import { getUnlockedBackgroundIds, getUnlockedExpressionIds } from '@/lib/vn/unlocks'
import { backgroundLabel, matchBackgroundKeyword } from '@/lib/vn/backgrounds'
import type { SceneTag } from '@/lib/vn/sceneTag'
import type { Chat, RelationshipDimension, WorldCard } from '@/lib/types'
import { seedDriveFromPreviousChat } from '@/lib/persona/inherit'

function parseGreetingGate(line: string): { minAffection: number; text: string } {
  const match = line.match(/^\s*\[affection>=\s*(\d{1,3})\]\s*/i)
  const minAffection = match ? Math.max(0, Math.min(100, Number(match[1]) || 0)) : 0
  const text = match ? line.slice(match[0].length) : line
  return { minAffection, text: text.trim() }
}

/** A live-persona character needs the relationship judge for mood and remembered facts, even in a mode that hides romance mechanics. */
function driveAwareOverrides<T extends { autoTrackRelationship?: boolean }>(character: Character, overrides: T): T {
  if (!character.drive?.enabled || overrides.autoTrackRelationship !== false) return overrides
  const { autoTrackRelationship: _off, ...rest } = overrides
  return rest as T
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
  client?: ChatBackend
  /** The play-style chip picked in `NewChatDialog` */
  mode?: WorldTemplateId
}

/** The one place a chat actually gets created */
export async function createChat(opts: CreateChatOptions): Promise<Chat> {
  const { character, world, personaId, personaName, participantIds, startingAffection = 0, summary, greetingIndex = 0, client, mode } = opts

  // A starter describes existing closeness, not built-up conflict or a curiosity spike
  const startingStats: Partial<Record<RelationshipDimension, number>> | undefined =
    startingAffection > 0
      ? { trust: startingAffection, chemistry: startingAffection, comfort: startingAffection, respect: startingAffection }
      : undefined
  const warmth = computeWarmth(startingAffection, getRelationshipStats({ relationshipStats: startingStats }))
  // Normalizes here (not just at read time) so a chat created against a world still carrying a retired template id (e.g. old data…
  const resolvedMode = normalizeWorldTemplateId(mode ?? world?.template)

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
    mode: resolvedMode,
    assistOverrides: driveAwareOverrides(character, assistOverridesForTemplate(resolvedMode)),
  })

  await seedDriveFromPreviousChat(character, chat.id).catch(() => {})

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

    // Best-effort, fire-and-forget — never blocks chat creation/navigation
    const hasCustomArt =
      Object.values(world?.backgrounds ?? {}).some(Boolean) || Object.keys(character.sprites ?? {}).length > 0
    const greetingText = rendered[activeSwipe]
    const backgroundIds = getUnlockedBackgroundIds(world, startingAffection)
    // Free, deterministic and always available, unlike the model pass below
    const keywordGuess = (): SceneTag | null => {
      const bg = matchBackgroundKeyword(
        greetingText,
        backgroundIds.map((id) => ({ id, label: backgroundLabel(id, world) })),
      )
      return bg ? { background: bg } : null
    }
    const applyScene = (scene: SceneTag | null) => {
      if (!scene) return
      const swipeScenes = rendered.map((_, i) => (i === activeSwipe ? scene : undefined))
      const writes: Promise<unknown>[] = [messagesApi.update(greetingMessage.id, { scene, swipeScenes })]
      // Seed the chat's own scene location from the resolved background so the prompt's schedule-presence framing has an established…
      if (scene.background) {
        writes.push(
          chatsApi.update(chat.id, {
            scene: { turnPolicy: 'manual', location: backgroundLabel(scene.background, world) },
          }),
        )
      }
      return Promise.all(writes)
    }
    if (client && hasCustomArt) {
      detectGreetingScene(client, {
        text: greetingText,
        expressionIds: getUnlockedExpressionIds(character, startingAffection),
        backgroundIds,
      })
        .then((scene) => {
          // Keyword guess supplies the background as a baseline
          const merged = { ...keywordGuess(), ...scene }
          return applyScene(Object.keys(merged).length ? merged : null)
        })
        .catch(() => {})
    } else {
      applyScene(keywordGuess())?.catch(() => {})
    }
  }

  return chat
}
