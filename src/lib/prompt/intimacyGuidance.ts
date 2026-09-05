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
