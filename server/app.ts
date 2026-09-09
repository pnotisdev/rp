import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  characterStore,
  chatFactStore,
  chatStore,
  db,
  assistantThreadStore,
  instructTemplateStore,
  messageStore,
  newId,
  objectiveStore,
  personaStore,
  presetStore,
  relationshipEventStore,
  themeStore,
  worldInfoBookStore,
  worldStore,
  avatarsDir,
} from './db.ts'
import { removeAvatar, resolveAvatar, resolveAvatarMap, resolveAvatarMapVariants, resolveWorldBackgroundsNightMap, resolveWorldMusicMap } from './avatars.ts'
import { encodeTokens, tokenizerForModel } from './novelaiTokenizer.ts'
import { originGuard } from './originCheck.ts'
import { openMayhemRouter } from './openMayhem.ts'

/**
 * Express app: REST routes for characters, personas, chats/messages, world info books, sampler
 * presets, themes, instruct templates, worlds, objectives, relationship events, chat facts, full
 * backup/restore, and the NovelAI tokenize endpoint — plus the request-body normalization helpers
 * that validate client-authored JSON before it's persisted.
 */
export const app = express()

// Rejects a request whose Origin is another website; any loopback origin is allowed. See originCheck.ts.
app.use(originGuard)

// Raised generously (a bulk sprite upload easily clears 25MB) — local-only app, no untrusted-request concern.
app.use(express.json({ limit: '150mb' }))
app.use('/api/openmayhem', openMayhemRouter())
app.use('/avatars', express.static(avatarsDir))

function notFound(res: express.Response) {
  res.status(404).json({ error: 'Not found' })
}

function normalizeCustomExpressions(raw: unknown) {
  if (!Array.isArray(raw)) return undefined
  const entries = raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      id: typeof e.id === 'string' ? e.id.trim() : '',
      label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : 'Custom',
    }))
    .filter((e) => !!e.id)
  return entries.length ? entries : undefined
}

/** A character's wardrobe states (`src/lib/vn/outfits.ts`); `id` is slug-validated since it becomes half of a sprite filename, and `base` is reserved. */
function normalizeOutfits(raw: unknown) {
  if (!Array.isArray(raw)) return undefined
  const entries = raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      id: typeof e.id === 'string' ? e.id.trim().toLowerCase() : '',
      label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : 'Outfit',
      unlockAffection: Number.isFinite(Number(e.unlockAffection))
        ? Math.max(0, Math.min(100, Math.round(Number(e.unlockAffection))))
        : undefined,
      requiredFlags: normalizeStringArray(e.requiredFlags),
      manualOnly: e.manualOnly === true,
      intimate: e.intimate === true,
    }))
    .filter((e) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(e.id) && e.id !== 'base' && !e.id.includes('--'))
  // A duplicate id would make two outfits fight over the same sprite keys.
  const seen = new Set<string>()
  const unique = entries.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
  return unique.length ? unique : undefined
}

/** A world's own content rating (`WorldCard.intimacyLevel`); an unrecognized value falls back to "inherit the global setting". */
function normalizeIntimacyLevel(raw: unknown) {
  return raw === 'default' || raw === 'fade_to_black' || raw === 'suggestive' || raw === 'explicit' ? raw : undefined
}

/** `null` means "inherit the global setting" and must map to `undefined` here, since `'intimacyLevel' in req.body` needs the key present to clear it. */
function normalizeClearableIntimacyLevel(raw: unknown) {
  return raw === null ? undefined : normalizeIntimacyLevel(raw)
}

/** A world's author-defined triggers (`src/lib/world/triggers.ts`); malformed rules and unknown condition/action kinds are dropped rather than stored dead. */
function normalizeTriggers(raw: unknown) {
  if (!Array.isArray(raw)) return undefined
  const STATS = new Set(['affection', 'warmth', 'trust', 'chemistry', 'comfort', 'respect', 'curiosity', 'tension'])
  const COMMITMENTS = new Set(['none', 'dating', 'exclusive', 'living_together', 'married'])
  const num = (v: unknown, lo: number, hi: number) =>
    Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : null
  const str = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

  const condition = (c: unknown) => {
    if (!c || typeof c !== 'object') return null
    const o = c as Record<string, unknown>
    if ((o.kind === 'stat_at_least' || o.kind === 'stat_below') && STATS.has(String(o.stat))) {
      const value = num(o.value, 0, 100)
      return value === null ? null : { kind: o.kind, stat: o.stat, value }
    }
    if (o.kind === 'flag_set') {
      const flag = str(o.flag, 60)
      return flag ? { kind: 'flag_set', flag } : null
    }
    if (o.kind === 'commitment_at_least' && COMMITMENTS.has(String(o.status))) {
      return { kind: 'commitment_at_least', status: o.status }
    }
    if (o.kind === 'day_at_least') {
      const day = num(o.day, 0, 100000)
      return day === null ? null : { kind: 'day_at_least', day }
    }
    if (o.kind === 'trigger_fired') {
      const triggerId = str(o.triggerId, 80)
      return triggerId ? { kind: 'trigger_fired', triggerId } : null
    }
    return null
  }

  const action = (a: unknown) => {
    if (!a || typeof a !== 'object') return null
    const o = a as Record<string, unknown>
    if (o.kind === 'set_flag') {
      const flag = str(o.flag, 60)
      return flag ? { kind: 'set_flag', flag } : null
    }
    if (o.kind === 'remember' || o.kind === 'notify' || o.kind === 'style_guidance') {
      const text = str(o.text, 300)
      return text ? { kind: o.kind, text } : null
    }
    if (o.kind === 'social_reaction') {
      const topic = str(o.topic, 200)
      return topic ? { kind: 'social_reaction', topic } : null
    }
    if (o.kind === 'start_scene') {
      const title = str(o.title, 120)
      const objectiveTitle = str(o.objectiveTitle, 120)
      if (!title || !objectiveTitle) return null
      const description = str(o.description, 500) ?? ''
      const objectiveDescription = str(o.objectiveDescription, 500)
      return { kind: 'start_scene', title, description, objectiveTitle, ...(objectiveDescription ? { objectiveDescription } : {}) }
    }
    return null
  }

  const seen = new Set<string>()
  const entries = raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({
      id: typeof t.id === 'string' ? t.id.trim() : '',
      label: str(t.label, 80) ?? 'Trigger',
      enabled: t.enabled !== false,
      repeatable: t.repeatable === true,
      when: Array.isArray(t.when) ? t.when.map(condition).filter(Boolean) : [],
      then: Array.isArray(t.then) ? t.then.map(action).filter(Boolean) : [],
    }))
    // A rule with no surviving conditions or actions is broken, not disabled — drop it.
    .filter((t) => !!t.id && t.when.length > 0 && t.then.length > 0)
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
  return entries.length ? entries : undefined
}

/** A world's own scene locations beyond the 12 built-in defaults — same shape/validation as `normalizeCustomExpressions` above. */
function normalizeCustomBackgrounds(raw: unknown) {
  if (!Array.isArray(raw)) return undefined
  const entries = raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      id: typeof e.id === 'string' ? e.id.trim() : '',
      label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : 'Custom',
    }))
    .filter((e) => !!e.id)
  return entries.length ? entries : undefined
}

