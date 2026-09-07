import type { BehavioralRule, Character, VoiceFingerprint } from './cardSpec'

/**
 * Builds the "Life beyond this scene" and voice-fingerprint notes folded into a character's
 * identity block in the prompt.
 */

// Caps for free-typed profile lists so they can't grow unbounded. `boundaries` is left uncapped
// since dropping a stated hard limit for being "too many" would be a content-safety risk.
const MAX_LIKES = 8
const MAX_GOALS = 5
const MAX_LOCATIONS = 5
const MAX_SOCIAL_CONNECTIONS = 6
const MAX_TICS = 6
const MAX_CATCHPHRASES = 5
const MAX_BEHAVIORAL_RULES = 10

/** Composes occupation, locations, likes/goals/boundaries, and social connections into one "Life beyond this scene" line. Returns undefined if nothing is set. */
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

/** Composes authored `when X → Y` / `never: Z` behavioral rules into one block, more precise than free-text personality. Returns undefined if none are set. */
function buildBehavioralRulesNote(rules: BehavioralRule[] | undefined): string | undefined {
  const usable = (rules ?? []).filter((r) => r.then.trim())
  if (usable.length === 0) return undefined
  const lines = usable
    .slice(0, MAX_BEHAVIORAL_RULES)
    .map((r) => (r.kind === 'never' ? `Never: ${r.then.trim()}.` : `When ${r.when?.trim() || 'it comes up'}: ${r.then.trim()}.`))
  return `Behavioral rules, authored for this character and followed exactly as written:\n${lines.join('\n')}`
}

/** Folds a `VoiceFingerprint` into one compact style-instruction line. Returns undefined when no fingerprint is set. */
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

/** Short, blunt restatement of just the top catchphrase/tic/register, repeated as its own line so it survives dilution over a long chat. Returns undefined if there's nothing to restate. */
function buildVoiceFingerprintReminder(fingerprint: VoiceFingerprint | undefined): string | undefined {
  if (!fingerprint) return undefined
  const catchphrase = fingerprint.catchphrases?.[0]?.trim()
  const tic = fingerprint.verbalTics?.[0]?.trim()
  // The full voice block immediately above already carries the register. Repeat it only when it
  // is the sole available signal; otherwise the catchphrase/tic reminder is enough.
  const register = !catchphrase && !tic ? (fingerprint.dialectNotes?.trim() || fingerprint.sentenceRhythm?.trim())?.replace(/\.+$/, '') : undefined
  const bits: string[] = []
  if (catchphrase) bits.push(`reach for "${catchphrase}" again when it fits`)
  if (tic) bits.push(`keep the "${tic}" tic alive`)
  if (register) bits.push(register)
  if (bits.length === 0) return undefined
  return `Voice check, every single reply no matter how long this chat has run: ${bits.join('; ')}. Never let this quietly flatten into generic prose.`
}

/** Combines the life-context note and voice-fingerprint notes into the single profile note used by `builder.ts`. */
export function buildCharacterProfileNote(character: Character): string | undefined {
  const blocks = [
    buildLifeContextNote(character),
    buildBehavioralRulesNote(character.behavioralRules),
    buildVoiceFingerprintNote(character.voiceFingerprint),
    buildVoiceFingerprintReminder(character.voiceFingerprint),
  ].filter((b): b is string => !!b)
  return blocks.length ? blocks.join('\n') : undefined
}
