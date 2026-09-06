// Character Mind: dynamic per-turn state (mood, need, intent, desire, fear) set by the same
// relationship judge call, read back as `styleGuidance` lines. Separate from the relationship
// track — emotion isn't relationship (a character can love/trust the player while currently angry
// with them). `mood`/`currentNeed` are shown to the player (RelationshipPanel); the rest are
// private, model-only signals. `plans` (a persistent multi-entry layer) and
// `beliefsAboutUser`/`expectationsOfUser` (impressions of the player) live in their own modules.

/** Closed vocabulary, not free text, so the classifier's output stays legible. */
export const MOOD_VOCAB = [
  'content',
  'affectionate',
  'playful',
  'excited',
  'anxious',
  'guarded',
  'annoyed',
  'hurt',
  'sad',
  'lonely',
  'jealous',
  'embarrassed',
  'confident',
  'exhausted',
  'bored',
  'curious',
  'nostalgic',
  'proud',
  'relieved',
  'tense',
] as const

export type CharacterMood = (typeof MOOD_VOCAB)[number]

export const NEED_VOCAB = [
  'social connection',
  'solitude',
  'achievement',
  'reassurance',
  'excitement',
  'stability',
  'recognition',
  'belonging',
] as const

export type CharacterNeed = (typeof NEED_VOCAB)[number]

/** Names the character's current transient mood, independent of warmth. */
export function moodGuidance(charName: string, userName: string, mood?: CharacterMood): string {
  if (!mood) return ''
  return `Right now, separate from how ${charName} feels about ${userName} overall, their own mood is ${mood}. Let it color tone, patience, and reactions this turn — no need to name the feeling outright unless it naturally comes up.`
}

/** Names a steadier underlying need this stretch of the story hasn't been meeting. */
export function needGuidance(charName: string, need?: CharacterNeed): string {
  if (!need) return ''
  return `Lately, ${charName} has been quietly wanting more ${need} than they've been getting — not a crisis, just an undercurrent that can nudge what they gravitate toward or bring up, without ever naming it as a "need."`
}

/** Names a private, concrete thing the character currently wants — mirrors the player-facing Objective system, but hidden. */
export function characterIntentGuidance(charName: string, intent?: string): string {
  if (!intent) return ''
  return `${charName} is privately holding onto something right now: ${intent}. It can quietly shape what they say or do, but they don't have to act on it or announce it this exact turn. Every so often it's fine for this to surface as a small, unexplained action instead of only a shift in word choice — texting first out of nowhere, bringing it up with no obvious lead-in, quietly doing something about it off-screen — not just coloring tone.`
}

/** Names a deeper, steadier drive — the want-axis counterpart to `needGuidance`'s emotional axis. */
export function desireGuidance(charName: string, desire?: string): string {
  if (!desire) return ''
  return `Underneath the specific things ${charName} wants day to day, there's something deeper and steadier driving them right now: ${desire}. It isn't on today's agenda the way a concrete want would be, and it doesn't need satisfying or even naming this turn — but it can quietly shape what draws their attention, what rings true to them, or what they gravitate toward when nothing more pressing is going on.`
}

/** Names a private fear — explains defensiveness/avoidance in a way mood/need don't on their own. */
export function fearGuidance(charName: string, fear?: string): string {
  if (!fear) return ''
  return `Underneath things, ${charName} is quietly afraid of this right now: ${fear}. It can show up as defensiveness, deflection, or over-carefulness in the right moment, without ${charName} ever naming it outright.`
}

// Moods that pull against a generic romance scene's trained instinct to soften/lean in/escalate.
// Moods that already point the same direction as a romance default (content, playful, etc.) are
// left out — there's no trained instinct to override there.
const RESISTANT_MOODS: readonly CharacterMood[] = [
  'anxious',
  'guarded',
  'annoyed',
  'hurt',
  'sad',
  'lonely',
  'jealous',
  'embarrassed',
  'exhausted',
  'bored',
  'tense',
]

