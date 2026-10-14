// The extra drafting stages of a full character: greetings, connections and rules, voice, gifts, routine, persona settings and intimacy settings.

import type { ChatBackend } from '@/lib/api/chatBackend'
import { generateWithTimeout, type AssistShaping } from '@/lib/api/generateWithTimeout'
import { BODY_REGIONS } from '@/lib/dating/arousal'
import { BUILT_IN_KINKS, type KinkProfile } from '@/lib/dating/kinks'
import type { TouchProfile } from '@/lib/dating/touch'
import { parseLenientJson } from '@/lib/jsonRepair'
import { newId } from '@/lib/id'
import { DEFAULT_DRIVE_CONFIG, type DriveConfig } from '@/lib/persona/drive'
import type { GiftItem } from '@/lib/types'
import { DAYS_PER_SEASON, PHASES, SEASONS, WEEKDAYS, type PresenceStatus, type ScheduleEntry } from '@/lib/world/calendar'
import { ASSIST_SAMPLER, PROSE_STYLE_CORE, contextSummary, strList, writerStyleNote, type AiLoreSubject } from './aiAssist'
import type { BehavioralRule, Character, CharacterCardData, OutreachFrequency, SocialConnection, VoiceFingerprint } from './cardSpec'
import { detectVoiceFingerprint } from './voice'

/** Character fields these stages fill; they land on the character as-is, so the editor and the API share one shape. */
export type DraftExtras = Partial<
  Pick<
    Character,
    | 'socialConnections'
    | 'behavioralRules'
    | 'voiceFingerprint'
    | 'sfxWords'
    | 'giftPreferences'
    | 'schedule'
    | 'birthday'
    | 'outreach'
    | 'drive'
    | 'touchProfile'
    | 'kinkProfile'
    | 'explicitVoiceNote'
  >
>

export interface StageOpts {
  worldTone?: string
  styleGuidance?: string
  signal?: AbortSignal
  shaping?: AssistShaping
  /** The writer's instruction when rewriting a saved section: it wins over what the card already says. */
  hint?: string
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const records = (v: unknown) => (Array.isArray(v) ? v.filter(isRecord) : [])
const oneOf = <T extends string>(options: readonly T[], v: unknown) => options.find((o) => o === text(v).toLowerCase())

/** An answer that parsed but cannot be used. The message is written for the model too: the retry shows it. */
class Rejected extends Error {}

/** One JSON-object call: the shared character block first, the stage's own instructions last, one retry that says why the first answer failed. */
async function askJson<T>(
  client: ChatBackend,
  subject: AiLoreSubject,
  opts: StageOpts,
  stage: { label: string; maxLength: number; instructions: string; parse: (o: Record<string, unknown>) => T },
): Promise<T> {
  const blocks = [
    'You are filling in one section of a character for a roleplay app. Stay consistent with everything already written and do not contradict it.',
    writerStyleNote(opts.styleGuidance),
    opts.worldTone?.trim() ? `World this character lives in:\n${opts.worldTone.trim()}` : '',
    `Character so far:\n${contextSummary(subject)}`,
    stage.instructions,
    opts.hint?.trim() ? "The writer's instruction above overrides the rest of the character wherever they disagree. Make the change visible, not a rewording." : '',
  ]
  let failure: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const why = failure instanceof Rejected ? failure.message : 'It was not valid JSON: every string, including each item in a list, needs double quotes.'
    const prompt = [...blocks, failure ? `Your previous answer was rejected. ${why} Answer again.` : '', 'JSON:'].filter(Boolean).join('\n\n')
    const raw = await generateWithTimeout(
      client,
      {
        prompt,
        max_length: stage.maxLength,
        max_context_length: await client.getEffectiveMaxContext(),
        ...ASSIST_SAMPLER,
        stop_sequence: ['\n\n\n', '```'],
        trim_stop: true,
      },
      stage.label,
      opts.signal,
      opts.shaping,
    )
    try {
      const parsed = parseLenientJson(raw)
      if (!isRecord(parsed)) throw new Rejected('It was not a JSON object.')
      return stage.parse(parsed)
    } catch (e) {
      failure = e
    }
  }
  throw failure
}