const RELATIONSHIP_STAGES = new Set(['near_strangers', 'acquaintances', 'warming_up', 'getting_close', 'close', 'sweethearts'])

/** Item 10's `GalleryEntry.autoTrigger` — a discriminated union, so validation checks `kind` before trusting the field it implies. */
function normalizeCgTrigger(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return undefined
  const t = raw as Record<string, unknown>
  if (t.kind === 'intimacyPhase' && (t.phase === 'building' || t.phase === 'peak')) return { kind: 'intimacyPhase', phase: t.phase }
  if (t.kind === 'catalogAction' && typeof t.optionId === 'string' && t.optionId.trim()) return { kind: 'catalogAction', optionId: t.optionId.trim() }
  if (t.kind === 'sceneFlag' && typeof t.flag === 'string' && t.flag.trim()) return { kind: 'sceneFlag', flag: t.flag.trim() }
  if (t.kind === 'relationshipStage' && RELATIONSHIP_STAGES.has(t.stage as string)) return { kind: 'relationshipStage', stage: t.stage }
  return undefined
}

function normalizeGalleryEntries(id: string, galleryRaw: unknown) {
  if (!Array.isArray(galleryRaw)) return []
  const mapInput: Record<string, string> = {}
  const variantsInput: Record<string, unknown> = {}
  const entries = galleryRaw
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
    .map((g, i) => {
      const gid = typeof g.id === 'string' && g.id.trim() ? g.id.trim() : `cg-${i}`
      const imageUrl = typeof g.imageUrl === 'string' ? g.imageUrl : ''
      if (imageUrl) mapInput[gid] = imageUrl
      if (Array.isArray(g.variants)) variantsInput[gid] = g.variants
      return {
        id: gid,
        title: typeof g.title === 'string' ? g.title : `CG ${i + 1}`,
        imageUrl,
        unlockAffection: Number(g.unlockAffection ?? 0),
        unlockHint: typeof g.unlockHint === 'string' ? g.unlockHint : undefined,
        requiredFlags: Array.isArray(g.requiredFlags)
          ? g.requiredFlags.filter((f): f is string => typeof f === 'string' && !!f.trim())
          : undefined,
        isEnding: g.isEnding === true ? true : undefined,
        autoTrigger: normalizeCgTrigger(g.autoTrigger),
      }
    })
  const resolvedMap = resolveAvatarMap('characters', 'gallery', id, mapInput) ?? {}
  const resolvedVariants = resolveAvatarMapVariants('characters', 'gallery', id, variantsInput) ?? {}
  // Entries with no imageUrl yet are kept, not dropped — GalleryView renders that safely as a placeholder.
  return entries.map((g) => ({
    ...g,
    imageUrl: resolvedMap[g.id] || g.imageUrl,
    variants: resolvedVariants[g.id]?.length ? resolvedVariants[g.id] : undefined,
  }))
}

const GIFT_RARITIES = new Set(['common', 'uncommon', 'rare', 'epic'])

function normalizeGiftItems(raw: unknown) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
    .map((g, i) => ({
      id: typeof g.id === 'string' && g.id.trim() ? g.id.trim() : `gift-${i}`,
      name: typeof g.name === 'string' && g.name.trim() ? g.name.trim() : `Gift ${i + 1}`,
      rarity: GIFT_RARITIES.has(g.rarity as string) ? (g.rarity as string) : 'common',
      price: Math.max(0, Number(g.price) || 0),
      tags: Array.isArray(g.tags) ? g.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()) : [],
    }))
}

const RELATIONSHIP_DELTA_KEYS = new Set(['affection', 'trust', 'chemistry', 'comfort', 'respect', 'curiosity', 'tension'])
/** Flags always available regardless of world; a world's `customSceneFlags` extend this set (see `normalizeItemDefs`'s `allowedFlags`). */
const DEFAULT_SCENE_FLAGS = new Set(['first_date', 'confession', 'jealousy', 'promise'])

/** Drops any entry missing a label; empty descriptions are allowed. */
function normalizeCustomSceneFlags(raw: unknown): { id: string; label: string; description: string }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f, i) => ({
      id: typeof f.id === 'string' && f.id.trim() ? f.id.trim() : `flag-${i}`,
      label: typeof f.label === 'string' ? f.label.trim() : '',
      description: typeof f.description === 'string' ? f.description.trim() : '',
    }))
    .filter((f) => !!f.label)
}

/** Validates an item's effect union; a "Set scene flag" referencing an id outside `allowedFlags` falls through to the default relationship-nudge branch. */
function normalizeItemEffect(
  raw: unknown,
  allowedFlags: Set<string>,
): { kind: string; dimension?: string; flag?: string; amount?: number } {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (obj.kind === 'flag' && allowedFlags.has(obj.flag as string)) {
    return { kind: 'flag', flag: obj.flag as string }
  }
  if (obj.kind === 'currency') {
    return { kind: 'currency', amount: Math.max(0, Number(obj.amount) || 0) }
  }
  const dimension = RELATIONSHIP_DELTA_KEYS.has(obj.dimension as string) ? (obj.dimension as string) : 'affection'
  const amount = Number(obj.amount)
  // Round rather than reject a fractional amount, so it isn't silently replaced with a fixed 1.
  return {
    kind: 'relationship',
    dimension,
    amount: Number.isFinite(amount) ? Math.max(-10, Math.min(10, Math.round(amount))) : 1,
  }
}

function normalizeItemDefs(raw: unknown, allowedFlags: Set<string>) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map((i, idx) => ({
      id: typeof i.id === 'string' && i.id.trim() ? i.id.trim() : `item-${idx}`,
      name: typeof i.name === 'string' && i.name.trim() ? i.name.trim() : `Item ${idx + 1}`,
      rarity: GIFT_RARITIES.has(i.rarity as string) ? (i.rarity as string) : 'common',
      price: Math.max(0, Number(i.price) || 0),
      tags: Array.isArray(i.tags) ? i.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()) : [],
      description: typeof i.description === 'string' ? i.description : undefined,
      effect: normalizeItemEffect(i.effect, allowedFlags),
    }))
}

/** A deduped array of non-empty string ids, always an array (never undefined) — for World Info book scoping. */
function normalizeIdArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim()))]
}

/** A trimmed, non-empty-string array or undefined — used for the free-text `giftLikes`/`giftDislikes` lists. */
function normalizeStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const cleaned = raw.filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim())
  return cleaned.length > 0 ? cleaned : undefined
}

/** Drops any entry missing a name — the one field a connection is meaningless without. */
function normalizeSocialConnections(raw: unknown): { id: string; name: string; relation: string; notes?: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const entries = raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c, i) => ({
      id: typeof c.id === 'string' && c.id.trim() ? c.id.trim() : `conn-${i}`,
      name: typeof c.name === 'string' ? c.name.trim() : '',
      relation: typeof c.relation === 'string' ? c.relation.trim() : '',
      notes: typeof c.notes === 'string' && c.notes.trim() ? c.notes.trim() : undefined,
    }))
    .filter((c) => !!c.name)
  return entries.length > 0 ? entries : undefined
}

