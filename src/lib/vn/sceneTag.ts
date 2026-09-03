export interface SceneTag {
  expression?: string
  background?: string
}

const TAG_PREFIX = '<<scene:'
const TAG_RE = /\n?<<scene:([^>]*)>>\s*$/i

/** Pulls the trailing <<scene:...>> directive off a completed generation, if present. */
export function extractSceneTag(raw: string): { text: string; scene?: SceneTag } {
  const match = raw.match(TAG_RE)
  if (!match) {
    // Generation can get cut off (max tokens, or the model just never emits `>>`) before the tag
    // closes — there's no usable expression/background then, but the raw, unterminated fragment
    // must never end up saved as if it were part of the character's actual dialogue.
    return { text: stripSceneTagForDisplay(raw).trimEnd() }
  }
  const scene: SceneTag = {}
  for (const pair of match[1].split(',')) {
    const [key, value] = pair.split('=').map((s) => s.trim().toLowerCase())
    if (key === 'expression' && value) scene.expression = value
    if (key === 'background' && value) scene.background = value
  }
  return { text: raw.slice(0, match.index).trimEnd(), scene: Object.keys(scene).length ? scene : undefined }
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

/** Instructs the model to tag each reply with the closest-matching expression/background, so VN mode can react to it. */
export function buildSceneInstruction(options?: { expressionIds: string[]; backgroundIds: string[] }): string {
  if (!options || (options.expressionIds.length === 0 && options.backgroundIds.length === 0)) return ''
  return [
    'After writing your in-character reply, end it with exactly one new line in this exact format (metadata only — never mention or explain it in the dialogue):',
    '<<scene:expression=ID,background=ID>>',
    options.expressionIds.length ? `Valid expression IDs: ${options.expressionIds.join(', ')}` : '',
    options.backgroundIds.length ? `Valid background IDs: ${options.backgroundIds.join(', ')}` : '',
    "Pick whichever IDs best match the character's emotion and the current setting.",
  ]
    .filter(Boolean)
    .join('\n')
}