// ---- Alternate greetings ----

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** 1-3 greetings that differ from the first message and from each other. */
export function parseGreetings(o: Record<string, unknown>, firstMes = ''): string[] {
  const seen = new Set([squash(firstMes)])
  const out: string[] = []
  for (const g of Array.isArray(o.greetings) ? o.greetings : []) {
    const greeting = text(g).slice(0, 5000)
    if (!greeting || seen.has(squash(greeting))) continue
    seen.add(squash(greeting))
    out.push(greeting)
    if (out.length === 3) break
  }
  if (!out.length) throw new Rejected('It had no usable alternate greetings: each must differ from the first message and from the others.')
  return out
}

export function draftGreetings(client: ChatBackend, subject: AiLoreSubject, firstMes: string, opts: StageOpts): Promise<string[]> {
  return askJson(client, subject, opts, {
    label: 'Draft alternate greetings',
    maxLength: 800,
    instructions: [
      'Write 2 alternate opening messages for this character. Each is a different way a chat with {{user}} could begin: a different place, time or situation from the first message and from each other. Same voice and formatting as the first message: every physical action and line of narration in *single asterisks*, every word spoken aloud in "double quotes", 1 to 3 short paragraphs each, ending on something {{user}} can clearly respond to.',
      PROSE_STYLE_CORE,
      'Output ONLY a JSON object {"greetings": [string, string]}. Put \\n\\n between paragraphs inside a string, never a real newline. Straight double quotes only; escape any quote inside a string as \\".',
    ].join('\n'),
    parse: (o) => parseGreetings(o, firstMes),
  })
}

// ---- Connections and behavioral rules ----

export function parseSocial(o: Record<string, unknown>): DraftExtras {
  const connections: SocialConnection[] = records(o.socialConnections)
    .map((c) => ({ id: newId(), name: text(c.name), relation: text(c.relation), ...(text(c.notes) ? { notes: text(c.notes) } : {}) }))
    .filter((c) => c.name && c.relation)
    .slice(0, 5)
  const rules: BehavioralRule[] = records(o.behavioralRules)
    .map((r) => {
      const kind: BehavioralRule['kind'] = r.kind === 'never' ? 'never' : 'when_then'
      return { id: newId(), kind, ...(kind === 'when_then' ? { when: text(r.when) } : {}), then: text(r.then) }
    })
    .filter((r) => r.then && (r.kind === 'never' || r.when))
    .slice(0, 6)
  if (!connections.length && !rules.length) throw new Rejected('It had no usable connections or behavioral rules.')
  return { ...(connections.length ? { socialConnections: connections } : {}), ...(rules.length ? { behavioralRules: rules } : {}) }
}

export function draftSocial(client: ChatBackend, subject: AiLoreSubject, opts: StageOpts): Promise<DraftExtras> {
  return askJson(client, subject, opts, {
    label: 'Draft connections and rules',
    maxLength: 700,
    instructions: [
      'Output ONLY a minified JSON object with exactly these keys:',
      '"socialConnections": array of 2-4 objects {"name": string, "relation": string, "notes": string}. The people in this character\'s life: family, friends, a rival, a coworker. "name" is a person\'s name, "relation" says how they are connected ("older sister", "rival from the debate club"), "notes" is one short sentence on how that person matters to them. Do not include {{user}}.',
      '"behavioralRules": array of 3-6 objects {"kind": "when_then" or "never", "when": string, "then": string}. Concrete rules for how this character behaves in conversation. "when_then": "when" is a situation, "then" is what they do. "never": "then" is something they never do and "when" is "". Include at least one "never". Specific behaviours, not a restatement of the personality.',
      'Plain, concrete language. No markdown, no commentary.',
    ].join('\n'),
    parse: parseSocial,
  })
}

// ---- Voice ----

export interface DraftedVoice {
  verbalTics: string[]
  catchphrases: string[]
  dialectNotes: string
  sentenceRhythm: string
  sfxWords: string[]
}