/** Drops any entry missing `then` — the one field a rule is meaningless without. */
function normalizeBehavioralRules(raw: unknown): { id: string; kind: 'when_then' | 'never'; when?: string; then: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const entries = raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r, i) => ({
      id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : `rule-${i}`,
      kind: r.kind === 'never' ? ('never' as const) : ('when_then' as const),
      when: typeof r.when === 'string' && r.when.trim() ? r.when.trim() : undefined,
      then: typeof r.then === 'string' ? r.then.trim() : '',
    }))
    .filter((r) => !!r.then)
  return entries.length > 0 ? entries : undefined
}

/** `Character.touchProfile`: a per-region 0-3 score map plus limit lists. Unknown regions are the client's
 *  problem to filter; this only enforces shape, so an imported card can't corrupt the record. */
function normalizeTouchProfile(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const numberMap = (value: unknown): Record<string, number> | undefined => {
    if (!value || typeof value !== 'object') return undefined
    const out: Record<string, number> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
    }
    return Object.keys(out).length ? out : undefined
  }
  const profile: Record<string, unknown> = {}
  const sensitivity = numberMap(src.sensitivity)
  if (sensitivity) profile.sensitivity = sensitivity
  const offLimits = normalizeStringArray(src.offLimits)
  if (offLimits) profile.offLimits = offLimits
  const gated = numberMap(src.gated)
  if (gated) profile.gated = gated
  return Object.keys(profile).length ? profile : undefined
}

/** `Character.kinkProfile`: valence scores plus hard limits. Same shape-only contract as above. */
function normalizeKinkProfile(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const profile: Record<string, unknown> = {}
  if (src.valence && typeof src.valence === 'object') {
    const valence: Record<string, number> = {}
    for (const [kink, v] of Object.entries(src.valence as Record<string, unknown>)) {
      if (typeof v === 'number' && v >= -2 && v <= 2) valence[kink] = Math.round(v)
    }
    if (Object.keys(valence).length) profile.valence = valence
  }
  const hardLimits = normalizeStringArray(src.hardLimits)
  if (hardLimits) profile.hardLimits = hardLimits
  return Object.keys(profile).length ? profile : undefined
}

/** `Character.voiceFingerprint`: trims free-typed speech-pattern fields, dropping empties. */
function normalizeVoiceFingerprint(
  raw: unknown,
): { verbalTics?: string[]; catchphrases?: string[]; dialectNotes?: string; sentenceRhythm?: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const result: { verbalTics?: string[]; catchphrases?: string[]; dialectNotes?: string; sentenceRhythm?: string } = {}
  const verbalTics = normalizeStringArray(obj.verbalTics)
  const catchphrases = normalizeStringArray(obj.catchphrases)
  if (verbalTics) result.verbalTics = verbalTics
  if (catchphrases) result.catchphrases = catchphrases
  if (typeof obj.dialectNotes === 'string' && obj.dialectNotes.trim()) result.dialectNotes = obj.dialectNotes.trim()
  if (typeof obj.sentenceRhythm === 'string' && obj.sentenceRhythm.trim()) result.sentenceRhythm = obj.sentenceRhythm.trim()
  return Object.keys(result).length > 0 ? result : undefined
}

const OUTREACH_FREQUENCIES = new Set(['never', 'rare', 'normal', 'eager'])

/** Rejects an unrecognized frequency rather than letting it fall through as `undefined`, which would make the character permanently eligible. */
function normalizeOutreach(raw: unknown): { frequency: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const frequency = (raw as Record<string, unknown>).frequency
  return typeof frequency === 'string' && OUTREACH_FREQUENCIES.has(frequency) ? { frequency } : undefined
}

/** `Character.birthday` — a day-of-year (world/calendar.ts's 112-day year), clamped/rounded rather
 *  than rejected outright so a stray out-of-range value from the client still lands somewhere sane. */
function normalizeDayOfYear(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(111, Math.round(raw))) : undefined
}

const REPLY_LENGTHS = new Set(['auto', 'brief', 'moderate', 'detailed'])

/** 'auto' and unset both mean "measure the card"; only the three explicit bands are stored. */
function normalizeReplyLength(raw: unknown): string | undefined {
  return typeof raw === 'string' && REPLY_LENGTHS.has(raw) && raw !== 'auto' ? raw : undefined
}

function normalizeRelationshipThresholds(raw: unknown) {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const result: Record<string, number> = {}
  for (const stage of ['acquaintances', 'warming_up', 'getting_close', 'close', 'sweethearts']) {
    if (typeof obj[stage] === 'number') result[stage] = Math.max(0, Math.min(100, obj[stage] as number))
  }
  return Object.keys(result).length > 0 ? result : undefined
}

// ---- Characters ----

app.get('/api/characters', (_req, res) => {
  res.json(characterStore.list({ orderBy: 'updatedAt DESC' }))
})

app.get('/api/characters/:id', (req, res) => {
  const row = characterStore.get(req.params.id)
  if (!row) return notFound(res)
  res.json(row)
})

app.post('/api/characters', (req, res) => {
  const now = Date.now()
  const id = newId()
  const avatarDataUrl = resolveAvatar('characters', id, req.body.avatarDataUrl)
  const sprites = resolveAvatarMap('characters', 'sprites', id, req.body.sprites)
  const spriteVariants = resolveAvatarMapVariants('characters', 'sprites', id, req.body.spriteVariants)
  const gallery = normalizeGalleryEntries(id, req.body.gallery)
  const created = characterStore.insert({
    id,
    card: req.body.card,
    avatarDataUrl,
    sprites,
    spriteVariants,
    spriteUnlocks: req.body.spriteUnlocks ?? {},
    outfits: normalizeOutfits(req.body.outfits),
    customExpressions: normalizeCustomExpressions(req.body.customExpressions),
    giftPreferences: req.body.giftPreferences ?? {},
    giftLikes: normalizeStringArray(req.body.giftLikes),
    giftDislikes: normalizeStringArray(req.body.giftDislikes),
    loveLanguage: typeof req.body.loveLanguage === 'string' ? req.body.loveLanguage : undefined,
    explicitVoiceNote: typeof req.body.explicitVoiceNote === 'string' ? req.body.explicitVoiceNote : undefined,
    gallery,
    relationshipStarters: req.body.relationshipStarters ?? [],
    voice: req.body.voice ?? undefined,
    voiceFingerprint: normalizeVoiceFingerprint(req.body.voiceFingerprint),
    sfxWords: normalizeStringArray(req.body.sfxWords),
    instructTemplateId: typeof req.body.instructTemplateId === 'string' ? req.body.instructTemplateId : undefined,
    replyLength: normalizeReplyLength(req.body.replyLength),
    weatherPreferences: req.body.weatherPreferences ?? undefined,
    schedule: Array.isArray(req.body.schedule) ? req.body.schedule : undefined,
    worldId: req.body.worldId || undefined,
    likes: normalizeStringArray(req.body.likes),
    goals: normalizeStringArray(req.body.goals),
    boundaries: normalizeStringArray(req.body.boundaries),
    socialConnections: normalizeSocialConnections(req.body.socialConnections),
    behavioralRules: normalizeBehavioralRules(req.body.behavioralRules),
    touchProfile: normalizeTouchProfile(req.body.touchProfile),
    kinkProfile: normalizeKinkProfile(req.body.kinkProfile),
    occupation: typeof req.body.occupation === 'string' ? req.body.occupation : undefined,
    workplace: typeof req.body.workplace === 'string' ? req.body.workplace : undefined,
    homeLocation: typeof req.body.homeLocation === 'string' ? req.body.homeLocation : undefined,
    birthday: normalizeDayOfYear(req.body.birthday),
    frequentedLocations: normalizeStringArray(req.body.frequentedLocations),
    dateModeOptOut: req.body.dateModeOptOut === true,
    outreach: normalizeOutreach(req.body.outreach),
    createdAt: now,
    updatedAt: now,
  })
  res.status(201).json(created)
})

