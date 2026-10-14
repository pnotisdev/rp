import type { Character, CharacterCardData } from '@/lib/characters/cardSpec'
import type { DraftSections } from '@/lib/characters/generateFullCharacter'

/** The body `charactersApi.create` takes. Typed so a key the character does not have cannot slip in. */
export type CharacterInput = Partial<Omit<Character, 'id' | 'createdAt' | 'updatedAt' | 'card'>> & { card: CharacterCardData }

/** A drafted character flattened into the shape `charactersApi.create` takes. */
export function generatedToCharacterInput(generated: DraftSections): CharacterInput {
  const { card, profile, bonds, outfits, characterBook, extras } = generated
  return {
    // The lorebook lives inside the card, exactly as the editor sets it.
    card: characterBook ? { ...card, character_book: characterBook } : card,
    ...(outfits?.length ? { outfits } : {}),
    ...(profile
      ? {
          occupation: profile.occupation,
          workplace: profile.workplace,
          homeLocation: profile.homeLocation,
          frequentedLocations: profile.frequentedLocations,
          likes: profile.likes,
          goals: profile.goals,
          boundaries: profile.boundaries,
          loveLanguage: profile.loveLanguage,
        }
      : {}),
    ...(bonds
      ? {
          giftLikes: bonds.giftLikes,
          giftDislikes: bonds.giftDislikes,
          relationshipStarters: bonds.relationshipStarters,
          ...(bonds.weatherLoves.length || bonds.weatherHates.length
            ? { weatherPreferences: { loves: bonds.weatherLoves, hates: bonds.weatherHates } }
            : {}),
        }
      : {}),
    ...extras,
  }
}