/** Short strings that contain at least one letter: a bare "..." is not a tic. */
const words = (v: unknown, max: number) => strList(v, 50).filter((s) => /\p{L}/u.test(s)).slice(0, max)

export function parseVoice(o: Record<string, unknown>): DraftedVoice {
  return {
    verbalTics: words(o.verbalTics, 4),
    catchphrases: words(o.catchphrases, 3),
    dialectNotes: text(o.dialectNotes),
    sentenceRhythm: text(o.sentenceRhythm),
    sfxWords: words(o.sfxWords, 4),
  }
}

/** The model's read of the voice, with the free detector from the card's own dialogue filling whatever it left out. */
export async function draftVoice(client: ChatBackend, subject: AiLoreSubject, card: CharacterCardData, opts: StageOpts): Promise<DraftExtras> {
  const drafted = await askJson(client, subject, opts, {
    label: 'Draft voice',
    maxLength: 400,
    instructions: [
      'Output ONLY a minified JSON object with exactly these keys:',
      '"verbalTics": array of 0-4 short strings, filler words or sounds they actually lean on ("well,", "hm."). Fewer is better than invented ones.',
      '"catchphrases": array of 0-3 short strings, signature phrases they reuse.',
      '"dialectNotes": string, one or two sentences on register and diction: formal or casual, slang, contractions, how they swear (or never do).',
      '"sentenceRhythm": string, one short sentence on how their sentences run, like "Short and clipped."',
      '"sfxWords": array of 0-4 short sound-effect words in their voice, like "tch" or "hmph".',
      'Base it on the first message and example dialogue above and do not contradict them. Plain language. No markdown, no commentary.',
    ].join('\n'),
    parse: parseVoice,
  })
  const found = detectVoiceFingerprint(card)
  // The detector's repeated phrases are mostly noise ("before the"), so only its tics, rhythm and punctuation habits are used.
  const verbalTics = drafted.verbalTics.length ? drafted.verbalTics : found.verbalTics
  const dialectNotes = drafted.dialectNotes || found.punctuationNotes || ''
  const sentenceRhythm = drafted.sentenceRhythm || found.sentenceRhythm || ''
  const fingerprint: VoiceFingerprint = {
    ...(verbalTics.length ? { verbalTics } : {}),
    ...(drafted.catchphrases.length ? { catchphrases: drafted.catchphrases } : {}),
    ...(dialectNotes ? { dialectNotes } : {}),
    ...(sentenceRhythm ? { sentenceRhythm } : {}),
  }
  if (!Object.keys(fingerprint).length && !drafted.sfxWords.length) throw new Error('The model did not return any usable voice details')
  return {
    ...(Object.keys(fingerprint).length ? { voiceFingerprint: fingerprint } : {}),
    ...(drafted.sfxWords.length ? { sfxWords: drafted.sfxWords } : {}),
  }
}

// ---- Gift scores ----

/** Scores for gifts in the catalog only (named by id or by exact name), rounded into the -2..3 range the editor uses; zero means no opinion and is left out. */
export function parseGiftScores(o: Record<string, unknown>, catalog: readonly GiftItem[]): Record<string, number> {
  const ids = new Set(catalog.map((g) => g.id))
  const idByName = new Map(catalog.map((g) => [g.name.toLowerCase(), g.id]))
  const scores: Record<string, number> = {}
  for (const [key, value] of Object.entries(isRecord(o.scores) ? o.scores : o)) {
    const id = ids.has(key) ? key : idByName.get(key.trim().toLowerCase())
    const score = Math.round(Number(value))
    if (id && Number.isFinite(score) && score !== 0) scores[id] = Math.max(-2, Math.min(3, score))
  }
  if (!Object.keys(scores).length) throw new Rejected(`It scored no gift from the list. Give a few of them a score other than 0, using only these ids exactly as written: ${[...ids].join(', ')}.`)
  return scores
}

const GIFTS_IN_PROMPT = 30

