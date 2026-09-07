import type { IntimacyDetailLevel } from '@/lib/store/useSettingsStore'

/**
 * User-controlled dial over how explicit the connected model gets once a scene turns intimate —
 * deterministic code sets the knob, the model writes the words. Separate from `slowBurnPacing`
 * (how fast affection is earned) — this is about register, not pace.
 */

/** The content rating in force for a chat: the world's own level, if set, else the global Settings value — the world wins outright either direction, not just the stricter one. */
export function resolveIntimacyLevel(
  /** `null`/`undefined` both mean "inherit" — see `WorldCard.intimacyLevel` for why the wire format needs both. */
  worldLevel: IntimacyDetailLevel | null | undefined,
  globalLevel: IntimacyDetailLevel,
): IntimacyDetailLevel {
  return worldLevel ?? globalLevel
}

export function intimacyGuidance(level: IntimacyDetailLevel): string {
  switch (level) {
    case 'fade_to_black':
      return "When a scene turns intimate, imply and suggest rather than describe explicitly — trail off, cut to after, or shift the scene once things move past kissing or undressing. Don't narrate explicit sexual content."
    case 'suggestive':
      return 'Intimate scenes can include sensual, romantic detail — physical closeness, described touch, charged tension, arousal — without being graphically explicit. Evocative, not clinical or crude.'
    case 'explicit':
      return "This is an adult roleplay with explicit content enabled by the user. When a scene the story has actually built toward turns sexual, write it fully and explicitly — physical detail, dialogue, sensation — in the character's own established voice, not a generic one. Don't fade to black or cut away once the scene has genuinely earned it; a sudden cut after real narrative buildup reads as a bug, not tact."
    case 'default':
    default:
      return ''
  }
}

/**
 * Freeform player prose is not limited to catalog actions, so the catalog's warmth gates alone
 * cannot prevent an unearned kiss from reading as automatically welcome. This stays lexical and
 * deliberately narrow: it adds no prompt text unless a low-warmth player turn actually attempts
 * physical escalation.
 */
const EARLY_PHYSICAL_ESCALATION = /\b(?:kiss(?:es|ed|ing)?|make(?:\s|-)?out|touch(?:es|ed|ing)?|caress(?:es|ed|ing)?|grope(?:s|d|ing)?|undress(?:es|ed|ing)?|strip(?:s|ped|ping)?|hold(?:s|ing)?\s+(?:her|him|them|you)|pull(?:s|ed|ing)?\s+(?:her|him|them|you)\s+close)\b/i

/** A late, state-based cue for freeform physical escalation before even light kissing is unlocked. */
export function earlyEscalationGuidance(
  warmth: number,
  latestUserText: string | undefined,
  charName: string,
): string {
  if (warmth >= 15 || !latestUserText || !EARLY_PHYSICAL_ESCALATION.test(latestUserText)) return ''
  return `Warmth is still very low. This physical escalation is not assumed welcome or earned; let ${charName} pull back, deflect, set distance, or keep things lighter if that is the honest read. Never accept it just to be agreeable.`
}