app.put('/api/characters/:id', (req, res) => {
  const id = req.params.id
  if (!characterStore.get(id)) return notFound(res)
  const patch: Record<string, unknown> = { updatedAt: Date.now() }
  if ('card' in req.body) patch.card = req.body.card
  if ('worldId' in req.body) patch.worldId = req.body.worldId || undefined
  if ('avatarDataUrl' in req.body) patch.avatarDataUrl = resolveAvatar('characters', id, req.body.avatarDataUrl)
  if ('sprites' in req.body) patch.sprites = resolveAvatarMap('characters', 'sprites', id, req.body.sprites)
  if ('spriteVariants' in req.body) patch.spriteVariants = resolveAvatarMapVariants('characters', 'sprites', id, req.body.spriteVariants)
  if ('spriteUnlocks' in req.body) patch.spriteUnlocks = req.body.spriteUnlocks ?? {}
  if ('outfits' in req.body) patch.outfits = normalizeOutfits(req.body.outfits)
  if ('customExpressions' in req.body) patch.customExpressions = normalizeCustomExpressions(req.body.customExpressions)
  if ('giftPreferences' in req.body) patch.giftPreferences = req.body.giftPreferences ?? {}
  if ('giftLikes' in req.body) patch.giftLikes = normalizeStringArray(req.body.giftLikes)
  if ('giftDislikes' in req.body) patch.giftDislikes = normalizeStringArray(req.body.giftDislikes)
  if ('loveLanguage' in req.body) patch.loveLanguage = typeof req.body.loveLanguage === 'string' ? req.body.loveLanguage : undefined
  if ('explicitVoiceNote' in req.body) patch.explicitVoiceNote = typeof req.body.explicitVoiceNote === 'string' ? req.body.explicitVoiceNote : undefined
  if ('gallery' in req.body) patch.gallery = normalizeGalleryEntries(id, req.body.gallery)
  if ('relationshipStarters' in req.body) patch.relationshipStarters = req.body.relationshipStarters ?? []
  if ('voice' in req.body) patch.voice = req.body.voice ?? undefined
  if ('voiceFingerprint' in req.body) patch.voiceFingerprint = normalizeVoiceFingerprint(req.body.voiceFingerprint)
  if ('sfxWords' in req.body) patch.sfxWords = normalizeStringArray(req.body.sfxWords)
  if ('instructTemplateId' in req.body) patch.instructTemplateId = typeof req.body.instructTemplateId === 'string' ? req.body.instructTemplateId : undefined
  if ('replyLength' in req.body) patch.replyLength = normalizeReplyLength(req.body.replyLength)
  if ('weatherPreferences' in req.body) patch.weatherPreferences = req.body.weatherPreferences ?? undefined
  if ('schedule' in req.body) patch.schedule = Array.isArray(req.body.schedule) ? req.body.schedule : undefined
  if ('likes' in req.body) patch.likes = normalizeStringArray(req.body.likes)
  if ('goals' in req.body) patch.goals = normalizeStringArray(req.body.goals)
  if ('boundaries' in req.body) patch.boundaries = normalizeStringArray(req.body.boundaries)
  if ('socialConnections' in req.body) patch.socialConnections = normalizeSocialConnections(req.body.socialConnections)
  if ('behavioralRules' in req.body) patch.behavioralRules = normalizeBehavioralRules(req.body.behavioralRules)
  if ('touchProfile' in req.body) patch.touchProfile = normalizeTouchProfile(req.body.touchProfile)
  if ('kinkProfile' in req.body) patch.kinkProfile = normalizeKinkProfile(req.body.kinkProfile)
  if ('occupation' in req.body) patch.occupation = typeof req.body.occupation === 'string' ? req.body.occupation : undefined
  if ('workplace' in req.body) patch.workplace = typeof req.body.workplace === 'string' ? req.body.workplace : undefined
  if ('homeLocation' in req.body) patch.homeLocation = typeof req.body.homeLocation === 'string' ? req.body.homeLocation : undefined
  if ('birthday' in req.body) patch.birthday = normalizeDayOfYear(req.body.birthday)
  if ('frequentedLocations' in req.body) patch.frequentedLocations = normalizeStringArray(req.body.frequentedLocations)
  if ('dateModeOptOut' in req.body) patch.dateModeOptOut = req.body.dateModeOptOut === true
  if ('outreach' in req.body) patch.outreach = normalizeOutreach(req.body.outreach)
  const updated = characterStore.update(id, patch)
  res.json(updated)
})

app.delete('/api/characters/:id', (req, res) => {
  const characterId = req.params.id
  // The character is gone for good, so there's no useful "trash" state — purge its chats directly.
  const chats = chatStore.list({ where: 'characterId = ?', params: [characterId] })
  for (const chat of chats) purgeChat(chat.id as string)
  // A character can also appear as a group-chat participant (a full scan — `participants` isn't an
  // indexed column); drop the dangling id and any tracked relationship for it instead of deleting the chat.
  for (const chat of chatStore.list()) {
    const participants = chat.participants as string[] | undefined
    const participantRelationships = chat.participantRelationships as Record<string, unknown> | undefined
    const patch: Record<string, unknown> = {}
    if (participants?.includes(characterId)) patch.participants = participants.filter((id) => id !== characterId)
    if (participantRelationships && characterId in participantRelationships) {
      const { [characterId]: _dropped, ...rest } = participantRelationships
      patch.participantRelationships = rest
    }
    if (Object.keys(patch).length > 0) chatStore.update(chat.id as string, patch)
  }
  // Removes the whole per-character folder in one shot (avatar, sprites, gallery — see avatars.ts).
  removeAvatar('characters', characterId)
  characterStore.remove(characterId)
  res.status(204).end()
})

// ---- Personas ----

app.get('/api/personas', (_req, res) => {
  res.json(personaStore.list({ orderBy: 'createdAt' }))
})

app.get('/api/personas/:id', (req, res) => {
  const row = personaStore.get(req.params.id)
  if (!row) return notFound(res)
  res.json(row)
})

app.post('/api/personas', (req, res) => {
  const id = newId()
  const avatarDataUrl = resolveAvatar('personas', id, req.body.avatarDataUrl)
  const created = personaStore.insert({
    id,
    name: req.body.name,
    description: req.body.description,
    avatarDataUrl,
    createdAt: Date.now(),
  })
  res.status(201).json(created)
})

