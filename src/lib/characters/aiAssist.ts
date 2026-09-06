import { normalizeCardJson, type CharacterCardData, type LorebookEntry, type RelationshipStarter } from './cardSpec'
import { TRAIT_AXIS_META, extractTraitOptionsPositionally, type TraitOptionSet } from './traitPresets'
import type { ChatBackend } from '@/lib/api/chatBackend'
import { generateWithTimeout } from '@/lib/api/generateWithTimeout'
import { parseLenientJson } from '@/lib/jsonRepair'
import { WEATHER_KINDS, type WeatherKind } from '@/lib/world/calendar'
import { slugifyOutfitId, type Outfit } from '@/lib/vn/outfits'
import { findSlop } from '@/lib/text/slop'
import { newId } from '@/lib/id'

/** Shared sampler settings for the JSON-drafting assist calls — steady, low-surprise decoding so the
 *  output actually parses. `regenerateCardField` keeps its own slightly hotter values on purpose
 *  (prose rewrite, not structured output). */
const ASSIST_SAMPLER = {
  temperature: 0.8,
  top_p: 0.95,
  top_k: 0,
  min_p: 0.05,
  typical: 1,
  tfs: 1,
  rep_pen: 1.1,
  rep_pen_range: 1024,
  rep_pen_slope: 0.7,
} as const

type CardTextField = 'description' | 'personality' | 'scenario'

const FIELD_LABELS: Record<CardTextField, string> = {
  description: 'description',
  personality: 'personality',
  scenario: 'scenario',
}

/** What a *good* version of each field looks like — the missing half of the old "rewrite this field
 *  so it fits" prompt, which said nothing about the target and so drifted straight to generic. */
const FIELD_GUIDANCE: Record<CardTextField, string> = {
  description:
    'A good description is concrete and particular: specific physical details (not "attractive", "piercing eyes", "an air of mystery"), and a background with real events, places, and names rather than a sketch of a personality type. Keep every fact the current text establishes — looks, history, relationships, the world it names — and rewrite the prose around those facts so it reads like it was written by someone who actually knows this character.',
  personality:
    'A good personality says how this character actually behaves: how they talk (clipped? formal? they overshare when nervous?), what they do when cornered or challenged, what they want, what they will not do. Traits with edges and contradictions, not a list of good qualities. Match the voice in their first message and example dialogue exactly — this field and those should sound like the same person.',
  scenario:
    'A good scenario is the concrete situation the chat opens in, in the present tense: where the characters are, what just happened, why {{user}} and {{char}} are in the same place right now. One short paragraph. Not a life story, not a mood piece.',
}

/** Anything AI-assist can ground a suggestion in — a character card, a world card, or anything else with a name + some free text. */
export interface AiLoreSubject {
  name: string
  description?: string
  personality?: string
  scenario?: string
  /** Extra free-text context with no fixed slot elsewhere (e.g. a world's "rules" field). */
  extra?: string
}

function contextSummary(subject: AiLoreSubject, omitField?: string): string {
  const lines = [`Name: ${subject.name}`]
  if (omitField !== 'description' && subject.description?.trim())
    lines.push(`Description: ${subject.description.trim()}`)
  if (omitField !== 'personality' && subject.personality?.trim())
    lines.push(`Personality: ${subject.personality.trim()}`)
  if (omitField !== 'scenario' && subject.scenario?.trim())
    lines.push(`Scenario: ${subject.scenario.trim()}`)
  if (subject.extra?.trim()) lines.push(subject.extra.trim())
  return lines.join('\n')
}

/**
 * The user's global "Writing style" setting (Settings → Generation → Writing style) folded into an
 * authoring prompt, so a generated or rewritten card matches the prose they've asked for in every
 * chat. Placed right after the built-in style block and told to win on any conflict — the same
 * "closest to generation wins" placement `buildPrompt` gives it in the live chat prompt. `''` when
 * unset, so it costs nothing for the common case.
 */
function writerStyleNote(styleGuidance: string | undefined): string {
  const s = styleGuidance?.trim()
  return s
    ? `The writer keeps these style notes for everything they make in this app. Follow them, and where they conflict with the guidance above, they take priority:\n${s}`
    : ''
}

