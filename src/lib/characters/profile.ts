import type { Character } from './cardSpec'

/** Caps for the more open-ended, free-typed profile lists — an author who keeps adding "likes"
 *  over time shouldn't silently grow this note forever (10f's "ever-growing character card"
 *  concern). `boundaries` is deliberately NOT capped here: it's a character's stated hard limits,
 *  and silently dropping one because there were "too many" is a real content-safety risk, not
 *  just a token-budget nicety — in practice an author writes a handful, never dozens, so leaving
 *  it uncapped costs little and the alternative is actively worse. */
const MAX_LIKES = 8
const MAX_GOALS = 5
const MAX_LOCATIONS = 5
const MAX_SOCIAL_CONNECTIONS = 6

/**
 * Composes 10e's life-context fields (occupation, home/frequented locations, likes/goals/
 * boundaries, social connections) into one compact "Life beyond this scene" line folded into the
 * identity block — this is what lets an authored fact like a character's job or their sister
 * actually reach the model, not just sit in the editor. `undefined` when nothing is set, so it
 * adds nothing to the prompt for a character with none of these fields authored.
 */
export function buildCharacterProfileNote(character: Character): string | undefined {
  const { occupation, workplace, homeLocation, frequentedLocations, likes, goals, boundaries, socialConnections } = character
  const parts: string[] = []
  if (occupation?.trim() || workplace?.trim()) {
    parts.push(
      [occupation?.trim() ? `Works as ${occupation.trim()}` : 'Has a life outside this conversation', workplace?.trim() ? `at ${workplace.trim()}` : '']
        .filter(Boolean)
        .join(' '),
    )
  }
  if (homeLocation?.trim()) parts.push(`Lives at ${homeLocation.trim()}`)
  if (frequentedLocations?.length) parts.push(`Often found at ${frequentedLocations.slice(0, MAX_LOCATIONS).join(', ')}`)
  if (likes?.length) parts.push(`Enjoys ${likes.slice(0, MAX_LIKES).join(', ')}`)
  if (goals?.length) parts.push(`Currently working toward: ${goals.slice(0, MAX_GOALS).join(', ')}`)
  if (boundaries?.length) parts.push(`Hard limits, never crossed even in character: ${boundaries.join(', ')}`)
  if (socialConnections?.length) {
    const roster = socialConnections
      .slice(0, MAX_SOCIAL_CONNECTIONS)
      .map((c) => `${c.name} (${c.relation}${c.notes ? ` — ${c.notes}` : ''})`)
      .join('; ')
    parts.push(`Knows: ${roster}`)
  }
  if (parts.length === 0) return undefined
  return `Life beyond this scene: ${parts.join('. ')}.`
}
