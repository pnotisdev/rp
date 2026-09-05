import type { Character } from '@/lib/characters/cardSpec'
import type { WorldCard } from '@/lib/types'

/**
 * "VN mode reads as broken before art exists" — a bare gradient plus a full-bleed avatar looks like
 * a bug, not a "you haven't added art yet" state. This names the *one specific* missing piece so the
 * hint in `VNStage` is actionable: sprites are a character concept and backgrounds a world one, and
 * a user often doesn't realise those are set up separately.
 *
 * Order matters — a character with no sprites gets told that first (it's the bigger gap and the
 * thing most under their control), then the world/background chain. Returns `null` once there's
 * enough art for VN mode to look intentional, or when the user has dismissed the hint for this
 * character.
 */
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
    return `No expression sprites for ${name} yet — add art in the character editor's Visual novel tab and it will show here.`
  }
  if (!world) {
    return `${name} isn't bound to a world, so scenes have no background. Assign one from the character editor's Identity tab.`
  }
  if (!worldHasBackgrounds) {
    return `${world.name?.trim() || 'This world'} has no scene backgrounds — add them in the world editor to replace this placeholder.`
  }
  return null
}
