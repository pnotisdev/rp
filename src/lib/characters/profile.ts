import type { Character, VoiceFingerprint } from './cardSpec'

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
const MAX_TICS = 6
const MAX_CATCHPHRASES = 5

/**
 * Composes 10e's life-context fields (occupation, home/frequented locations, likes/goals/
 * boundaries, social connections) into one compact "Life beyond this scene" line folded into the
 * identity block — this is what lets an authored fact like a character's job or their sister
 * actually reach the model, not just sit in the editor. `undefined` when nothing is set, so it
 * adds nothing to the prompt for a character with none of these fields authored.
 */
function buildLifeContextNote(character: Character): string | undefined {
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

/**
 * Folds an authored `VoiceFingerprint` (`cardSpec.ts`) into one compact instruction line — the
 * mechanism that makes it more than an editor field nobody reads. Deliberately its own sentence
 * rather than appended into `buildLifeContextNote`'s "Life beyond this scene" line: those are
 * in-fiction facts, this is a style directive, and folding them together would bury a "keep this
 * consistent every turn" instruction inside a paragraph about backstory. `undefined` when the
 * character has no fingerprint authored, so it costs nothing for every character that predates
 * this field (which is all of them).
 */
function buildVoiceFingerprintNote(fingerprint: VoiceFingerprint | undefined): string | undefined {
  if (!fingerprint) return undefined
  const bits: string[] = []
  if (fingerprint.verbalTics?.length) {
    bits.push(`verbal tics: ${fingerprint.verbalTics.slice(0, MAX_TICS).map((t) => `"${t}"`).join(', ')}`)
  }
  if (fingerprint.catchphrases?.length) {
    bits.push(`catchphrases they reuse: ${fingerprint.catchphrases.slice(0, MAX_CATCHPHRASES).map((c) => `"${c}"`).join(', ')}`)
  }
  if (fingerprint.dialectNotes?.trim()) bits.push(`dialect/register: ${fingerprint.dialectNotes.trim()}`)
  if (fingerprint.sentenceRhythm?.trim()) bits.push(`sentence rhythm: ${fingerprint.sentenceRhythm.trim()}`)
  if (bits.length === 0) return undefined
  return `Speech patterns to stay consistent with, every turn: ${bits.join('; ')}.`
}

/**
 * A second, much shorter restatement of only the single most load-bearing fingerprint elements —
 * one catchphrase, one verbal tic, and the register/rhythm note — as its own compact, imperative
 * line, deliberately separate from `buildVoiceFingerprintNote`'s fuller list above.
 *
 * The problem this exists to fix: on a weak or heavily-RLHF'd model, a distinctive voice tends to
 * get smoothed into generic romance-novel prose over a long chat, and a signal buried mid-list in a
 * longer paragraph (surrounded by tics, catchphrases, dialect notes, AND sentence rhythm all at
 * once) is the first thing that gets diluted as the surrounding context grows. This is the same
 * "make it impossible to miss" move the codebase already makes for the em-dash rule
 * (`WritingStyleSection.tsx`'s standalone `avoidEmDashes` toggle plus managed regex, not a clause
 * buried in a longer system prompt): repeat only the top signal, short and blunt, as its own line.
 *
 * Picks the *first* authored catchphrase/tic rather than trying to rank them — an author lists
 * what matters most first, and `detectVoiceFingerprint` already sorts its own suggestions by how
 * often they actually recur, so "first" is a reasonable proxy for "most load-bearing" either way.
 * `undefined` when there's nothing to restate (no fingerprint, or one with only fields this
 * function doesn't pull from — e.g. a card with tics/catchphrases capped out lower in the list but
 * no register note at all still gets a reminder from whichever of the three is present).
 */
function buildVoiceFingerprintReminder(fingerprint: VoiceFingerprint | undefined): string | undefined {
  if (!fingerprint) return undefined
  const catchphrase = fingerprint.catchphrases?.[0]?.trim()
  const tic = fingerprint.verbalTics?.[0]?.trim()
  const register = (fingerprint.dialectNotes?.trim() || fingerprint.sentenceRhythm?.trim())?.replace(/\.+$/, '')
  const bits: string[] = []
  if (catchphrase) bits.push(`reach for "${catchphrase}" again when it fits`)
  if (tic) bits.push(`keep the "${tic}" tic alive`)
  if (register) bits.push(register)
  if (bits.length === 0) return undefined
  return `Voice check, every single reply no matter how long this chat has run: ${bits.join('; ')}. Never let this quietly flatten into generic prose.`
}

/**
 * The single note folded into the identity block alongside description/personality/scenario
 * (`PromptBuildInput.characterProfile`, `builder.ts`) — everything here lives on `Character`, not
 * the portable `CharacterCardData` the builder otherwise reads from directly. Three independent
 * sub-notes (life context, the full voice fingerprint, and its compact reminder) are combined so
 * any subset can be present alone without the others leaving a stray separator behind.
 */
export function buildCharacterProfileNote(character: Character): string | undefined {
  const blocks = [
    buildLifeContextNote(character),
    buildVoiceFingerprintNote(character.voiceFingerprint),
    buildVoiceFingerprintReminder(character.voiceFingerprint),
  ].filter((b): b is string => !!b)
  return blocks.length ? blocks.join('\n') : undefined
}
