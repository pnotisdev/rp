import type { Character } from '@/lib/characters/cardSpec'
import type { WorldCard } from '@/lib/types'
import { DEFAULT_EXPRESSION_IDS } from '@/lib/vn/expressions'
import { DEFAULT_BACKGROUND_IDS } from '@/lib/vn/backgrounds'

/** Which expression sprite ids the model is allowed to pick for this character right now, gated by `Character.spriteUnlocks` at the… */
export function getUnlockedExpressionIds(character: Character, affection: number): string[] {
  const spriteIds = Object.keys(character.sprites ?? {})
  if (spriteIds.length === 0) return DEFAULT_EXPRESSION_IDS
  const unlocks = character.spriteUnlocks ?? {}
  const unlocked = spriteIds.filter((id) => affection >= Number(unlocks[id] ?? 0))
  return unlocked.length ? unlocked : ['neutral']
}

/** Same idea as `getUnlockedExpressionIds`, for `WorldCard.backgrounds`/`backgroundUnlocks`. */
export function getUnlockedBackgroundIds(world: WorldCard | undefined, affection: number): string[] {
  const ids = Object.keys(world?.backgrounds ?? {})
  if (ids.length === 0) return DEFAULT_BACKGROUND_IDS
  const unlocks = world?.backgroundUnlocks ?? {}
  const unlocked = ids.filter((id) => affection >= Number(unlocks[id] ?? 0))
  return unlocked.length ? unlocked : DEFAULT_BACKGROUND_IDS
}