export async function draftGiftScores(client: ChatBackend, subject: AiLoreSubject, catalog: readonly GiftItem[], opts: StageOpts): Promise<DraftExtras> {
  const shown = catalog.slice(0, GIFTS_IN_PROMPT)
  const template = JSON.stringify(Object.fromEntries(shown.map((g) => [g.id, 0])))
  const giftScores = await askJson(client, subject, opts, {
    label: 'Draft gift scores',
    maxLength: Math.max(300, shown.length * 14),
    // The model invents gifts when asked for a free-form map, so it is handed the keys to fill in.
    instructions: [
      'Score how much this character would like each of these gifts, from -2 (they dislike it) through 0 (indifferent) to 3 (a favorite). These are the only gifts that exist, so if none suit the character well, score the closest ones anyway.',
      'Gifts:',
      ...shown.map((g) => `- ${g.id}: ${g.name}${g.tags?.length ? ` (${g.tags.join(', ')})` : ''}`),
      'Output ONLY this JSON object with the number changed for about 3 to 5 gifts they like (1 to 3) and 1 to 3 they dislike (-1 or -2), and every other gift left at 0. Do not add, rename or remove keys. No markdown, no commentary.',
      template,
    ].join('\n'),
    parse: (o) => parseGiftScores(o, shown),
  })
  return { giftPreferences: giftScores }
}

// ---- Weekly routine, birthday, outreach ----

const STATUSES: readonly PresenceStatus[] = ['available', 'busy', 'sleeping', 'traveling']
const OUTREACH: readonly OutreachFrequency[] = ['never', 'rare', 'normal', 'eager']
const MAX_SLOTS = 8

