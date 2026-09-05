export interface SceneTag {
  expression?: string
  background?: string
  /** Ambient scene mood (src/lib/vn/moods.ts) — selects the background-music track in VN mode. */
  mood?: string
  /**
   * Which wardrobe state the character is in (src/lib/vn/outfits.ts). Only ever offered when the
   * character actually has unlocked outfit art, so an ordinary character's tag is unchanged.
   * Unset means "no change" rather than "base outfit" — the reader carries the last one forward,
   * since a model that simply doesn't repeat the field shouldn't undress anyone.
   */
  outfit?: string
}

const TAG_PREFIX = '<<scene:'
// Deliberately NOT anchored to end-of-string (a global match instead) — seen live: a model that
// emits one tag mid-reply, keeps writing dialogue, then emits a second one at the end. Anchoring to
// `$` only ever found and removed the second tag; the first was left as literal, unstripped text,
// which `cleanModelOutput`'s later `normalizeRpMarkup` step then mangled trying to treat `<<scene:
// ...>>` as an HTML tag (its `<tag>` pattern only ever expects ONE leading `<`) — stripping the
// inside but leaving the outer `<`/`>` behind as garbage (a real reply reduced to literally `"<>"`).
const TAG_RE = /\n?<<scene:([^>]*)>>/gi

/**
 * Pulls every `<<scene:...>>` directive out of a completed generation, if any — using the LAST one
 * found for the actual expression/background/mood (a model updating the tag partway through a
 * reply presumably means the later one to be its final, intended state) while removing ALL of them
 * from the returned text, not just the one that supplied the metadata.
 */
export function extractSceneTag(raw: string): { text: string; scene?: SceneTag } {
  let lastMatch: RegExpMatchArray | undefined
  for (const match of raw.matchAll(TAG_RE)) lastMatch = match
  if (!lastMatch) {
    // Generation can get cut off (max tokens, or the model just never emits `>>`) before the tag
    // closes — there's no usable expression/background then, but the raw, unterminated fragment
    // must never end up saved as if it were part of the character's actual dialogue.
    return { text: stripSceneTagForDisplay(raw).trimEnd() }
  }
  const scene: SceneTag = {}
  for (const pair of lastMatch[1].split(',')) {
    const [key, value] = pair.split('=').map((s) => s.trim().toLowerCase())
    if (key === 'expression' && value) scene.expression = value
    if (key === 'background' && value) scene.background = value
    if (key === 'mood' && value) scene.mood = value
    if (key === 'outfit' && value) scene.outfit = value
  }
  return { text: raw.replace(TAG_RE, '').trim(), scene: Object.keys(scene).length ? scene : undefined }
}

/** Hides an in-progress (or just-completed) scene tag from what's shown mid-stream, so it never flashes as visible dialogue. */
export function stripSceneTagForDisplay(text: string): string {
  const idx = text.lastIndexOf('<')
  if (idx === -1) return text
  const tail = text.slice(idx)
  const prefixLen = Math.min(tail.length, TAG_PREFIX.length)
  if (tail.slice(0, prefixLen) !== TAG_PREFIX.slice(0, prefixLen)) return text
  return text.slice(0, idx).replace(/\s+$/, '')
}

/** Instructs the model to tag each reply with the closest-matching expression/background/mood, so VN mode can react to it. */
export function buildSceneInstruction(options?: {
  expressionIds: string[]
  backgroundIds: string[]
  /** Passed only when the world actually has music — no point spending prompt tokens on a mood the app will ignore. */
  moodIds?: string[]
  /**
   * Passed only when this character has more than one selectable wardrobe state — a character with
   * only base art gets the exact instruction it always got, with no outfit field and no extra
   * tokens. See `selectableOutfitIds` in `outfits.ts` for what qualifies.
   */
  outfitIds?: string[]
  /** What the character is wearing right now, so the model knows what it would be *changing from*. */
  currentOutfitId?: string
}): string {
  if (!options || (options.expressionIds.length === 0 && options.backgroundIds.length === 0)) return ''
  const wantsMood = !!options.moodIds && options.moodIds.length > 0
  // One id is no choice at all (it's always just the base outfit), so it isn't worth a field.
  const wantsOutfit = !!options.outfitIds && options.outfitIds.length > 1
  const format = `<<scene:expression=ID,background=ID${wantsMood ? ',mood=ID' : ''}${wantsOutfit ? ',outfit=ID' : ''}>>`
  return [
    'After writing your in-character reply, end it with exactly one new line in this exact format. This line is metadata only: never mention or explain it in the dialogue.',
    format,
    options.expressionIds.length ? `Valid expression IDs: ${options.expressionIds.join(', ')}` : '',
    options.backgroundIds.length ? `Valid background IDs: ${options.backgroundIds.join(', ')}` : '',
    wantsMood ? `Valid mood IDs: ${options.moodIds!.join(', ')}` : '',
    wantsOutfit ? `Valid outfit IDs: ${options.outfitIds!.join(', ')}` : '',
    wantsOutfit
      ? `The character is currently wearing "${options.currentOutfitId || 'base'}". Only use a different outfit ID when the story has actually changed what they are wearing — they got changed, arrived somewhere needing different clothes, undressed. Otherwise repeat the current one. Never change an outfit just because the mood shifted.`
      : '',
    wantsMood
      ? "Pick whichever IDs best match the character's emotion, the current setting, and the overall feeling of the scene."
      : "Pick whichever IDs best match the character's emotion and the current setting.",
  ]
    .filter(Boolean)
    .join('\n')
}
