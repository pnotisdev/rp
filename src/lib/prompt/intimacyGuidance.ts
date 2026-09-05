import type { IntimacyDetailLevel } from '@/lib/store/useSettingsStore'

/**
 * The user's own direct request: "add more romance, romantic scenes and more (NSFW)." This app
 * writes no narrative content itself — the connected model does, per its own capabilities — so the
 * actual feature is a real, user-controlled dial over how explicit that model gets once a scene
 * the story has genuinely built toward turns intimate, the same "deterministic code sets the
 * knob, the model writes the words" split as every other prompt-steering setting here
 * (`slowBurnPacing`, `styleGuidance`). Deliberately separate from `slowBurnPacing`, which is about
 * pacing (how *fast* affection is earned) — this is about register (how the prose reads once it's
 * been earned). `'default'` sends no instruction at all: the exact behavior every chat already had
 * before this setting existed, so nobody's existing output changes unless they deliberately pick a
 * level in either direction — towards less explicit, or more.
 */
/**
 * The content rating actually in force for a chat: the world's own, when it has set one, else the
 * global Settings value.
 *
 * `intimacyLevel` was a single global switch, which is wrong the moment someone runs more than one
 * world — a wholesome slice-of-life world and an explicit one can't share one dial, and flipping
 * it in Settings between chats is both tedious and easy to forget in the direction that matters.
 * A world is the right scope: it's already where the gift catalog, intimacy catalog, scene flags,
 * and relationship thresholds are authored.
 *
 * An override, not a ceiling. Clamping to the stricter of the two reads safer but breaks the
 * actual use case: with the global left at its `'default'` (which sends no instruction at all,
 * and is what a user who never opened the setting has), an explicit world could never be explicit.
 * The world is the more specific, more deliberate statement of what it is, so it wins outright in
 * both directions — a `fade_to_black` world stays fade-to-black under a global `explicit`.
 *
 * `undefined` on the world means "inherit", which is deliberately distinct from the world
 * explicitly choosing `'default'` — the latter pins this world to sending no instruction even if
 * the global setting later changes.
 */
export function resolveIntimacyLevel(
  /** `null` and `undefined` both mean "inherit" — see `WorldCard.intimacyLevel` for why the wire format needs the former. */
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
