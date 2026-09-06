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
 * `intent`'s bigger sibling — a persistent *plan layer*, where a character carries several
 * turn-spanning intentions with their own lifecycle (form / annotate / resolve), possibly about
 * their own life entirely — now lives in `dating/plans.ts`, driven by the same judge call and read
 * back as its own `styleGuidance` line (`plansGuidance`).
 *
 * `fear` (this file's `fearGuidance`) rides the same judge call as a fourth sticky field, the same
 * shape as `characterIntent`. `beliefsAboutUser`/`expectationsOfUser` — standing impressions of and
 * expectations of the *player*, as opposed to this file's fields which are all about the character's
 * own inner state — live in their own small modules (`dating/beliefs.ts`/`dating/expectations.ts`)
 * since each has a real multi-entry lifecycle, not a single sticky value.
 *
 * `desire` (this file's `desireGuidance`) is a fifth sticky field, added for the same reason `need`
 * exists alongside `mood`: two independent axes, each with a transient/steady pair. `mood` (transient)
 * and `currentNeed` (its steadier undercurrent) are the *emotional* axis; `characterIntent` (a
 * transient, concrete want or small plan — "bring up the gallery opening tonight") and `currentDesire`
 * (its steadier undercurrent — "wants to feel truly seen, not just liked") are the *want* axis.
 * `currentDesire` is deliberately NOT the same thing as `currentNeed`: a need is what this specific
 * stretch of the story hasn't been giving them (situational, gets satisfied and can clear); a desire
 * is closer to a foundational trait of who they are, and can sit unmet indefinitely without that
 * being a problem to fix. Never shown to the player (same as `characterIntent`/`currentFear`) — it's
 * private by nature, not a stat.
 *
 * The rest of the mindmap (opinions, secrets-as-entities, the social graph beyond
 * `socialConnections`, rumors, internal conflicts) stays a documented follow-up (see ROADMAP) —
 * those are each a structurally different, standalone system (their own storage shape, often their
 * own UI), not another field on this one judge call.
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
  return `${charName} is privately holding onto something right now: ${intent}. It can quietly shape what they say or do, but they don't have to act on it or announce it this exact turn. Every so often it's fine for this to surface as a small, unexplained action instead of only a shift in word choice — texting first out of nowhere, bringing it up with no obvious lead-in, quietly doing something about it off-screen — not just coloring tone.`
}

/**
 * A `styleGuidance` line for the character's own deeper, steadier underlying drive — the want-axis
 * counterpart to `needGuidance`'s emotional-axis one. See this file's own top doc comment for the
 * full mood/need vs intent/desire distinction. Same sticky-until-replaced contract as the other
 * fields here. Never framed as something to satisfy or announce — a desire this foundational isn't
 * a todo item.
 */
export function desireGuidance(charName: string, desire?: string): string {
  if (!desire) return ''
  return `Underneath the specific things ${charName} wants day to day, there's something deeper and steadier driving them right now: ${desire}. It isn't on today's agenda the way a concrete want would be, and it doesn't need satisfying or even naming this turn — but it can quietly shape what draws their attention, what rings true to them, or what they gravitate toward when nothing more pressing is going on.`
}

/**
 * A `styleGuidance` line naming the character's current private fear — the third leg alongside
 * `currentNeed` (a steadier undercurrent) and `characterIntent` (a want): a fear is what actually
 * explains defensiveness, avoidance, or over-caution in a way neither of those two quite does on
 * its own. Same sticky-until-replaced contract as the other two (see `mood`'s own doc comment).
 * Never named to the player as "a fear" — the model shows it, doesn't announce it, same restraint
 * `characterIntentGuidance` already asks for.
 */
export function fearGuidance(charName: string, fear?: string): string {
  if (!fear) return ''
  return `Underneath things, ${charName} is quietly afraid of this right now: ${fear}. It can show up as defensiveness, deflection, or over-carefulness in the right moment, without ${charName} ever naming it outright.`
}

/**
 * A `styleGuidance` line for the window right after an intimate scene (`dating/aftercare.ts`).
 *
 * The one piece of character state here that the app sets deterministically rather than reading
 * back from the judge: the other three fields above are inferred from what happened, but "they
 * were just intimate" is something the app *knows*, because the player initiated it through a
 * real action. So it doesn't need guessing, and shouldn't be left to a model that may simply not
 * carry the weight of it into the next scene on its own.
 *
 * Splits at the first turn deliberately. The immediate beat and the hours afterwards are different
 * registers — one is the room itself, the other is the day carrying on with something changed in
 * it — and collapsing them into one line produced a character stuck endlessly in the first minute.
 * Names no physical detail whatsoever: this steers *emotional* aftermath, and the content dial
 * (`intimacyGuidance`) remains the only thing that governs explicitness.
 */
/**
 * Moods that pull *against* a generic romance scene's trained instinct to soften, lean in, or
 * escalate — a model's own RLHF'd romantic defaults are strong enough that a high warmth/affection
 * number can quietly overrule an authored `guarded`/`hurt`/`annoyed` mood into "but they're so close,
 * surely she'd give in here" (item 5's own concern: generic model-default romance overriding actually-
 * authored character state). `content`/`affectionate`/`playful`/`excited`/`confident`/`curious`/
 * `proud`/`relieved` are left out on purpose — those already point the same direction a generic
 * romance scene would, so there's no trained instinct to override there.
 */
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

/**
 * A concrete, testable override instruction for the exact failure this item exists to fix: a
 * model's own trained romantic defaults winning over this specific character's actually-authored
 * state (mood, need, boundaries, a plan to hold back) — producing generic "model-default romance"
 * instead of this character. Deliberately narrow rather than a blanket "stay in character" restated
 * everywhere (that's already implicit and, per this app's own experience, not strong enough on a
 * weak or heavily RLHF'd model on its own): this only fires when there's an actual, nameable tension
 * between the authored state and what a generic romance beat would do, and it says in plain terms
 * which one wins. Returns `''` when nothing here is currently in tension with anything — most turns.
 */
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

/**
 * Item 3's second, narrower failure mode: `authoredStatePriorityNote` above catches a model's
 * trained romantic *behavior* overriding this character's authored state; this catches trained
 * romantic *prose* — the stock phrases a model reaches for in any AI romance scene, regardless of
 * which character or relationship it's actually writing. Distinct from `buildSlopAvoidanceNote`
 * (`characters/voice.ts`'s sibling concept), which only ever catches this *specific character's own*
 * verbatim repeats within this chat — a fresh chat with a brand new character gets zero signal from
 * that, since there's nothing yet to repeat. This list fires on generic tells a model has seen a
 * million times in training, on the very first romantic turn a chat ever has.
 *
 * A small closed list, same "closed vocabulary, not a vague vibe" reasoning as `MOOD_VOCAB` — matches
 * the existing em-dash rule's own shape (`useChatSession.ts`'s `avoidEmDashes` line): name the exact
 * things to avoid, don't just ask for "better writing."
 */
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

/**
 * Gated so it only ever spends tokens during a scene that's actually romantic/intimate — the caller
 * decides that from signals already computed every turn (an active `intimacyScene`, an open
 * `afterglow`, or high `chemistry`), rather than this function re-deriving it. Returns `''` on an
 * ordinary turn, which is most of them.
 */
export function stockRomancePhrasingNote(isRomanticMoment: boolean): string {
  if (!isRomanticMoment) return ''
  return `This is a romantic/intimate moment, which is exactly where a model's own generic training shows up hardest. Avoid reaching for stock romance-writing tells here regardless of whether they've come up before in this chat — things like "${STOCK_ROMANCE_PHRASES.join('", "')}". Write what's actually specific to this character and this moment instead of the generic version of a romance scene.`
}

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