/** Explicit override for a model's trained romantic defaults winning over this character's actually-authored state (mood, holding back, boundaries). Empty when nothing's in tension. */
export function authoredStatePriorityNote(
  charName: string,
  mood: CharacterMood | undefined,
  isHoldingBack: boolean,
  hasAuthoredBoundaries: boolean,
): string {
  const resistantMood = mood && RESISTANT_MOODS.includes(mood)
  if (!resistantMood && !isHoldingBack) return ''
  const because = [resistantMood ? `currently ${mood}` : '', isHoldingBack ? 'deliberately holding back right now' : '']
    .filter(Boolean)
    .join(' and ')
  const boundaryClause = hasAuthoredBoundaries
    ? ` This includes ${charName}'s own authored boundaries — those are not softened by how warm things generally are.`
    : ''
  return `${charName} is ${because}. A generic romance story would have a character soften, lean in, or escalate anyway just because the moment invites it — resist that trained instinct here. ${charName}'s actual authored state wins over generic romantic instinct: however high warmth or affection reads right now, it does not override a mood like this, an unmet need, or what ${charName} is actually doing right now.${boundaryClause} Write the character who is actually anxious/guarded/holding back, not the version of this scene a stock romance would write.`
}

// Stock romance-writing tells a model reaches for regardless of character/relationship. Distinct
// from `voice.ts`'s buildSlopAvoidanceNote, which only catches a character's own repeats within
// this chat.
const STOCK_ROMANCE_PHRASES = [
  'electricity between them',
  'the air was thick with',
  'despite herself',
  'despite himself',
  'butterflies in her stomach',
  'butterflies in his stomach',
  'heart skipped a beat',
  'time seemed to stop',
  'the world fell away',
  'lost in each other',
  "couldn't help but",
  'sent shivers down',
  'electric touch',
] as const

/** Warns off stock romance-writing tells. Only worth the tokens during an actually romantic/intimate moment. */
export function stockRomancePhrasingNote(isRomanticMoment: boolean): string {
  if (!isRomanticMoment) return ''
  return `This is a romantic/intimate moment, which is exactly where a model's own generic training shows up hardest. Avoid reaching for stock romance-writing tells here regardless of whether they've come up before in this chat — things like "${STOCK_ROMANCE_PHRASES.join('", "')}". Write what's actually specific to this character and this moment instead of the generic version of a romance scene.`
}

/** POV guard: only the player's own actions belong to the player. Fires on any romantic/intimate moment, not just an active catalog-driven `IntimacyScene` — covers freeform-only intimacy too. */
export function agencyGuardNote(isRomanticMoment: boolean, charName: string, userName: string): string {
  if (!isRomanticMoment) return ''
  return `Only ${userName}'s own actions, words, and choices belong to ${userName} — write ${charName}'s side of this (what they do, feel, and say) and never speak, move, or feel for ${userName}, even in a small aside.`
}

/** Emotional-aftermath guidance for the afterglow window (`dating/aftercare.ts`). Splits at the first turn (the immediate beat reads differently from the hours after). Never names physical detail — that's the content dial's job. */
export function afterglowGuidance(
  charName: string,
  userName: string,
  turnsSince: number,
  sourceLabel?: string,
): string {
  const because = sourceLabel ? ` (after ${sourceLabel})` : ''
  if (turnsSince <= 0) {
    return `${charName} and ${userName} have just been intimate${because}. This is the moment immediately after: ${charName} is more open and more exposed than usual, and whatever they do now — reaching for ${userName}, retreating, deflecting with a joke, needing to be told something — should come from who they actually are, not from a generic tenderness. Being this uncovered is not automatically comfortable for them.`
  }
  return `${charName} and ${userName} were intimate a short while ago${because}. It hasn't stopped mattering: it can still sit under ordinary conversation as ease, self-consciousness, a need for reassurance, or a wish not to discuss it. Let it colour how ${charName} reads ${userName}'s attention right now — especially its absence — without narrating the scene again.`
}
