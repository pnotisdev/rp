import type { CharacterMood } from '@/lib/prompt/mindGuidance'

/**
 * Visual-novel prose craft: how a reply is *written* when the app is presenting the scene as a
 * visual novel (background, sprite, dialogue box). Until this existed, VN mode was purely
 * presentational — the app drew a VN and then asked the model for ordinary chat prose, so the two
 * pulled against each other. A wall of narration in a dialogue box reads badly no matter how good
 * the sentence is, and a scene whose camera keeps cutting fights a fixed background.
 *
 * Deliberately about form, not content: nothing here touches what happens in a scene, who the
 * character is, or how far anything goes. It shapes rhythm, framing, and where a beat lands — the
 * things a VN's presentation actually constrains. The character's voice still comes entirely from
 * their card, and every other guidance line in `styleGuidance` still applies on top.
 */

/** Sentences a dialogue box holds comfortably before it stops reading as one beat. */
const BOX_SENTENCE_BUDGET = 4

/**
 * The core craft note. On every turn while VN mode is presenting the scene, since form is not
 * situational — a reply either reads like a visual novel or it doesn't.
 */
export function vnProseGuidance(charName: string, userName: string): string {
  return [
    `This scene is being presented as a visual novel: a still background, ${charName} facing ${userName}, and the text appearing in a dialogue box beneath them. Write for that frame.`,
    `Keep it to one beat — roughly ${BOX_SENTENCE_BUDGET} sentences or fewer of narration around what ${charName} says, not a paragraph of scene-setting. A dialogue box is a small, close space; a wall of text in it reads as a wall of text no matter how good the prose is. End the turn while ${userName} still has something to answer.`,
    `The camera does not move. ${charName} is right there in frame and the room stays where it is, so keep the description inside that shot: what ${charName}'s face and hands are doing, what is close enough to touch, what can be heard from here. Don't cut to another angle, pull back for a wide establishing shot, or narrate the room from above.`,
    `The background already says where this is. Only name the setting when something in it actually changes or ${charName} genuinely notices it — light going, a sound in the next room, the smell of what's cooking. Re-describing the room every turn is the single most common way this kind of scene goes flat.`,
  ].join(' ')
}

/**
 * The expression beat. A VN shows the character's face at full size, which makes a change in it the
 * most legible thing on screen — so it is worth writing as a beat rather than a passing adjective,
 * and worth *changing* rather than holding one look for a whole conversation.
 */
export function vnExpressionGuidance(charName: string, mood?: CharacterMood): string {
  const moodClause = mood
    ? ` ${charName} is ${mood} underneath this, so the face they arrive with is already doing something before they say a word.`
    : ''
  return `${charName}'s face is the largest thing on screen and the player is looking at it. Let it move: the beat before an answer, the smile that arrives a moment late or drops a moment early, the look away, the flush they can't do anything about. One concrete change of expression, placed where it lands, does more than a sentence naming the feeling behind it — and a character who holds the same look through an entire conversation reads as a static image rather than a person.${moodClause}`
}

/**
 * Dialogue-forward balance. A VN is mostly people talking, and its narration is connective tissue
 * between lines rather than the main event — the opposite weighting from prose fiction.
 */
export function vnDialogueBalanceGuidance(charName: string): string {
  return `Lead with what ${charName} actually says. In this form the narration is the join between lines, not the substance: a gesture, a pause, where they're looking, then the line. If a turn has no dialogue in it at all, it should be because ${charName} deliberately said nothing and that silence is the beat — not because the reply turned into description.`
}

/**
 * Sound. A VN has an audio channel the prose is expected to use, and this app renders onomatopoeia
 * as its own beat (`text/sfx.ts`), so a named sound is a real presentational element here rather
 * than a stylistic tic.
 */
export function vnSoundGuidance(): string {
  return `Sound carries a lot in this form and costs almost nothing: the chair, the rain picking up, the kettle, a breath let out, the pause where a room is suddenly very quiet. One specific sound placed in a beat does more work than an adjective about atmosphere.`
}

/**
 * The interiority split. A VN's protagonist is the player, and this app never writes for them — so
 * the interiority available is the character reading the player from outside, which is a genuinely
 * different and better instruction than "add inner thoughts".
 */
export function vnInteriorityGuidance(charName: string, userName: string): string {
  return `${charName}'s inner life is on the page; ${userName}'s is not, and guessing at it is the fastest way to break this. Write ${charName} *reading* ${userName} from the outside instead — what they think they see, what they're not sure about, what they decide it means. Being wrong about ${userName} is one of the most interesting things ${charName} can do, and it leaves the actual answer to ${userName}.`
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
