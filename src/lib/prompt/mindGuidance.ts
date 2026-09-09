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
  return `Right now, separate from how ${charName} feels about ${userName} overall, their own mood is ${mood}. It should be visible before they say anything much: in what their face is doing when they look up, how long they take to answer, how much slack they have for ${userName} this turn. Don't have them name the feeling unless naming it is genuinely in character.`
}

/** Names a steadier underlying need this stretch of the story hasn't been meeting. */
export function needGuidance(charName: string, need?: CharacterNeed): string {
  if (!need) return ''
  return `Lately ${charName} has been quietly short on ${need}, and it hasn't been getting better. Not a crisis, an undercurrent: it shows in what they steer the conversation toward, what they linger on, what lands harder than it should. They would not call it a "need" and should never say the word.`
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
  return `Underneath everything, ${charName} is quietly afraid of this right now: ${fear}. Fear is what makes a character change the subject a beat too fast, answer a question that wasn't asked, or be strangely careful about something small. Let it show that way when the moment brushes against it, and never as ${charName} explaining what they're afraid of.`
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

// Stock romance-writing tells a model reaches for regardless of character/relationship. This is the
// STATIC pre-warning list; `text/slop.ts`'s `SLOP_PATTERNS` is the REACTIVE corpus that names back
// a tell the character has actually just used. They deliberately overlap on a few phrases
// ("despite herself", "the air was thick with", "couldn't help but", "sent shivers down"): when a
// phrase has already been used, `stockRomancePhrasingNote` drops it here so the reactive catch is
// the only place it's named.
export const STOCK_ROMANCE_PHRASES = [
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

/** Warns off stock romance-writing tells. Only worth the tokens during an actually romantic/intimate
 *  moment. Any phrase already present in `recentCharTurns` is dropped — the reactive slop note
 *  (`buildSlopAvoidanceNote`) names those, and one place is enough. */
export function stockRomancePhrasingNote(isRomanticMoment: boolean, recentCharTurns: string[] = []): string {
  if (!isRomanticMoment) return ''
  const recent = recentCharTurns.join('\n').toLowerCase()
  const phrases = STOCK_ROMANCE_PHRASES.filter((p) => !recent.includes(p.toLowerCase()))
  if (phrases.length === 0) return ''
  return `This is a romantic/intimate moment, which is exactly where a model's own generic training shows up hardest. Avoid reaching for stock romance-writing tells here regardless of whether they've come up before in this chat — things like "${phrases.join('", "')}". Write what's actually specific to this character and this moment instead of the generic version of a romance scene.`
}

/** POV guard: only the player's own actions belong to the player. Fires on any romantic/intimate moment, not just an active catalog-driven `IntimacyScene` — covers freeform-only intimacy too. */
export function agencyGuardNote(isRomanticMoment: boolean, charName: string, userName: string): string {
  if (!isRomanticMoment) return ''
  return `${userName}'s actions, words, thoughts, and choices are ${userName}'s alone. Write ${charName}'s side of this and stop there: what ${charName} does, what they say, what they notice. Never move ${userName}, answer for them, or state what they felt, not even in a half-sentence aside like "you shiver" or "you can't help smiling" — that half-sentence is the one that breaks the scene, because it decides something that was ${userName}'s to decide.`
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
