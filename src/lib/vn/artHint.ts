import type { Character } from '@/lib/characters/cardSpec'
import type { WorldCard } from '@/lib/types'

/** "VN mode reads as broken before art exists" — a bare gradient plus a full-bleed avatar looks like a bug, not a "you haven't added art yet" state. */
export function vnArtHint(
  character: Pick<Character, 'id' | 'card' | 'sprites'> | undefined,
  world: Pick<WorldCard, 'name' | 'backgrounds'> | undefined,
  dismissedCharacterIds: readonly string[],
): string | null {
  if (!character || dismissedCharacterIds.includes(character.id)) return null

  const name = character.card.name?.trim() || 'this character'
  const hasSprites = !!character.sprites && Object.keys(character.sprites).length > 0
  const worldHasBackgrounds = !!world?.backgrounds && Object.keys(world.backgrounds).length > 0

  if (!hasSprites) {
    return `No expression sprites for ${name} yet, add art in the character editor's Visual novel tab and it will show here.`
  }
  if (!world) {
    return `${name} isn't bound to a world, so scenes have no background. Assign one from the character editor's Identity tab.`
  }
  if (!worldHasBackgrounds) {
    return `${world.name?.trim() || 'This world'} has no scene backgrounds, add them in the world editor to replace this placeholder.`
  }
  return null
}

/** Same "is there enough art for VN mode to look intentional" check `vnArtHint` makes, as a plain boolean */
export function isVnReady(
  character: Pick<Character, 'id' | 'card' | 'sprites'> | undefined,
  world: Pick<WorldCard, 'name' | 'backgrounds'> | undefined,
): boolean {
  // `vnArtHint` itself returns null for "no character yet" too (nothing to hint about)
  if (!character) return false
  return vnArtHint(character, world, []) === null
}