app.put('/api/personas/:id', (req, res) => {
  const id = req.params.id
  if (!personaStore.get(id)) return notFound(res)
  const patch: Record<string, unknown> = {}
  if ('name' in req.body) patch.name = req.body.name
  if ('description' in req.body) patch.description = req.body.description
  if ('avatarDataUrl' in req.body) patch.avatarDataUrl = resolveAvatar('personas', id, req.body.avatarDataUrl)
  const updated = personaStore.update(id, patch)
  res.json(updated)
})

app.delete('/api/personas/:id', (req, res) => {
  const personaId = req.params.id
  // `Chat.personaId` isn't indexed, so a full scan; clear dangling refs to avoid a silent 404 on load.
  for (const chat of chatStore.list()) {
    // Cleared to '' (not null/undefined) to stay a valid value of its required-string type.
    if (chat.personaId === personaId) chatStore.update(chat.id as string, { personaId: '' })
  }
  removeAvatar('personas', personaId)
  personaStore.remove(personaId)
  res.status(204).end()
})

// ---- Chats ----

// How long a deleted chat sits recoverable before `purgeExpiredTrash` purges it for real (called at server startup).
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/** Permanent cascading delete: messages/objectives/relationship events/facts, un-parents any fork, then the chat row. */
function purgeChat(chatId: string): void {
  for (const msg of messageStore.list({ where: 'chatId = ?', params: [chatId] })) messageStore.remove(msg.id as string)
  for (const o of objectiveStore.list({ where: 'chatId = ?', params: [chatId] })) objectiveStore.remove(o.id as string)
  for (const e of relationshipEventStore.list({ where: 'chatId = ?', params: [chatId] })) relationshipEventStore.remove(e.id as string)
  for (const f of chatFactStore.list({ where: 'chatId = ?', params: [chatId] })) chatFactStore.remove(f.id as string)
  // Un-parent any chat forked from this one (parentChatId isn't indexed, so a full scan).
  for (const chat of chatStore.list()) {
    if (chat.parentChatId !== chatId) continue
    chatStore.update(chat.id as string, { parentChatId: undefined, forkedFromMessageId: undefined })
  }
  chatStore.remove(chatId)
}

/** Called once at server startup — purges anything that's been sitting in the trash past `TRASH_RETENTION_MS`. */
export function purgeExpiredTrash(): void {
  const cutoff = Date.now() - TRASH_RETENTION_MS
  const expired = chatStore.list().filter((c) => typeof c.deletedAt === 'number' && c.deletedAt < cutoff)
  for (const chat of expired) purgeChat(chat.id as string)
  if (expired.length) console.log(`[rp-server] purged ${expired.length} chat(s) past the ${TRASH_RETENTION_MS / 86400000}-day trash retention window`)
}

app.get('/api/chats', (_req, res) => {
  res.json(chatStore.list({ orderBy: 'updatedAt DESC' }).filter((c) => !c.deletedAt))
})

// Registered before `/api/chats/:id`, or Express would match "trash" as an :id.
app.get('/api/chats/trash', (_req, res) => {
  const trashed = chatStore
    .list()
    .filter((c) => typeof c.deletedAt === 'number')
    .sort((a, b) => (b.deletedAt as number) - (a.deletedAt as number))
  res.json(trashed)
})

app.get('/api/chats/:id', (req, res) => {
  const row = chatStore.get(req.params.id)
  if (!row) return notFound(res)
  res.json(row)
})

app.get('/api/chats/:id/messages', (req, res) => {
  res.json(messageStore.list({ where: 'chatId = ?', params: [req.params.id], orderBy: 'createdAt' }))
})

app.post('/api/chats', (req, res) => {
  const now = Date.now()
  const created = chatStore.insert({
    id: newId(),
    characterId: req.body.characterId,
    participants: Array.isArray(req.body.participants) && req.body.participants.length ? req.body.participants : undefined,
    personaId: req.body.personaId ?? '',
    title: req.body.title,
    affection: Number(req.body.affection ?? 0),
    relationshipStats: req.body.relationshipStats ?? undefined,
    relationshipStage: req.body.relationshipStage ?? 'near_strangers',
    sceneFlags: Array.isArray(req.body.sceneFlags) ? req.body.sceneFlags : [],
    giftCoins: Number(req.body.giftCoins ?? 0),
    giftInventory: req.body.giftInventory ?? {},
    giftsGiven: req.body.giftsGiven ?? {},
    unlockedGalleryIds: Array.isArray(req.body.unlockedGalleryIds) ? req.body.unlockedGalleryIds : [],
    activeEvent: req.body.activeEvent,
    summary: req.body.summary || undefined,
    assistOverrides: req.body.assistOverrides ?? undefined,
    mode: req.body.mode ?? undefined,
    createdAt: now,
    updatedAt: now,
  })
  res.status(201).json(created)
})

app.put('/api/chats/:id', (req, res) => {
  // skipTouch: 10f's outreach tick writes lastOutreachCheckedAt on every chat it evaluates,
  // whether or not a message actually landed — without this, that bookkeeping-only write would
  // bump updatedAt and reorder ChatsPanel (sorted by updatedAt DESC) for a chat nothing happened in.
  const { characterId: _c, id: _id, createdAt: _ca, skipTouch, ...patch } = req.body
  const updated = chatStore.update(req.params.id, {
    ...patch,
    ...(skipTouch ? {} : { updatedAt: Date.now() }),
  })
  if (!updated) return notFound(res)
  res.json(updated)
})

// Forks a chat at a given message (or its latest), copying relationship/gift/gallery state and the transcript up to that point.
app.post('/api/chats/:id/fork', (req, res) => {
  const sourceChatId = req.params.id
  const source = chatStore.get(sourceChatId)
  if (!source) return notFound(res)

  const allMessages = messageStore.list({ where: 'chatId = ?', params: [sourceChatId], orderBy: 'createdAt' })
  let cutoff = allMessages.length
  if (req.body.messageId) {
    const idx = allMessages.findIndex((m) => m.id === req.body.messageId)
    if (idx === -1) return res.status(400).json({ error: 'Message not found in this chat' })
    cutoff = idx + 1
  }
  const keptMessages = allMessages.slice(0, cutoff)
  const forkedFromMessageId = keptMessages[keptMessages.length - 1]?.id as string | undefined

  const now = Date.now()
  const newChatId = newId()
  // worldInfoState (turn-numbered bookkeeping) and rapport (a live-date scene read) don't carry over to a fork.
  const { id: _id, createdAt: _ca, updatedAt: _ua, title, worldInfoState: _wis, rapport: _rap, ...rest } = source
  const forkedChat = chatStore.insert({
    ...rest,
    id: newChatId,
    title: `${title} (fork)`,
    parentChatId: sourceChatId,
    forkedFromMessageId,
    createdAt: now,
    updatedAt: now,
  })

  for (const m of keptMessages) {
    const { id: _mid, ...mRest } = m
    messageStore.insert({ ...mRest, id: newId(), chatId: newChatId })
  }

  const activeObjective = objectiveStore.list({ where: 'chatId = ? AND status = ?', params: [sourceChatId, 'active'] })[0]
  if (activeObjective) {
    const { id: _oid, chatId: _ocid, createdAt: _oca, updatedAt: _oua, ...oRest } = activeObjective
    objectiveStore.insert({ ...oRest, id: newId(), chatId: newChatId, createdAt: now, updatedAt: now })
  }

  // Only events up to the fork point actually happened in this branch's shared past.
  const cutoffCreatedAt = keptMessages[keptMessages.length - 1]?.createdAt as number | undefined
  const sourceEvents = relationshipEventStore.list({ where: 'chatId = ?', params: [sourceChatId], orderBy: 'createdAt' })
  for (const e of sourceEvents) {
    if (cutoffCreatedAt !== undefined && (e.createdAt as number) > cutoffCreatedAt) continue
    const { id: _eid, chatId: _ecid, ...eRest } = e
    relationshipEventStore.insert({ ...eRest, id: newId(), chatId: newChatId })
  }

  // Same cutoff rule as events above.
  const sourceFacts = chatFactStore.list({ where: 'chatId = ?', params: [sourceChatId], orderBy: 'createdAt' })
  for (const f of sourceFacts) {
    if (cutoffCreatedAt !== undefined && (f.createdAt as number) > cutoffCreatedAt) continue
    const { id: _fid, chatId: _fcid, ...fRest } = f
    chatFactStore.insert({ ...fRest, id: newId(), chatId: newChatId })
  }

  res.status(201).json(forkedChat)
})

