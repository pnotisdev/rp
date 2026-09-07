/**
 * Corrects the model's own blind `<<scene:>>` self-tag (`sceneTag.ts`) after the fact, two ways:
 * vision passes (`detectExpressionFromSprites`, `classifyAttachedImageScene`) that look at actual
 * sprite/attached images when a vision-capable model is loaded, and a text-only pass
 * (`detectExpressionTextMismatch`) for when it isn't. All non-blocking best-effort assists —
 * they only override the tag on a valid, allowed-set-validated answer; otherwise the original
 * tag (or no change) stands.
 */

import type { ChatBackend } from '@/lib/api/chatBackend'
import { generateWithTimeout } from '@/lib/api/generateWithTimeout'
import { parseLenientJson } from '@/lib/jsonRepair'
import type { SceneTag } from '@/lib/vn/sceneTag'

/** `parseLenientJson` throws when a response has no JSON at all — a vision model answering in bare prose is expected here, not exceptional. */
function tryParseJson(text: string): unknown {
  try {
    return parseLenientJson(text)
  } catch {
    return undefined
  }
}

/** Low temperature, short output — this is classification, not writing. `max_context_length` is filled per-call from the server's real loaded context. */
const VISION_PARAMS = {
  max_length: 24,
  temperature: 0.1,
  top_p: 1,
  top_k: 0,
  min_p: 0,
  typical: 1,
  tfs: 1,
  rep_pen: 1,
  rep_pen_range: 256,
  rep_pen_slope: 0,
  stop_sequence: ['\n\n', '```', '<'],
  trim_stop: true,
}

export interface SpriteForVision {
  id: string
  label: string
  /** Base64 image payload, no `data:` prefix — the same shape `GenerateRequest.images` wants. */
  base64: string
}

/** Picks the expression sprite whose face best matches `replyText`, by actually showing the model the sprites. Returns a validated id, or null when the model declines or gives no usable answer. Needs at least two sprites to be worth running. */
export async function detectExpressionFromSprites(
  client: ChatBackend,
  params: {
    charName: string
    replyText: string
    sprites: SpriteForVision[]
    /** What the reply's own trailing tag claimed, if anything — given to the model as a starting guess. */
    taggedExpression?: string
  },
): Promise<string | null> {
  const sprites = params.sprites.filter((s) => s.base64)
  if (sprites.length < 2) return null

  const reply = params.replyText.trim().slice(0, 900)
  if (!reply) return null

  const orderedIds = sprites.map((s) => s.id)
  const allowed = new Set(orderedIds)
  const roster = sprites
    .map((s, i) => `Image ${i + 1}: "${s.id}"${s.label && s.label !== s.id ? ` — ${s.label}` : ''}`)
    .join('\n')
  const tagHint =
    params.taggedExpression && allowed.has(params.taggedExpression)
      ? ` A rough guess from the text was "${params.taggedExpression}"; keep it only if the face genuinely fits.`
      : ''

  const prompt = [
    `${sprites.length} portrait sprites of ${params.charName} are attached, in this order:`,
    roster,
    `\n${params.charName} just delivered this line:\n"""\n${reply}\n"""`,
    `Look at the faces. Which sprite matches how ${params.charName} looks saying that?${tagHint}`,
    'Reply with ONLY a minified JSON object naming the sprite id, e.g. {"expression":"happy"}.',
    'JSON:',
  ].join('\n')

  let text: string
  try {
    // Bounded to 45s by generateWithTimeout so this best-effort pass can't hang the caller.
    text = await generateWithTimeout(
      client,
      { ...VISION_PARAMS, max_context_length: await client.getEffectiveMaxContext(), prompt, images: sprites.map((s) => s.base64) },
      'Detect expression',
    )
  } catch {
    return null
  }

  return firstAllowedId(text, allowed, orderedIds)
}

export interface ExpressionCandidate {
  id: string
  label: string
}

