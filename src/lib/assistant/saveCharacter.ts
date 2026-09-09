import type { GeneratedCharacter } from '@/lib/assistant/thread'

/**
 * A generated character flattened into the shape `charactersApi.create` takes.
 *
 * The staged generator returns its stages as separate objects (`profile`, `bonds`, …) because the
 * character editor applies each to its own form fields. Saving straight from a thread has no form to
 * apply them to, so the same mapping happens here instead — kept as a pure function, and kept beside
 * the thread types rather than inline in the hook, because getting it wrong silently drops half of a
 * generated character and nothing would fail loudly.
 *
 * Mirrors `CharacterEditor`'s own `onGenerated` handler field for field; if that gains a stage, this
 * has to gain it too.
 */
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