// Soft delete: drops out of the normal list but stays recoverable via `POST /:id/restore` until purged.
app.delete('/api/chats/:id', (req, res) => {
  const updated = chatStore.update(req.params.id, { deletedAt: Date.now() })
  if (!updated) return notFound(res)
  res.json(updated)
})

app.post('/api/chats/:id/restore', (req, res) => {
  const updated = chatStore.update(req.params.id, { deletedAt: null, updatedAt: Date.now() })
  if (!updated) return notFound(res)
  res.json(updated)
})

// The real, permanent delete — reachable from the trash view, a deliberate second step after soft-delete.
app.delete('/api/chats/:id/purge', (req, res) => {
  const chatId = req.params.id
  if (!chatStore.get(chatId)) return notFound(res)
  purgeChat(chatId)
  res.status(204).end()
})

// ---- Messages ----

// Plain substring scan (not SQL LIKE) over every message. Registered before `/:id`, or Express would match "search" as an :id.
app.get('/api/messages/search', (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase()
  if (!q) return res.json([])
  const hits = messageStore
    .list({ orderBy: 'createdAt DESC' })
    .filter((m) => String(m.text ?? '').toLowerCase().includes(q))
    .slice(0, 50)
  res.json(hits)
})

app.get('/api/messages/:id', (req, res) => {
  const row = messageStore.get(req.params.id)
  if (!row) return notFound(res)
  res.json(row)
})

app.post('/api/messages', (req, res) => {
  const created = messageStore.insert({ ...req.body, id: req.body.id || newId(), createdAt: req.body.createdAt ?? Date.now() })
  res.status(201).json(created)
})

app.put('/api/messages/:id', (req, res) => {
  const updated = messageStore.update(req.params.id, req.body)
  if (!updated) return notFound(res)
  res.json(updated)
})

app.delete('/api/messages/:id', (req, res) => {
  messageStore.remove(req.params.id)
  res.status(204).end()
})

// ---- World info books (global lorebooks) ----

app.get('/api/world-info-books', (_req, res) => {
  res.json(worldInfoBookStore.list({ orderBy: 'createdAt' }))
})

app.post('/api/world-info-books', (req, res) => {
  const created = worldInfoBookStore.insert({
    ...req.body,
    id: req.body.id || newId(),
    boundChatIds: normalizeIdArray(req.body.boundChatIds),
    boundCharacterIds: normalizeIdArray(req.body.boundCharacterIds),
    boundWorldIds: normalizeIdArray(req.body.boundWorldIds),
    createdAt: Date.now(),
  })
  res.status(201).json(created)
})

app.put('/api/world-info-books/:id', (req, res) => {
  const patch: Record<string, unknown> = { ...req.body }
  for (const key of ['boundChatIds', 'boundCharacterIds', 'boundWorldIds'] as const) {
    if (key in req.body) patch[key] = normalizeIdArray(req.body[key])
  }
  const updated = worldInfoBookStore.update(req.params.id, patch)
  if (!updated) return notFound(res)
  res.json(updated)
})

app.delete('/api/world-info-books/:id', (req, res) => {
  worldInfoBookStore.remove(req.params.id)
  res.status(204).end()
})

// ---- Sampler presets ----

app.get('/api/presets', (_req, res) => {
  res.json(presetStore.list({ orderBy: 'createdAt' }))
})

app.post('/api/presets', (req, res) => {
  const created = presetStore.insert({ id: newId(), name: req.body.name, params: req.body.params, createdAt: Date.now() })
  res.status(201).json(created)
})

app.delete('/api/presets/:id', (req, res) => {
  presetStore.remove(req.params.id)
  res.status(204).end()
})

// ---- Themes ----

app.get('/api/themes', (_req, res) => {
  res.json(themeStore.list({ orderBy: 'createdAt' }))
})

app.post('/api/themes', (req, res) => {
  const created = themeStore.insert({ id: newId(), name: req.body.name, tokens: req.body.tokens, createdAt: Date.now() })
  res.status(201).json(created)
})

app.put('/api/themes/:id', (req, res) => {
  const updated = themeStore.update(req.params.id, { name: req.body.name, tokens: req.body.tokens })
  if (!updated) return notFound(res)
  res.json(updated)
})

app.delete('/api/themes/:id', (req, res) => {
  themeStore.remove(req.params.id)
  res.status(204).end()
})

// ---- Assistant threads ----
//
// Plain model conversations, with no character and no relationship state. One row per thread with
// its messages inside, so the whole feature is a single resource (see `db.ts` for why).

app.get('/api/assistant-threads', (_req, res) => {
  // Newest first: the list is a recency list, and a thread is picked up where it was left.
  res.json(assistantThreadStore.list({ orderBy: 'updatedAt DESC' }))
})

app.get('/api/assistant-threads/:id', (req, res) => {
  const found = assistantThreadStore.get(req.params.id)
  if (!found) return notFound(res)
  res.json(found)
})

app.post('/api/assistant-threads', (req, res) => {
  const now = Date.now()
  const created = assistantThreadStore.insert({
    id: newId(),
    title: req.body.title ?? 'New conversation',
    messages: req.body.messages ?? [],
    createdAt: now,
    updatedAt: now,
  })
  res.status(201).json(created)
})

app.put('/api/assistant-threads/:id', (req, res) => {
  const updated = assistantThreadStore.update(req.params.id, { ...req.body, updatedAt: Date.now() })
  if (!updated) return notFound(res)
  res.json(updated)
})

app.delete('/api/assistant-threads/:id', (req, res) => {
  assistantThreadStore.remove(req.params.id)
  res.status(204).end()
})

// ---- Custom instruct templates ----