// Every `client.generate` call in this file goes through `generateWithTimeout` rather than a bare
// call — a slow/rate-limited backend that simply never responds otherwise leaves the caller (the
// "Regenerate" field button, `GenerateCharacterDialog`, the lore-entry suggester) stuck forever:
// its `busy` state is only ever cleared in a `finally` after the awaited call settles, so a hang
// reads as the button stuck spinning with no error and no way to retry.

/**
 * Rewrites a single card field, keeping it consistent with the rest. The old version of this prompt
 * just said "rewrite this field so it fits" with no notion of what good looks like and no style
 * steering, so it reliably produced generic AI prose. Now it: shows the current text and asks for a
 * rewrite that keeps its facts (not a fresh invention that drifts off-character), states what a good
 * version of that specific field is (`FIELD_GUIDANCE`), carries the same `PROSE_STYLE_CORE` anti-slop
 * block the chat prompts use, `writerStyleNote` for the user's global writing-style setting, and —
 * the concrete-beats-abstract trick from `slop.ts` — names the exact tells the current text leans on
 * so the model has something real to avoid.
 */
export async function regenerateCardField(
  client: ChatBackend,
  character: CharacterCardData,
  fieldKey: CardTextField,
  opts?: { hint?: string; styleGuidance?: string },
): Promise<string> {
  const hint = opts?.hint
  const label = FIELD_LABELS[fieldKey]
  const current = (character[fieldKey] ?? '').trim()
  const voiceRef = [
    character.first_mes?.trim() && `First message:\n${character.first_mes.trim()}`,
    character.mes_example?.trim() && `Example dialogue:\n${character.mes_example.trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n')
  const context = contextSummary({ ...character, extra: voiceRef || undefined }, fieldKey)
  const namedSlop = current
    ? findSlop(current)
        .slice(0, 5)
        .map((h) => h.label)
    : []

  const prompt = [
    `You are rewriting one field of a character card for a roleplay app because the current version reads like generic AI writing.`,
    `The rest of the character — stay consistent with all of it, do not change any of it:\n${context}`,
    current
      ? `Current ${label}, which needs work:\n${current}`
      : `The ${label} field is empty. Write it from scratch, grounded in everything above.`,
    FIELD_GUIDANCE[fieldKey],
    PROSE_STYLE_CORE,
    writerStyleNote(opts?.styleGuidance),
    namedSlop.length
      ? `The current version leans on these tells. Do not reuse any of them; find a different way to say it: ${namedSlop.join('; ')}.`
      : '',
    hint?.trim() ? `What the writer specifically wants changed: ${hint.trim()}` : '',
    `Output only the replacement ${label} text — no label, no surrounding quotes, no commentary, no markdown headings.`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await generateWithTimeout(
    client,
    {
      prompt,
      max_length: 450,
      max_context_length: await client.getEffectiveMaxContext(),
      temperature: 0.9,
      top_p: 0.95,
      top_k: 0,
      min_p: 0.05,
      typical: 1,
      tfs: 1,
      rep_pen: 1.12,
      rep_pen_range: 1024,
      rep_pen_slope: 0.7,
      stop_sequence: ['\n\n\n'],
      trim_stop: true,
    },
    'Regenerate field',
  )
  return text.trim()
}

/** The card fields every draft path fills, and how each should read. Portrait mode prepends its own
 *  image-fidelity note; the JSON shape and formatting rules below are identical for both. */
const CARD_FIELD_SPEC = `Output ONLY a single JSON object — no markdown fences, no commentary before or after — with exactly these keys:
- "name": string.
- "description": string. Appearance and background, in concrete detail rather than a general impression.
- "personality": string. How they talk, move, and treat people — traits with edges, not a list of good qualities.
- "scenario": string. The situation the chat opens in, written in the present tense.
- "first_mes": string. The character's opening message, 2 to 4 short paragraphs. Wrap every physical action and line of narration in *single asterisks*, and every word spoken aloud in "double quotes". Put \\n\\n between paragraphs. End on something {{user}} can clearly respond to.
- "mes_example": string, NOT an array. Two or three sample exchanges. Begin each one with <START> on its own line, then a "{{user}}:" line, then a "{{char}}:" line in the character's voice using the same *asterisks* / "quotes" convention. Separate every line with \\n.
- "creator_notes": string, for whoever edits this card next. May be "".
- "tags": array of short lowercase strings.`

/** The core anti-slop guidance, verbatim house style from `systemPrompts.ts`. Reused by the
 *  whole-card prompts and by the single-field `regenerateCardField` rewrite. */
const PROSE_STYLE_CORE = `Write like a person, not like an AI. Plain, specific language with a real point of view. No em dashes. Drop the habits of machine-written roleplay: hedging, naming a feeling instead of showing it, "a mix of X and Y", "not just X but Y", tidy lists of three, "voice barely above a whisper", "a shiver down her spine", any sentence that tells the reader how to feel.`

/** Whole-card version: the core plus the cross-field consistency point, aimed at the two fields
 *  that are actual fiction (`first_mes`, `mes_example`) rather than metadata. */
const CARD_PROSE_STYLE = `Prose style, above all in "first_mes" and "mes_example": ${PROSE_STYLE_CORE} Give the character one specific voice and keep it consistent across the personality, the first message, and the examples — a blunt character is blunt in all three.`

const CARD_JSON_RULES = `Critical JSON rules: output strictly valid JSON. Keep every string value on a single logical line — write \\n for any line break inside a string, never a real newline. Follow every property and array element with a comma unless it is the last one. Straight double quotes only; escape any quote inside a string as \\".`

const PORTRAIT_SYSTEM_INSTRUCTION = `You write character cards for a roleplay app, working from a reference portrait instead of a text brief. Look at the attached image and build a character who plausibly fits what it actually shows — expression, styling, setting, era, every visible detail. "description" must match the image, not a generic guess; the background is yours to invent.

${CARD_FIELD_SPEC}

${CARD_PROSE_STYLE}

${CARD_JSON_RULES}`

/**
 * Section 10's "AI-assisted authoring... draft an entire character from an uploaded portrait" —
 * image-to-text only (an existing vision-capable model describing a picture into card fields),
 * not image *generation*; that's section 11's separate, already-shipped `ImageBackend` work.
 * Reuses the exact same `images: [base64]` shape `sceneVision.ts` already established for vision
 * calls in this app. `worldTone` (a selected world's own description, when the character is being
 * created under one) steers the invented backstory/setting to fit rather than contradict it —
 * the "fitted to the world's tone" half of this item's own wording.
 */
export async function draftCharacterFromPortrait(
  client: ChatBackend,
  portraitBase64: string,
  opts?: { brief?: string; worldTone?: string; styleGuidance?: string; signal?: AbortSignal },
): Promise<{ card: CharacterCardData; rawOutput: string }> {
  const prompt = [
    PORTRAIT_SYSTEM_INSTRUCTION,
    writerStyleNote(opts?.styleGuidance),
    opts?.worldTone?.trim() ? `Fit the character to this world's own tone and setting:\n${opts.worldTone.trim()}` : '',
    opts?.brief?.trim() ? `Additional guidance from the creator: ${opts.brief.trim()}` : '',
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await generateWithTimeout(
    client,
    {
      prompt,
      images: [portraitBase64],
      max_length: 1200,
      max_context_length: await client.getEffectiveMaxContext(),
      ...ASSIST_SAMPLER,
      stop_sequence: ['\n\n\n', '```'],
      trim_stop: true,
    },
    'Draft character from portrait',
    opts?.signal,
  )
  const card = normalizeCardJson(parseLenientJson(text))
  return { card, rawOutput: text }
}

const BRIEF_SYSTEM_INSTRUCTION = `You write character cards for a roleplay app from a short brief. Take the brief as the seed and fill in the specifics it leaves open.

${CARD_FIELD_SPEC}

${CARD_PROSE_STYLE}

${CARD_JSON_RULES}`

/**
 * The text-brief counterpart to `draftCharacterFromPortrait` — the same review-before-save draft, from
 * a written brief instead of an image. The prompt lived inline in `GenerateCharacterDialog` until the
 * "generate a full character" orchestrator (`generateFullCharacter.ts`) needed to call the same thing
 * headlessly; it now lives here next to the portrait path, and — like that path — folds in `worldTone`
 * so a brief-drafted character fits a selected world instead of contradicting it.
 */
export async function draftCharacterFromBrief(
  client: ChatBackend,
  brief: string,
  opts?: { worldTone?: string; styleGuidance?: string; signal?: AbortSignal },
): Promise<{ card: CharacterCardData; rawOutput: string }> {
  const prompt = [
    BRIEF_SYSTEM_INSTRUCTION,
    writerStyleNote(opts?.styleGuidance),
    opts?.worldTone?.trim() ? `Fit the character to this world's own tone and setting:\n${opts.worldTone.trim()}` : '',
    `Brief: ${brief.trim()}`,
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await generateWithTimeout(
    client,
    {
      prompt,
      max_length: 1200,
      max_context_length: await client.getEffectiveMaxContext(),
      ...ASSIST_SAMPLER,
      stop_sequence: ['\n\n\n', '```'],
      trim_stop: true,
    },
    'Generate character',
    opts?.signal,
  )
  const card = normalizeCardJson(parseLenientJson(text))
  return { card, rawOutput: text }
}

/**
 * The option pool behind "combinatorial" character creation (`GenerateCharacterDialog`'s "From
 * traits" mode) — asks the connected model for a fresh batch of short trait phrases across the four
 * fixed axes (`TRAIT_AXIS_META`), rather than shipping a static list that never changes and eventually
 * repeats. The picker then composes whichever options the user picks into a brief, which goes through
 * `draftCharacterFromBrief` exactly like a hand-typed one — this call only supplies the menu, not the
 * card.
 */
export async function generateTraitOptions(
  client: ChatBackend,
  opts?: { worldTone?: string; styleGuidance?: string; count?: number; signal?: AbortSignal },
): Promise<TraitOptionSet> {
  const count = opts?.count ?? 10
  const prompt = [
    'You are proposing short trait options for a character-creation picker in a roleplay app. The user will pick one option from each category below, and the picks get combined into a brief for drafting a full character.',
    opts?.worldTone?.trim() ? `Fit them to this world's own tone and setting:\n${opts.worldTone.trim()}` : '',
    writerStyleNote(opts?.styleGuidance),
    `Propose ${count} options for each of these four categories:`,
    '- archetype: a short personality-type phrase, 2-4 words (e.g. "tsundere", "stoic guardian")',
    '- occupation: a specific job with a concrete flavor, not just a bare title (e.g. "night-shift ER nurse", not "nurse")',
    '- quirk: one vivid, specific behavioral detail as a short clause, not a generic trait',
    '- relationshipStarter: how this character and the player already know each other, as a short clause',
    'Make every option specific and varied — avoid bland defaults like "mysterious stranger" or "kind and caring" unless given a genuinely fresh angle.',
    `Output ONLY a minified JSON object shaped exactly {"archetype": [${count} strings], "occupation": [${count} strings], "quirk": [${count} strings], "relationshipStarter": [${count} strings]}. No markdown fences, no commentary.`,
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await generateWithTimeout(
    client,
    {
      prompt,
      max_length: 1400,
      max_context_length: await client.getEffectiveMaxContext(),
      ...ASSIST_SAMPLER,
      stop_sequence: ['\n\n\n', '```'],
      trim_stop: true,
    },
    'Generate trait options',
    opts?.signal,
  )

  let parsed: unknown = null
  let parseFailed = false
  try {
    parsed = parseLenientJson(text)
  } catch {
    parseFailed = true
  }
  // A wrong-shaped but successfully-parsed response (e.g. a bare array) means something other
  // than the bracket-dropping glitch below — not something the positional fallback can help
  // with either, since it has no key markers to find — so it still fails fast and clearly.
  if (!parseFailed && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw new Error('Model did not return a JSON object of trait options')
  }
  const obj = (parsed as Record<string, unknown> | null) ?? {}
  let result = Object.fromEntries(TRAIT_AXIS_META.map((axis) => [axis.id, strList(obj[axis.id], count)])) as TraitOptionSet

  // A free/weaker model sometimes drops the array brackets for one or more keys entirely,
  // which breaks JSON.parse for the *whole* object even though the other keys were fine —
  // recover positionally instead of giving up the whole batch over one malformed key (see
  // extractTraitOptionsPositionally's own comment for the exact shape). Only reached when
  // parsing genuinely failed: a well-formed object with one wrong-typed field (e.g. a bare
  // string instead of an array) still just leaves that one axis an empty list, not silently
  // reinterpreted as a single-item option list.
  if (parseFailed) {
    const positional = extractTraitOptionsPositionally(text)
    result = Object.fromEntries(TRAIT_AXIS_META.map((axis) => [axis.id, strList(positional[axis.id], count)])) as TraitOptionSet
  }
  if (!result.archetype.length) throw new Error('Model did not return any archetype options')
  return result
}

/** The practical, non-card life details `CharacterEditor` keeps as their own `Character` fields (not
 *  on the portable card): job, where they live, hobbies, goals, hard limits, love language. */
export interface DraftedProfile {
  occupation: string
  workplace: string
  homeLocation: string
  frequentedLocations: string[]
  likes: string[]
  goals: string[]
  boundaries: string[]
  loveLanguage: string
}

function strList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max)
}

/**
 * Stage 2 of `generateFullCharacter.ts` — given a drafted card, invent the character's day-to-day
 * life. Deliberately best-effort: the caller treats a parse failure here as "skip this stage", not a
 * hard error, since a character with an empty occupation is still perfectly usable.
 */
export async function draftCharacterProfile(
  client: ChatBackend,
  subject: AiLoreSubject,
  opts?: { worldTone?: string; styleGuidance?: string; signal?: AbortSignal },
): Promise<DraftedProfile> {
  const prompt = [
    'You are fleshing out a character profile for a roleplay app. Given the character so far, invent the practical details of their everyday life so they stay consistent with who they already are.',
    writerStyleNote(opts?.styleGuidance),
    opts?.worldTone?.trim() ? `World this character lives in:\n${opts.worldTone.trim()}` : '',
    `Character so far:\n${contextSummary(subject)}`,
    [
      'Output ONLY a single minified JSON object with exactly these keys:',
      '"occupation": string — their job or role (e.g. "night-shift nurse", "third-year art student"), or "" if genuinely not applicable.',
      '"workplace": string — where they work or study, or "".',
      '"homeLocation": string — where they live, one short phrase.',
      '"frequentedLocations": array of 2-4 short strings — places they are often found.',
      '"likes": array of 3-6 short strings — interests and hobbies.',
      '"goals": array of 2-4 short strings — what they want or are working toward.',
      '"boundaries": array of 1-3 short strings — things they will not do or will not tolerate, in character.',
      '"loveLanguage": string — one sentence on how they most feel cared for.',
      'Keep everything consistent with the description and personality above. Plain, concrete language. No markdown, no commentary.',
    ].join('\n'),
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await generateWithTimeout(
    client,
    {
      prompt,
      max_length: 500,
      max_context_length: await client.getEffectiveMaxContext(),
      ...ASSIST_SAMPLER,
      stop_sequence: ['\n\n\n', '```'],
      trim_stop: true,
    },
    'Draft character profile',
    opts?.signal,
  )
  const parsed = parseLenientJson(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model did not return a JSON object for the character profile')
  }
  const o = parsed as Record<string, unknown>
  return {
    occupation: typeof o.occupation === 'string' ? o.occupation.trim() : '',
    workplace: typeof o.workplace === 'string' ? o.workplace.trim() : '',
    homeLocation: typeof o.homeLocation === 'string' ? o.homeLocation.trim() : '',
    frequentedLocations: strList(o.frequentedLocations, 4),
    likes: strList(o.likes, 6),
    goals: strList(o.goals, 4),
    boundaries: strList(o.boundaries, 3),
    loveLanguage: typeof o.loveLanguage === 'string' ? o.loveLanguage.trim() : '',
  }
}

/** The dating-layer traits `CharacterEditor` keeps as their own `Character` fields — gift taste,
 *  weather feelings, and the "how do we already know each other" relationship starters. */
export interface DraftedBonds {
  giftLikes: string[]
  giftDislikes: string[]
  weatherLoves: WeatherKind[]
  weatherHates: WeatherKind[]
  relationshipStarters: RelationshipStarter[]
}

function weatherList(v: unknown): WeatherKind[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<WeatherKind>()
  for (const x of v) {
    if (typeof x === 'string' && (WEATHER_KINDS as readonly string[]).includes(x.trim().toLowerCase())) {
      seen.add(x.trim().toLowerCase() as WeatherKind)
    }
  }
  return [...seen]
}

/**
 * Stage 3 of `generateFullCharacter.ts` — the dating/relationship traits. Same best-effort contract
 * as `draftCharacterProfile`. `relationshipStarters` get a fresh `id` here (the model only supplies
 * label/blurb/affection) and `startingAffection` is clamped to the 0-100 affection scale.
 */
export async function draftCharacterBonds(
  client: ChatBackend,
  subject: AiLoreSubject,
  opts?: { worldTone?: string; styleGuidance?: string; signal?: AbortSignal },
): Promise<DraftedBonds> {
  const prompt = [
    'You are writing the relationship details for a character in a roleplay/dating-sim app, given who they already are.',
    writerStyleNote(opts?.styleGuidance),
    opts?.worldTone?.trim() ? `World this character lives in:\n${opts.worldTone.trim()}` : '',
    `Character so far:\n${contextSummary(subject)}`,
    [
      'Output ONLY a single minified JSON object with exactly these keys:',
      '"giftLikes": array of 2-4 short strings — kinds of gifts this character loves (categories, not specific items).',
      '"giftDislikes": array of 1-3 short strings — kinds of gifts that fall flat.',
      `"weatherLoves": array of 0-3 values, each EXACTLY one of: ${WEATHER_KINDS.join(', ')}.`,
      '"weatherHates": array of 0-3 values from that same set.',
      '"relationshipStarters": array of EXACTLY 3 objects {"label": short string, "blurb": 1-2 sentences in second person ("You and NAME ..."), "startingAffection": number}. The three escalate: startingAffection 0, then about 20, then about 35 — three ways the player might already know this character, from total strangers to a real prior history.',
      'Keep everything consistent with the personality above. Plain language. No markdown, no commentary.',
    ].join('\n'),
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await generateWithTimeout(
    client,
    {
      prompt,
      max_length: 600,
      max_context_length: await client.getEffectiveMaxContext(),
      ...ASSIST_SAMPLER,
      stop_sequence: ['\n\n\n', '```'],
      trim_stop: true,
    },
    'Draft character bonds',
    opts?.signal,
  )
  const parsed = parseLenientJson(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model did not return a JSON object for the character bonds')
  }
  const o = parsed as Record<string, unknown>
  const starters: RelationshipStarter[] = (Array.isArray(o.relationshipStarters) ? o.relationshipStarters : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      id: newId(),
      label: typeof s.label === 'string' ? s.label.trim() : '',
      blurb: typeof s.blurb === 'string' ? s.blurb.trim() : '',
      startingAffection: Math.max(0, Math.min(100, Math.round(Number(s.startingAffection) || 0))),
    }))
    .filter((s) => s.label && s.blurb)
    .slice(0, 4)
  return {
    giftLikes: strList(o.giftLikes, 4),
    giftDislikes: strList(o.giftDislikes, 3),
    weatherLoves: weatherList(o.weatherLoves),
    weatherHates: weatherList(o.weatherHates),
    relationshipStarters: starters,
  }
}

/**
 * Stage 4 of `generateFullCharacter.ts` — wardrobe states for the Visual novel → Expressions grid.
 * Labels and unlock gates only, no art: the editor picks these up as outfits the user then draws (or
 * generates) sprites for. Same best-effort contract as the profile/bonds stages. `id`s are minted
 * here with `slugifyOutfitId` (deduped as we go); an `intimate` outfit is also flagged `manualOnly`
 * so the model can't drop the character into it just because a reply read as suggestive.
 */
export async function draftCharacterOutfits(
  client: ChatBackend,
  subject: AiLoreSubject,
  opts?: { worldTone?: string; signal?: AbortSignal },
): Promise<Outfit[]> {
  const prompt = [
    'You are proposing wardrobe states ("outfits") for a character in a visual-novel roleplay app — alternate looks the story can switch them into. No images: just a name for each and the affection level at which it becomes available.',
    opts?.worldTone?.trim() ? `World this character lives in:\n${opts.worldTone.trim()}` : '',
    `Character so far:\n${contextSummary(subject)}`,
    [
      'Output ONLY a minified JSON array of 2-4 objects, each {"label": short string, "unlockAffection": number 0-100, "intimate": boolean}.',
      'The first outfit is their everyday default look with unlockAffection 0. The rest fit the character and escalate a little — a formal or work look, a seasonal one, a relaxed at-home one. Set "intimate": true on at most one, only for an undressed / bedroom state, and give it a high unlockAffection.',
      'Do not repeat the look the description already puts them in. No markdown, no commentary.',
    ].join('\n'),
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await generateWithTimeout(
    client,
    {
      prompt,
      max_length: 400,
      max_context_length: await client.getEffectiveMaxContext(),
      ...ASSIST_SAMPLER,
      stop_sequence: ['\n\n\n', '```'],
      trim_stop: true,
    },
    'Draft character outfits',
    opts?.signal,
  )
  const parsed = parseLenientJson(text)
  if (!Array.isArray(parsed)) throw new Error('Model did not return a JSON array of outfits')
  const ids: string[] = []
  const outfits: Outfit[] = []
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const label = typeof o.label === 'string' ? o.label.trim() : ''
    if (!label) continue
    const id = slugifyOutfitId(label, ids)
    ids.push(id)
    const outfit: Outfit = { id, label }
    const unlock = Math.max(0, Math.min(100, Math.round(Number(o.unlockAffection) || 0)))
    if (unlock > 0) outfit.unlockAffection = unlock
    if (o.intimate === true) {
      outfit.intimate = true
      outfit.manualOnly = true
    }
    outfits.push(outfit)
    if (outfits.length >= 4) break
  }
  return outfits
}

export interface SuggestedLoreEntry {
  keys: string[]
  content: string
}

/** Proposes new world-info entries grounded in a character or world card, avoiding whatever's already in the book. */
export async function suggestLoreEntries(
  client: ChatBackend,
  subject: AiLoreSubject,
  existingEntries: LorebookEntry[],
  count = 3,
  signal?: AbortSignal,
): Promise<SuggestedLoreEntry[]> {
  const context = contextSummary(subject)
  const existingKeys = existingEntries.flatMap((e) => e.keys).join(', ')
  const prompt = [
    'You are helping write World Info / lorebook entries for a roleplay app.',
    `Subject:\n${context}`,
    existingKeys ? `Lore already covered (don't repeat these): ${existingKeys}` : '',
    `Propose ${count} new lore entries: relationships, locations, important past events, or rules that would help an AI stay consistent when roleplaying in this context.`,
    `Output ONLY a minified JSON array of ${count} objects, each shaped exactly {"keys": ["keyword1","keyword2"], "content": "1-3 sentences of plain prose"}. 2-3 keywords per entry that would plausibly come up in conversation. No markdown fences, no commentary.`,
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = await generateWithTimeout(
    client,
    {
      prompt,
      max_length: 600,
      max_context_length: await client.getEffectiveMaxContext(),
      ...ASSIST_SAMPLER,
      stop_sequence: ['\n\n\n', '```'],
      trim_stop: true,
    },
    'Suggest lore entries',
    signal,
  )

  const parsed = parseLenientJson(text)
  if (!Array.isArray(parsed)) throw new Error('Model did not return a JSON array of lore entries')
  return parsed
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      keys: Array.isArray(e.keys) ? e.keys.filter((k): k is string => typeof k === 'string') : [],
      content: typeof e.content === 'string' ? e.content : '',
    }))
    .filter((e) => e.keys.length > 0 && e.content.trim())
}
