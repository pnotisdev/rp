import type { CharacterMood } from '@/lib/prompt/mindGuidance'

/** Visual-novel prose craft: how a reply is *written* when the app is presenting the scene as a visual novel (background, sprite, dialogue box). */

/** Sentences a dialogue box holds comfortably before it stops reading as one beat. */
const BOX_SENTENCE_BUDGET = 4

/** The core craft note. */
export function vnProseGuidance(charName: string, userName: string): string {
  return [
    `This scene is being presented as a visual novel: a still background, ${charName} facing ${userName}, and the text appearing in a dialogue box beneath them. Write for that frame.`,
    `Keep it to one beat, roughly ${BOX_SENTENCE_BUDGET} sentences or fewer of narration around what ${charName} says, not a paragraph of scene-setting. A dialogue box is a small, close space; a wall of text in it reads as a wall of text no matter how good the prose is. End the turn while ${userName} still has something to answer.`,
    `The camera does not move. ${charName} is right there in frame and the room stays where it is, so keep the description inside that shot: what ${charName}'s face and hands are doing, what is close enough to touch, what can be heard from here. Don't cut to another angle, pull back for a wide establishing shot, or narrate the room from above.`,
    `The background already says where this is. Only name the setting when something in it actually changes or ${charName} genuinely notices it, light going, a sound in the next room, the smell of what's cooking. Re-describing the room every turn is the single most common way this kind of scene goes flat.`,
  ].join(' ')
}

/** The expression beat. */
export function vnExpressionGuidance(charName: string, mood?: CharacterMood): string {
  const moodClause = mood
    ? ` ${charName} is ${mood} underneath this, so the face they arrive with is already doing something before they say a word.`
    : ''
  return `${charName}'s face is the largest thing on screen and the player is looking at it. Let it move: the beat before an answer, the smile that arrives a moment late or drops a moment early, the look away, the flush they can't do anything about. One concrete change of expression, placed where it lands, does more than a sentence naming the feeling behind it, and a character who holds the same look through an entire conversation reads as a static image rather than a person.${moodClause}`
}

/** Dialogue-forward balance. */
export function vnDialogueBalanceGuidance(charName: string): string {
  return `Lead with what ${charName} actually says. In this form the narration is the join between lines, not the substance: a gesture, a pause, where they're looking, then the line. If a turn has no dialogue in it at all, it should be because ${charName} deliberately said nothing and that silence is the beat, not because the reply turned into description.`
}

/** Sound. */
export function vnSoundGuidance(): string {
  return `Sound carries a lot in this form and costs almost nothing: the chair, the rain picking up, the kettle, a breath let out, the pause where a room is suddenly very quiet. One specific sound placed in a beat does more work than an adjective about atmosphere.`
}

/** The interiority split. */
export function vnInteriorityGuidance(charName: string, userName: string): string {
  return `${charName}'s inner life is on the page; ${userName}'s is not, and guessing at it is the fastest way to break this. Write ${charName} *reading* ${userName} from the outside instead, what they think they see, what they're not sure about, what they decide it means. Being wrong about ${userName} is one of the most interesting things ${charName} can do, and it leaves the actual answer to ${userName}.`
}

/** Everything above, assembled. Empty when VN mode isn't presenting this scene. */
export function vnProseNote(isVisualNovel: boolean, charName: string, userName: string, mood?: CharacterMood): string {
  if (!isVisualNovel) return ''
  return [
    vnProseGuidance(charName, userName),
    vnExpressionGuidance(charName, mood),
    vnDialogueBalanceGuidance(charName),
    vnSoundGuidance(),
    vnInteriorityGuidance(charName, userName),
  ].join(' ')
}