app.get('/api/instruct-templates', (_req, res) => {
  res.json(instructTemplateStore.list({ orderBy: 'createdAt' }))
})

app.post('/api/instruct-templates', (req, res) => {
  const created = instructTemplateStore.insert({
    id: newId(),
    name: req.body.name,
    systemPrefix: req.body.systemPrefix ?? '',
    systemSuffix: req.body.systemSuffix ?? '',
    userPrefix: req.body.userPrefix ?? '',
    userSuffix: req.body.userSuffix ?? '',
    assistantPrefix: req.body.assistantPrefix ?? '',
    assistantSuffix: req.body.assistantSuffix ?? '',
    stopSequences: Array.isArray(req.body.stopSequences) ? req.body.stopSequences : [],
    namesInPrompt: req.body.namesInPrompt === true,
    createdAt: Date.now(),
  })
  res.status(201).json(created)
})

app.put('/api/instruct-templates/:id', (req, res) => {
  const patch: Record<string, unknown> = {}
  if ('name' in req.body) patch.name = req.body.name
  if ('systemPrefix' in req.body) patch.systemPrefix = req.body.systemPrefix ?? ''
  if ('systemSuffix' in req.body) patch.systemSuffix = req.body.systemSuffix ?? ''
  if ('userPrefix' in req.body) patch.userPrefix = req.body.userPrefix ?? ''
  if ('userSuffix' in req.body) patch.userSuffix = req.body.userSuffix ?? ''
  if ('assistantPrefix' in req.body) patch.assistantPrefix = req.body.assistantPrefix ?? ''
  if ('assistantSuffix' in req.body) patch.assistantSuffix = req.body.assistantSuffix ?? ''
  if ('stopSequences' in req.body) patch.stopSequences = Array.isArray(req.body.stopSequences) ? req.body.stopSequences : []
  if ('namesInPrompt' in req.body) patch.namesInPrompt = req.body.namesInPrompt === true
  const updated = instructTemplateStore.update(req.params.id, patch)
  if (!updated) return notFound(res)
  res.json(updated)
})

app.delete('/api/instruct-templates/:id', (req, res) => {
  instructTemplateStore.remove(req.params.id)
  res.status(204).end()
})

// ---- Worlds ----

app.get('/api/worlds', (_req, res) => {
  res.json(worldStore.list({ orderBy: 'updatedAt DESC' }))
})

app.get('/api/worlds/:id', (req, res) => {
  const row = worldStore.get(req.params.id)
  if (!row) return notFound(res)
  res.json(row)
})

app.post('/api/worlds', (req, res) => {
  const now = Date.now()
  const id = newId()
  const avatarDataUrl = resolveAvatar('worlds', id, req.body.avatarDataUrl)
  const backgrounds = resolveAvatarMap('worlds', 'backgrounds', id, req.body.backgrounds)
  const backgroundsNight = resolveWorldBackgroundsNightMap(id, req.body.backgroundsNight)
  const music = resolveWorldMusicMap(id, req.body.music)
  const customSceneFlags = normalizeCustomSceneFlags(req.body.customSceneFlags)
  const allowedFlags = new Set([...DEFAULT_SCENE_FLAGS, ...customSceneFlags.map((f) => f.id)])
  const created = worldStore.insert({
    id,
    name: req.body.name,
    description: req.body.description,
    rules: req.body.rules,
    template: req.body.template ?? undefined,
    lorebook: req.body.lorebook,
    avatarDataUrl,
    backgrounds,
    backgroundsNight,
    backgroundUnlocks: req.body.backgroundUnlocks ?? {},
    music,
    gifts: normalizeGiftItems(req.body.gifts),
    items: normalizeItemDefs(req.body.items, allowedFlags),
    customSceneFlags,
    customBackgrounds: normalizeCustomBackgrounds(req.body.customBackgrounds),
    relationshipThresholds: normalizeRelationshipThresholds(req.body.relationshipThresholds),
    intimacyLevel: normalizeIntimacyLevel(req.body.intimacyLevel),
    triggers: normalizeTriggers(req.body.triggers),
    customIntimacyOptions: Array.isArray(req.body.customIntimacyOptions) ? req.body.customIntimacyOptions : undefined,
    createdAt: now,
    updatedAt: now,
  })
  res.status(201).json(created)
})

app.put('/api/worlds/:id', (req, res) => {
  const id = req.params.id
  const existing = worldStore.get(id)
  if (!existing) return notFound(res)
  const patch: Record<string, unknown> = { ...req.body, updatedAt: Date.now() }
  if ('avatarDataUrl' in req.body) patch.avatarDataUrl = resolveAvatar('worlds', id, req.body.avatarDataUrl)
  if ('backgrounds' in req.body) patch.backgrounds = resolveAvatarMap('worlds', 'backgrounds', id, req.body.backgrounds)
  if ('backgroundsNight' in req.body) patch.backgroundsNight = resolveWorldBackgroundsNightMap(id, req.body.backgroundsNight)
  if ('music' in req.body) patch.music = resolveWorldMusicMap(id, req.body.music)
  if ('backgroundUnlocks' in req.body) patch.backgroundUnlocks = req.body.backgroundUnlocks ?? {}
  if ('gifts' in req.body) patch.gifts = normalizeGiftItems(req.body.gifts)
  if ('customSceneFlags' in req.body) patch.customSceneFlags = normalizeCustomSceneFlags(req.body.customSceneFlags)
  if ('intimacyLevel' in req.body) patch.intimacyLevel = normalizeClearableIntimacyLevel(req.body.intimacyLevel)
  if ('triggers' in req.body) patch.triggers = normalizeTriggers(req.body.triggers)
  if ('customBackgrounds' in req.body) patch.customBackgrounds = normalizeCustomBackgrounds(req.body.customBackgrounds)
  if ('items' in req.body) {
    // Validate against whichever custom flags are in effect after this same request, so an item
    // referencing a flag saved in the same request isn't wrongly rejected.
    const customFlags = (
      'customSceneFlags' in patch ? patch.customSceneFlags : existing.customSceneFlags
    ) as { id: string }[] | undefined
    const allowedFlags = new Set([...DEFAULT_SCENE_FLAGS, ...(customFlags ?? []).map((f) => f.id)])
    patch.items = normalizeItemDefs(req.body.items, allowedFlags)
  }
  if ('relationshipThresholds' in req.body) patch.relationshipThresholds = normalizeRelationshipThresholds(req.body.relationshipThresholds)
  const updated = worldStore.update(id, patch)
  res.json(updated)
})

app.delete('/api/worlds/:id', (req, res) => {
  const worldId = req.params.id
  // Un-assign rather than cascade-delete: characters living here lose their world, not their existence.
  for (const c of characterStore.list({ where: 'worldId = ?', params: [worldId] })) {
    characterStore.update(c.id as string, { worldId: undefined })
  }
  removeAvatar('worlds', worldId)
  worldStore.remove(worldId)
  res.status(204).end()
})

// ---- Objectives ----

app.get('/api/objectives/active', (req, res) => {
  const chatId = String(req.query.chatId ?? '')
  const row = objectiveStore.list({ where: 'chatId = ? AND status = ?', params: [chatId, 'active'] })[0]
  res.json(row ?? null)
})

