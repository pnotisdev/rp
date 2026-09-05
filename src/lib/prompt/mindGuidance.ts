/**
 * The user's own "Character Mind" brainstorm, scoped down to a real slice: a transient emotional
 * state, an underlying psychological need, and a private intention — all explicitly *separate*
 * from the relationship track (their own point: "Emotion ≠ relationship... Someone can love/trust
 * the player while currently being angry with them"). `goals`/`boundaries`/`socialConnections` —
 * the *authored*, static half of the same brainstorm — already reach the prompt on every turn via
 * `characters/profile.ts`'s `buildCharacterProfileNote`; what was missing was the *dynamic* half
 * that changes turn to turn, which is what this file is for.
 *
 * All three fields are set by the same judge call that already scores relationship movement every
 * turn (`assessRelationshipMoment` in `relationshipAssist.ts`) — no extra AI call, no extra cost —
 * and are read back here into `styleGuidance` lines, same "deterministic code decides when to
 * inject, model writes the actual words" split as `sceneProgressionNudge`/`intimacyOptionsGuidance`.
 * They're deliberately distinct, not three names for the same thing: `mood` is this turn's weather
 * (transient, can flip inside one exchange); `need` is a steadier undercurrent (what kind of
 * attention this stretch of the story hasn't given them — doesn't flip every turn); `intent` is a
 * specific, concrete private want or small plan (mirrors the player-facing `Objective` system, but
 * hidden). `mood`/`need` are shown to the player (`RelationshipPanel`) since neither is a secret;
 * `characterIntent` never is, by design.
 *
 * The remaining mindmap (desires, fears, beliefs, opinions, secrets-as-entities, plans with
 * interruption, the social graph beyond `socialConnections`, rumors, promises, internal conflicts)
 * stays a documented follow-up (see ROADMAP) — those are each a structurally different, standalone
 * system (their own storage shape, often their own UI), not another field on this one judge call.
 */

/** A closed vocabulary, not free text — keeps the classifier's output legible and stops it drifting into paragraph-length "moods." */
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

/** The 8 need-categories from the user's own brainstorm — a closed vocabulary for the same reason `MOOD_VOCAB` is one. */
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

/**
 * A `styleGuidance` line naming the character's current transient mood — independent of warmth, so
 * a close, trusted relationship can still have an off day. Interpolates real names directly rather
 * than `{{char}}`/`{{user}}`: `styleGuidance` strings are never macro-substituted (only specific
 * named `buildPrompt` fields like `relationshipDescription` are — see that file's own `sub()`), a
 * mistake this file's sibling `sceneProgression.ts` already made and fixed once. Returns `''` with
 * no mood set yet (a fresh chat, or a classifier that hasn't had a clear read yet).
 */
export function moodGuidance(charName: string, userName: string, mood?: CharacterMood): string {
  if (!mood) return ''
  return `Right now, separate from how ${charName} feels about ${userName} overall, their own mood is ${mood}. Let it color tone, patience, and reactions this turn — no need to name the feeling outright unless it naturally comes up.`
}

/**
 * A `styleGuidance` line naming an underlying need this stretch of the story hasn't been meeting —
 * steadier than `mood` (this doesn't flip inside one exchange), and independent of both warmth and
 * mood: a character can be `content` in this exact moment while still generally starved for
 * `recognition` lately. Returns `''` with nothing read yet.
 */
export function needGuidance(charName: string, need?: CharacterNeed): string {
  if (!need) return ''
  return `Lately, ${charName} has been quietly wanting more ${need} than they've been getting — not a crisis, just an undercurrent that can nudge what they gravitate toward or bring up, without ever naming it as a "need."`
}

/**
 * A `styleGuidance` line naming a private thing the character currently wants — the "character
 * intentions" half of the mindmap, mirroring the player-facing `Objective` system but hidden from
 * the player and never surfaced anywhere in the UI. The model can let it color word choice and
 * small decisions without ever stating it outright, the same "hidden agenda" shape `draftHiddenAgenda`
 * already uses for date events, just persistent across ordinary turns instead of scoped to one event.
 */
export function characterIntentGuidance(charName: string, intent?: string): string {
  if (!intent) return ''
  return `${charName} is privately holding onto something right now: ${intent}. It can quietly shape what they say or do, but they don't have to act on it or announce it this exact turn.`
}