export function parseRoutine(o: Record<string, unknown>): DraftExtras {
  const seen = new Set<string>()
  const schedule: ScheduleEntry[] = []
  for (const s of records(o.schedule)) {
    const phase = oneOf(PHASES, s.phase)
    const status = oneOf(STATUSES, s.status)
    const activity = text(s.activity)
    if (!phase || !status || !activity) continue
    const named = (Array.isArray(s.days) ? s.days : []).map((d) => text(d).toLowerCase())
    const days = WEEKDAYS.filter((d) => named.includes(d))
    const key = `${phase}|${days.join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    schedule.push({ id: newId(), phase, status, activity, ...(text(s.location) ? { location: text(s.location) } : {}), ...(days.length ? { days } : {}) })
    if (schedule.length === MAX_SLOTS) break
  }
  const season = SEASONS.findIndex((x) => x === text(o.birthdaySeason).toLowerCase().replace('fall', 'autumn'))
  const day = Math.round(Number(o.birthdayDay))
  const birthday = season >= 0 && day >= 1 && day <= DAYS_PER_SEASON ? season * DAYS_PER_SEASON + day - 1 : undefined
  const frequency = oneOf(OUTREACH, o.outreach)
  if (!schedule.length && birthday === undefined && (!frequency || frequency === 'never')) throw new Rejected('It had no usable schedule, birthday or texting habit.')
  return {
    ...(schedule.length ? { schedule } : {}),
    ...(birthday !== undefined ? { birthday } : {}),
    ...(frequency && frequency !== 'never' ? { outreach: { frequency } } : {}),
  }
}

export function draftRoutine(client: ChatBackend, subject: AiLoreSubject, opts: StageOpts): Promise<DraftExtras> {
  return askJson(client, subject, opts, {
    label: 'Draft routine',
    maxLength: 600,
    instructions: [
      'Output ONLY a minified JSON object with exactly these keys, in this order:',
      '"birthdaySeason": "spring" or "summer" or "autumn" or "winter".',
      '"birthdayDay": an integer from 1 to 28.',
      '"outreach": how often they text {{user}} first without being asked, judged from their personality: "never", "rare", "normal" or "eager".',
      '"schedule": array of 4-7 objects {"phase": "morning" or "afternoon" or "evening" or "night", "status": "available" or "busy" or "sleeping" or "traveling", "activity": string, "location": string, "days": array}, and nothing after it. This is their ordinary week. Cover all four phases for a normal day with "days": [], include when they sleep, and add a day-specific slot (days like ["saturday","sunday"]) where the week differs. Use their job and the places named above.',
      'Plain, concrete language. No markdown, no commentary.',
    ].join('\n'),
    parse: parseRoutine,
  })
}

// ---- Persona engine settings (the engine itself stays off) ----

const asNumber = (v: unknown) => (typeof v === 'number' ? v : Number.parseFloat(text(v)))

/** The live persona engine's lists and dials. It is always switched off and human: the user turns it on in the editor. */
export function parseDrive(o: Record<string, unknown>): DraftExtras {
  const chaos = asNumber(o.chaosBase)
  const energy = asNumber(o.energyBase)
  const drive: DriveConfig = {
    ...DEFAULT_DRIVE_CONFIG,
    enabled: false,
    human: true,
    // A model that writes 12 for "12%" is understood.
    chaosBase: Number.isFinite(chaos) ? Math.min(0.4, Math.max(0, chaos > 1 ? chaos / 100 : chaos)) : DEFAULT_DRIVE_CONFIG.chaosBase,
    energyBase: Number.isFinite(energy) ? Math.min(10, Math.max(0, Math.round(energy))) : DEFAULT_DRIVE_CONFIG.energyBase,
    fixations: words(o.fixations, 5),
    loves: words(o.loves, 5),
    boredBy: words(o.boredBy, 5),
    motifs: words(o.motifs, 4),
  }
  if (!drive.fixations.length && !drive.loves.length && !drive.boredBy.length) throw new Rejected('It had no fixations, loves or bored-by topics.')
  return { drive }
}

export function draftDrive(client: ChatBackend, subject: AiLoreSubject, opts: StageOpts): Promise<DraftExtras> {
  return askJson(client, subject, opts, {
    label: 'Draft persona settings',
    maxLength: 500,
    instructions: [
      'Output ONLY a minified JSON object with exactly these keys, in this order:',
      '"chaosBase": a number from 0.05 to 0.3, how often a reply gets a sudden random impulse (0.05 steady and predictable, 0.3 wildly unpredictable).',
      '"energyBase": an integer from 0 to 10, their resting energy (2 drowsy, 5 even, 8 bubbly).',
      '"fixations": array of 3-5 short strings, things they get stuck on one at a time (for a baker: "the proving drawer that never behaves").',
      '"loves": array of 3-5 short strings, topics that light them up.',
      '"boredBy": array of 3-5 short strings, topics that bore them.',
      '"motifs": array of 2-4 short strings, signature lines or running jokes they keep coming back to.',
      'Make every entry specific to this character and their world, not a generic hobby. Plain language. No markdown, no commentary.',
    ].join('\n'),
    parse: parseDrive,
  })
}

// ---- Intimacy settings ----

const INTIMACY_KEYS = ['explicitVoiceNote', 'sensitiveRegions', 'unresponsiveRegions', 'likedKinks', 'dislikedKinks']

/** Values from a fixed list only, in the model's order, without repeats. */
function pickAll<T extends string>(allowed: readonly T[], v: unknown, max: number): T[] {
  const out: T[] = []
  for (const raw of Array.isArray(v) ? v : []) {
    const found = allowed.find((a) => a === text(raw).toLowerCase().replace(/[\s-]+/g, '_'))
    if (found && !out.includes(found)) out.push(found)
    if (out.length === max) break
  }
  return out
}

/** Leaves out anything already placed in one of the other lists. */
const without = <T extends string>(list: T[], ...others: readonly string[][]) => list.filter((x) => !others.some((o) => o.includes(x)))

// ---- Age check and stated limits ----

/** Singular forms people write for a region, besides its own name. */
const REGION_ALIASES: Partial<Record<(typeof BODY_REGIONS)[number], string>> = { feet: 'foot', hands: 'hand', thighs: 'thigh', shoulders: 'shoulder', ears: 'ear', lips: 'lip', hips: 'hip' }
const phrase = (id: string) => new RegExp(`\\b${id.replace(/_/g, '[ _-]')}\\b`, 'i')

/** Limits the creator wrote down. shortcut: only the clause after "hard limits", "off-limits" or "no touching" counts, so loosely worded limits are missed; the user can add them in the editor. */
function statedLimits(stated: string): { regions: (typeof BODY_REGIONS)[number][]; kinks: string[] } {
  const clauses = [...stated.matchAll(/(?:hard limits?|off[- ]?limits?|limits?:|no touching|never touch(?:ed|ing)?|don'?t touch|do not touch)([^.!?\n]*)/gi)].map((m) => m[1])
  const regions = BODY_REGIONS.filter((r) => clauses.some((c) => phrase(r).test(c) || (REGION_ALIASES[r] && phrase(REGION_ALIASES[r]).test(c))))
  const kinks = BUILT_IN_KINKS.filter((k) => clauses.some((c) => phrase(k).test(c)))
  return { regions, kinks }
}

/**
 * Whatever is neutral is left out. `stated` is the creator's own wording (brief and boundaries): hard limits come from it and nowhere else,
 * and a limit it states wins over anything the model liked or disliked.
 */
export function parseIntimacy(o: Record<string, unknown>, stated: string): DraftExtras {
  if (!INTIMACY_KEYS.some((k) => k in o)) throw new Rejected('It had none of the requested keys.')
  const limits = statedLimits(stated)
  const disliked = without(pickAll(BUILT_IN_KINKS, o.dislikedKinks, 3), limits.kinks)
  const liked = without(pickAll(BUILT_IN_KINKS, o.likedKinks, 5), disliked, limits.kinks)
  const sensitive = without(pickAll(BODY_REGIONS, o.sensitiveRegions, 4), limits.regions)
  const unresponsive = without(pickAll(BODY_REGIONS, o.unresponsiveRegions, 3), sensitive, limits.regions)

  const sensitivity: NonNullable<TouchProfile['sensitivity']> = {}
  for (const r of sensitive) sensitivity[r] = 3
  for (const r of unresponsive) sensitivity[r] = 0
  const valence: NonNullable<KinkProfile['valence']> = {}
  for (const k of liked) valence[k] = 2
  for (const k of disliked) valence[k] = -1

  const touchProfile: TouchProfile = {
    ...(Object.keys(sensitivity).length ? { sensitivity } : {}),
    ...(limits.regions.length ? { offLimits: limits.regions } : {}),
  }
  const kinkProfile: KinkProfile = {
    ...(Object.keys(valence).length ? { valence } : {}),
    ...(limits.kinks.length ? { hardLimits: limits.kinks } : {}),
  }
  const note = text(o.explicitVoiceNote).slice(0, 400)
  return {
    ...(Object.keys(touchProfile).length ? { touchProfile } : {}),
    ...(Object.keys(kinkProfile).length ? { kinkProfile } : {}),
    ...(note ? { explicitVoiceNote: note } : {}),
  }
}

/** `stated` is what the creator wrote (brief and boundaries); it is the only source of hard limits. */
export function draftIntimacy(client: ChatBackend, subject: AiLoreSubject, stated: string, opts: StageOpts): Promise<DraftExtras> {
  return askJson(client, subject, opts, {
    label: 'Draft intimacy settings',
    maxLength: 500,
    instructions: [
      'This is for the mature-content settings of a roleplay app. Output ONLY a minified JSON object with exactly these keys, in this order:',
      '"explicitVoiceNote": string, one or two sentences on how this character\'s voice holds up, cracks or changes under strain in an intimate scene (for example "Goes quieter and shorter, not louder.").',
      `"sensitiveRegions": array of 0-4 values chosen only from [${BODY_REGIONS.join(', ')}], where touch affects them strongly.`,
      '"unresponsiveRegions": array of 0-3 values chosen only from that same list, where touch does little for them.',
      `"likedKinks": array of 0-5 values chosen only from [${BUILT_IN_KINKS.join(', ')}], what they enjoy.`,
      '"dislikedKinks": array of 0-3 values chosen only from that same list, what they dislike.',
      'Base it on their personality and the details above, and leave an array empty rather than guessing. Plain language. No markdown, no commentary.',
    ].join('\n'),
    parse: (o) => parseIntimacy(o, stated),
  })
}