app.get('/api/objectives', (req, res) => {
  const chatId = String(req.query.chatId ?? '')
  const status = req.query.status ? String(req.query.status) : undefined
  const where = status ? 'chatId = ? AND status = ?' : 'chatId = ?'
  const params = status ? [chatId, status] : [chatId]
  res.json(objectiveStore.list({ where, params }))
})

app.post('/api/objectives', (req, res) => {
  const now = Date.now()
  const created = objectiveStore.insert({ ...req.body, id: newId(), createdAt: now, updatedAt: now })
  res.status(201).json(created)
})

app.put('/api/objectives/:id', (req, res) => {
  const updated = objectiveStore.update(req.params.id, { ...req.body, updatedAt: Date.now() })
  if (!updated) return notFound(res)
  res.json(updated)
})

app.delete('/api/objectives/:id', (req, res) => {
  objectiveStore.remove(req.params.id)
  res.status(204).end()
})

// ---- Relationship events ----
// Append-only audit log; no PUT/DELETE, entries are immutable once logged.

app.get('/api/chats/:id/relationship-events', (req, res) => {
  res.json(relationshipEventStore.list({ where: 'chatId = ?', params: [req.params.id], orderBy: 'createdAt DESC' }))
})

app.post('/api/relationship-events', (req, res) => {
  const created = relationshipEventStore.insert({ ...req.body, id: newId(), createdAt: Date.now() })
  res.status(201).json(created)
})

// ---- Chat facts ----
// Durable, individually-retirable facts; retiring one sets active: false (never DELETEd).

app.get('/api/chats/:id/chat-facts', (req, res) => {
  res.json(chatFactStore.list({ where: 'chatId = ?', params: [req.params.id], orderBy: 'createdAt DESC' }))
})

app.post('/api/chat-facts', (req, res) => {
  const created = chatFactStore.insert({ active: true, ...req.body, id: newId(), createdAt: Date.now() })
  res.status(201).json(created)
})

app.put('/api/chat-facts/:id', (req, res) => {
  const updated = chatFactStore.update(req.params.id, req.body)
  if (!updated) return notFound(res)
  res.json(updated)
})

// ---- Full backup / restore ----
// One self-contained JSON snapshot of every table plus every avatar/sprite/background file (base64),
// preserving original ids — unlike character packs (importExport.ts / pack.ts), which mint new ones.

const BACKUP_VERSION = 1
const BACKUP_STORES = {
  characters: characterStore,
  personas: personaStore,
  chats: chatStore,
  messages: messageStore,
  worldInfoBooks: worldInfoBookStore,
  presets: presetStore,
  themes: themeStore,
  instructTemplates: instructTemplateStore,
  assistantThreads: assistantThreadStore,
  worlds: worldStore,
  objectives: objectiveStore,
  relationshipEvents: relationshipEventStore,
  chatFacts: chatFactStore,
} as const

function listAvatarFiles(): { relPath: string; base64: string }[] {
  const results: { relPath: string; base64: string }[] = []
  function walk(dir: string, rel: string) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      const relEntry = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(abs, relEntry)
      else results.push({ relPath: relEntry, base64: fs.readFileSync(abs).toString('base64') })
    }
  }
  walk(avatarsDir, '')
  return results
}

app.get('/api/backup', (_req, res) => {
  const data: Record<string, unknown[]> = {}
  for (const [key, store] of Object.entries(BACKUP_STORES)) data[key] = store.list()
  res.json({ version: BACKUP_VERSION, exportedAt: Date.now(), data, avatarFiles: listAvatarFiles() })
})

// A full backup with many/large images can exceed the app's normal 25mb JSON ceiling — this
// route alone accepts a much larger body instead of raising the limit for every other endpoint.
app.post('/api/restore', express.json({ limit: '1gb' }), (req, res) => {
  const body = req.body as Record<string, unknown>
  if (!body || typeof body !== 'object' || body.version !== BACKUP_VERSION || !body.data || typeof body.data !== 'object') {
    return res.status(400).json({ error: 'Not a recognized backup file.' })
  }
  const data = body.data as Record<string, unknown>
  // All-or-nothing: without a transaction, a bad row partway through would leave tables in a mixed old/new state.
  db.exec('BEGIN')
  try {
    for (const [key, store] of Object.entries(BACKUP_STORES)) {
      store.clear()
      const rows = Array.isArray(data[key]) ? (data[key] as Record<string, unknown>[]) : []
      for (const row of rows) store.insert(row)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  if (Array.isArray(body.avatarFiles)) {
    // Write into a fresh temp directory and only swap it in once every file succeeds, so a failure
    // partway through can't leave avatarsDir wiped with nothing restored.
    const tmpDir = `${avatarsDir}.restore-tmp`
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.mkdirSync(tmpDir, { recursive: true })
    for (const f of body.avatarFiles as Record<string, unknown>[]) {
      if (typeof f.relPath !== 'string' || typeof f.base64 !== 'string') continue
      // Strip '..' segments so restore can never write outside avatarsDir.
      const safeRel = f.relPath
        .replace(/\\/g, '/')
        .split('/')
        .filter((seg) => seg && seg !== '.' && seg !== '..')
        .join('/')
      if (!safeRel) continue
      const dest = path.join(tmpDir, safeRel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, Buffer.from(f.base64, 'base64'))
    }
    fs.rmSync(avatarsDir, { recursive: true, force: true })
    fs.renameSync(tmpDir, avatarsDir)
  }
  res.status(204).end()
})

/** NovelAI wants its prompt pre-tokenized (see novelaiTokenizer.ts); the browser sends the resulting ids to NovelAI directly with its own API key. */
app.post('/api/novelai/tokenize', async (req, res) => {
  const { text, model } = req.body as { text?: unknown; model?: unknown }
  if (typeof text !== 'string' || typeof model !== 'string') {
    res.status(400).json({ error: '"text" and "model" are both required strings.' })
    return
  }
  const tokenizerId = tokenizerForModel(model)
  if (!tokenizerId) {
    res.status(400).json({ error: `No bundled tokenizer for NovelAI model "${model}" — only Clio and Kayra are supported so far.` })
    return
  }
  const ids = await encodeTokens(text, tokenizerId)
  res.json({ ids })
})

// Serve the built client (Docker, or `npm run build` && `npm start`). In dev this is Vite's job and
// `dist/` doesn't exist, so the whole block is skipped and `npm run dev` is untouched. Registered
// after every `/api` route so those still win; the SPA fallback then hands any other GET the app
// shell so a deep-link reload works, while unknown `/api` paths fall through to the 404 below.
const clientDir = path.resolve(fileURLToPath(import.meta.url), '..', '..', 'dist')
if (fs.existsSync(path.join(clientDir, 'index.html'))) {
  app.use(express.static(clientDir))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api/') || req.path.startsWith('/avatars/')) return next()
    res.sendFile(path.join(clientDir, 'index.html'))
  })
}

// Catches throws from any route above and returns clean JSON instead of Express's default HTML error page. Must be last.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(400).json({ error: err instanceof Error ? err.message : 'Request failed' })
})