/** A cheap text-only pre-filter for `detectExpressionFromSprites`: names the few most plausible expressions so the vision pass only looks at a handful of sprites. Falls back to the tagged guess or first `limit` candidates on an unusable answer. */
export async function shortlistExpressions(
  client: ChatBackend,
  params: {
    charName: string
    replyText: string
    candidates: ExpressionCandidate[]
    taggedExpression?: string
    limit?: number
  },
): Promise<string[]> {
  const limit = params.limit ?? 6
  const allIds = params.candidates.map((c) => c.id)
  if (params.candidates.length <= limit) return allIds

  const allowed = new Set(allIds)
  const fallback = () => {
    const seed = params.taggedExpression && allowed.has(params.taggedExpression) ? [params.taggedExpression] : []
    return [...new Set([...seed, ...allIds])].slice(0, limit)
  }

  const reply = params.replyText.trim().slice(0, 700)
  if (!reply) return fallback()

  const prompt = [
    `A character named ${params.charName} just said this in a roleplay:\n"""\n${reply}\n"""`,
    `Pick the ${limit} facial expressions from this list that could plausibly fit, most likely first:`,
    params.candidates.map((c) => `${c.id} — ${c.label}`).join('\n'),
    params.taggedExpression && allowed.has(params.taggedExpression)
      ? `A rough automatic guess was "${params.taggedExpression}"; include it unless it clearly does not fit.`
      : '',
    `Return ONLY a minified JSON array of ${limit} ids from the list, e.g. ["neutral","annoyed","thinking"].`,
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  let text: string
  try {
    text = await generateWithTimeout(
      client,
      { ...VISION_PARAMS, max_length: 80, max_context_length: await client.getEffectiveMaxContext(), prompt },
      'Shortlist expressions',
    )
  } catch {
    return fallback()
  }

  const parsed = tryParseJson(text)
  const picks = Array.isArray(parsed)
    ? parsed.filter((v): v is string => typeof v === 'string' && allowed.has(v.trim())).map((v) => v.trim())
    : []
  if (picks.length === 0) return fallback()
  // Guarantee the tagged guess is at least in the running, even if the model dropped it.
  const withTag =
    params.taggedExpression && allowed.has(params.taggedExpression) && !picks.includes(params.taggedExpression)
      ? [params.taggedExpression, ...picks]
      : picks
  return [...new Set(withTag)].slice(0, limit)
}

export interface SceneClassification {
  background?: string
  mood?: string
}

/** Classifies a photo the player attached into an available background id and/or scene mood, so the VN stage reflects what was shared. Either field may come back empty; both are validated against what the caller offered. */
export async function classifyAttachedImageScene(
  client: ChatBackend,
  params: {
    images: string[]
    backgroundIds: string[]
    moodIds: string[]
  },
): Promise<SceneClassification> {
  const images = params.images.filter(Boolean).slice(0, 3)
  if (images.length === 0) return {}
  const allowedBg = new Set(params.backgroundIds)
  const allowedMood = new Set(params.moodIds)
  if (allowedBg.size === 0 && allowedMood.size === 0) return {}

  const prompt = [
    `The player attached ${images.length === 1 ? 'this image' : 'these images'} to their message. Classify what ${images.length === 1 ? 'it shows' : 'they show'} for a visual-novel scene.`,
    allowedBg.size ? `Available background ids: ${params.backgroundIds.join(', ')}. Pick the closest, or "" if none fit the setting in the image.` : 'There are no selectable backgrounds; always return "" for background.',
    allowedMood.size ? `Available mood ids: ${params.moodIds.join(', ')}. Pick the one the image's feeling matches, or "" if unclear.` : 'There are no selectable moods; always return "" for mood.',
    'Return ONLY a minified JSON object: {"background":"<id or empty>","mood":"<id or empty>"}.',
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n')

  let text: string
  try {
    text = await generateWithTimeout(
      client,
      { ...VISION_PARAMS, max_length: 40, max_context_length: await client.getEffectiveMaxContext(), prompt, images },
      'Classify attached image',
    )
  } catch {
    return {}
  }

  const parsed = tryParseJson(text)
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const result: SceneClassification = {}
  if (typeof obj.background === 'string' && allowedBg.has(obj.background.trim())) result.background = obj.background.trim()
  if (typeof obj.mood === 'string' && allowedMood.has(obj.mood.trim())) result.mood = obj.mood.trim()
  return result
}

/** Same low-temperature classification params as the vision passes above, text-only (no image length cap). */
const GREETING_SCENE_PARAMS = {
  ...VISION_PARAMS,
  max_length: 40,
  stop_sequence: ['\n\n', '```'],
}

/**
 * Text-only correction for the common case where no vision-capable model is loaded: the model can
 * be lazy and repeat last turn's expression tag out of habit even when the prose it just wrote
 * clearly shows something else. Expression-only, never outfit (outfit is sticky by design and must
 * not auto-change from suggestive-reading text) or background. Strongly biased toward "no change" —
 * only flags a *clear, obvious* mismatch; returns `null` (keep current tag) on no signal, an
 * invalid/unparseable answer, or a client error.
 */
export async function detectExpressionTextMismatch(
  client: ChatBackend,
  params: {
    charName: string
    replyText: string
    taggedExpression: string
    candidates: ExpressionCandidate[]
  },
): Promise<string | null> {
  const reply = params.replyText.trim().slice(0, 900)
  const tagged = params.taggedExpression.trim()
  // Needs the current tag plus at least one real alternative to be worth asking about.
  if (!reply || !tagged || params.candidates.length < 2) return null

  const allowed = new Set(params.candidates.map((c) => c.id))
  const roster = params.candidates.map((c) => `${c.id} — ${c.label}`).join('\n')

  const prompt = [
    `${params.charName} was just tagged with the expression "${tagged}" after writing this line:`,
    `"""\n${reply}\n"""`,
    `Available expression ids:\n${roster}`,
    `Only pick a different id when the text is a CLEAR, obvious mismatch — it plainly shows a different emotion than "${tagged}" (tagged "blush" but the line is openly furious, say). A subtle, ambiguous, or merely-imperfect fit is NOT a mismatch: repeat "${tagged}" itself in that case.`,
    'Return ONLY a minified JSON object naming the expression id that actually fits: {"expression":"<id>"}.',
    'JSON:',
  ].join('\n')

  let text: string
  try {
    text = await generateWithTimeout(
      client,
      { ...GREETING_SCENE_PARAMS, max_context_length: await client.getEffectiveMaxContext(), prompt },
      'Detect expression/text mismatch',
    )
  } catch {
    return null
  }

  const parsed = tryParseJson(text)
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const picked = typeof obj.expression === 'string' ? obj.expression.trim() : ''
  if (!picked || !allowed.has(picked) || picked === tagged) return null
  return picked
}

/** A chat's static `first_mes` opening line is never generated, so it never gets a `<<scene:>>` tag (`sceneTag.ts`) the way later replies do. Run once at chat creation (`createChat.ts`), this gives it one anyway via a cheap text-only classification. */
export async function detectGreetingScene(
  client: ChatBackend,
  params: { text: string; expressionIds: string[]; backgroundIds: string[] },
): Promise<SceneTag | null> {
  const text = params.text.trim()
  if (!text) return null
  const allowedExpr = new Set(params.expressionIds)
  const allowedBg = new Set(params.backgroundIds)
  if (allowedExpr.size === 0 && allowedBg.size === 0) return null

  const prompt = [
    'This is the opening scene of an in-character roleplay:',
    `"""\n${text.slice(0, 1200)}\n"""`,
    allowedExpr.size
      ? `Available expression ids: ${params.expressionIds.join(', ')}. Pick whichever best matches the character's face/mood at the start of this scene.`
      : '',
    allowedBg.size
      ? `Available background ids: ${params.backgroundIds.join(', ')}. Pick the closest reasonable fit for where this scene is set, even if imperfect — e.g. a library is closest to "classroom" or "school-hallway", a car interior to "city-street". Only use "" if the setting is genuinely unclear or nothing on the list is even loosely plausible.`
      : '',
    'Return ONLY a minified JSON object: {"expression":"<id or empty>","background":"<id or empty>"}. Use "" for whichever you cannot confidently place.',
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n')

  let raw: string
  try {
    raw = await generateWithTimeout(
      client,
      { ...GREETING_SCENE_PARAMS, max_context_length: await client.getEffectiveMaxContext(), prompt },
      'Detect greeting scene',
    )
  } catch {
    return null
  }

  const parsed = tryParseJson(raw)
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const scene: SceneTag = {}
  if (typeof obj.expression === 'string' && allowedExpr.has(obj.expression.trim())) scene.expression = obj.expression.trim()
  if (typeof obj.background === 'string' && allowedBg.has(obj.background.trim())) scene.background = obj.background.trim()
  return Object.keys(scene).length ? scene : null
}

/** Pulls an expression id out of a model response — bare text, a quoted string, a JSON object, or (since vision models often answer with the picture number) a 1-based index mapped through `orderedIds`. An id match always wins over an index read. */
function firstAllowedId(text: string, allowed: Set<string>, orderedIds: string[] = []): string | null {
  if (!text?.trim()) return null

  const fromValue = (v: unknown): string | null => {
    if (typeof v === 'number') v = String(v)
    if (typeof v !== 'string') return null
    const s = v.trim()
    if (allowed.has(s)) return s
    return null
  }

  const parsed = tryParseJson(text)
  if (parsed && typeof parsed === 'object') {
    for (const v of Object.values(parsed as Record<string, unknown>)) {
      const hit = fromValue(v)
      if (hit) return hit
    }
  }

  // Longest allowed id appearing as a whole word wins ("very-happy" over "happy").
  const lower = text.toLowerCase()
  const idHits = [...allowed].filter((id) =>
    new RegExp(`(^|[^a-z0-9_-])${escapeRe(id.toLowerCase())}([^a-z0-9_-]|$)`).test(lower),
  )
  idHits.sort((a, b) => b.length - a.length)
  if (idHits[0]) return idHits[0]

  // Last resort: a bare index reference like "2" or "Image 3".
  const indexMatch = text.match(/(?:image\s*)?\b([1-9][0-9]?)\b/i)
  if (indexMatch) {
    const idx = Number(indexMatch[1]) - 1
    if (idx >= 0 && idx < orderedIds.length && allowed.has(orderedIds[idx])) return orderedIds[idx]
  }
  return null
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
