import type { GeneratedCharacter } from '@/lib/assistant/thread'

/** A generated character flattened into the shape `charactersApi.create` takes. */
export function generatedToCharacterInput(generated: GeneratedCharacter): Record<string, unknown> {
  const { card, profile, bonds, outfits, characterBook } = generated
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
          weatherLoves: bonds.weatherLoves,
          weatherHates: bonds.weatherHates,
          relationshipStarters: bonds.relationshipStarters,
        }
      : {}),
  }
}
