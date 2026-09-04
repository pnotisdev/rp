import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import {
  characterStore,
  chatFactStore,
  chatStore,
  db,
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
import { removeAvatar, resolveAvatar, resolveAvatarMap, resolveWorldMusicMap } from './avatars.ts'

export const app = express()
// A character save can carry many sprite images at once now (10d's bulk expression upload) —
// each already capped at 8MB decoded by decodeImageDataUrl(), but a full ~21-expression set in
// one request easily clears a 25MB body. Raised generously since this is a local-only, single-user
// app with no untrusted-request concern, not a public API needing a tight body-size ceiling.
app.use(express.json({ limit: '150mb' }))
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

function normalizeGalleryEntries(id: string, galleryRaw: unknown) {
  if (!Array.isArray(galleryRaw)) return []
  const mapInput: Record<string, string> = {}
  const entries = galleryRaw
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
    .map((g, i) => {
      const gid = typeof g.id === 'string' && g.id.trim() ? g.id.trim() : `cg-${i}`
      const imageUrl = typeof g.imageUrl === 'string' ? g.imageUrl : ''
      if (imageUrl) mapInput[gid] = imageUrl
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
      }
    })
  const resolvedMap = resolveAvatarMap('characters', 'gallery', id, mapInput) ?? {}
  return entries.map((g) => ({ ...g, imageUrl: resolvedMap[g.id] || g.imageUrl })).filter((g) => !!g.imageUrl)
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
/** The 4 flags always available regardless of world — mirrors `stage.ts`'s `SCENE_FLAGS` on the client. A world's own `customSceneFlags` extend this set per-world; see `normalizeItemDefs`'s `allowedFlags` param. */
const DEFAULT_SCENE_FLAGS = new Set(['first_date', 'confession', 'jealousy', 'promise'])

/** 10e's scene-flag authoring — drops any entry missing a label (mirrors `normalizeSocialConnections`'s "drop if missing the one field it's meaningless without" shape). Descriptions are allowed empty (the client nudges for one, but doesn't hard-require it) rather than silently discarding an otherwise-valid flag. */
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

/**
 * 10d's item catalog — validates the effect union so a malformed save can never persist an item
 * with no usable effect. `allowedFlags` is the built-in 4 plus whichever custom flags this same
 * world save request just defined — a "Set scene flag" effect referencing an id outside that set
 * (a typo, or a flag deleted in the same edit that removed it) falls through to the default
 * relationship-nudge branch below, same as an unrecognized flag always has.
 */
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
  // Round rather than reject a fractional amount (e.g. a client that didn't clamp to a whole
  // number before saving) — silently substituting a fixed 1 for any non-integer input, including
  // a deliberate "+2.5" someone just typed, discarded the author's actual value with no feedback.
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

/** 10e's "who a character knows" — drops any entry missing a name (the one field a connection is meaningless without). */
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

const OUTREACH_FREQUENCIES = new Set(['never', 'rare', 'normal', 'eager'])

/** 10f's authored outreach trait — rejects an unrecognized frequency (e.g. from a hand-edited backup) rather than letting it silently fall through as `undefined` in a threshold lookup, which would make an unrecognized character permanently eligible. */
function normalizeOutreach(raw: unknown): { frequency: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const frequency = (raw as Record<string, unknown>).frequency
  return typeof frequency === 'string' && OUTREACH_FREQUENCIES.has(frequency) ? { frequency } : undefined
}

const REPLY_LENGTHS = new Set(['auto', 'brief', 'moderate', 'detailed'])

/** Per-character reply-length override (src/lib/characters/voice.ts). 'auto' and unset both mean "measure the card"; only the three explicit bands are stored. */
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
  const gallery = normalizeGalleryEntries(id, req.body.gallery)
  const created = characterStore.insert({
    id,
    card: req.body.card,
    avatarDataUrl,
    sprites,
    spriteUnlocks: req.body.spriteUnlocks ?? {},
    customExpressions: normalizeCustomExpressions(req.body.customExpressions),
    giftPreferences: req.body.giftPreferences ?? {},
    giftLikes: normalizeStringArray(req.body.giftLikes),
    giftDislikes: normalizeStringArray(req.body.giftDislikes),
    loveLanguage: typeof req.body.loveLanguage === 'string' ? req.body.loveLanguage : undefined,
    gallery,
    relationshipStarters: req.body.relationshipStarters ?? [],
    voice: req.body.voice ?? undefined,
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
    occupation: typeof req.body.occupation === 'string' ? req.body.occupation : undefined,
    workplace: typeof req.body.workplace === 'string' ? req.body.workplace : undefined,
    homeLocation: typeof req.body.homeLocation === 'string' ? req.body.homeLocation : undefined,
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
  if ('spriteUnlocks' in req.body) patch.spriteUnlocks = req.body.spriteUnlocks ?? {}
  if ('customExpressions' in req.body) patch.customExpressions = normalizeCustomExpressions(req.body.customExpressions)
  if ('giftPreferences' in req.body) patch.giftPreferences = req.body.giftPreferences ?? {}
  if ('giftLikes' in req.body) patch.giftLikes = normalizeStringArray(req.body.giftLikes)
  if ('giftDislikes' in req.body) patch.giftDislikes = normalizeStringArray(req.body.giftDislikes)
  if ('loveLanguage' in req.body) patch.loveLanguage = typeof req.body.loveLanguage === 'string' ? req.body.loveLanguage : undefined
  if ('gallery' in req.body) patch.gallery = normalizeGalleryEntries(id, req.body.gallery)
  if ('relationshipStarters' in req.body) patch.relationshipStarters = req.body.relationshipStarters ?? []
  if ('voice' in req.body) patch.voice = req.body.voice ?? undefined
  if ('sfxWords' in req.body) patch.sfxWords = normalizeStringArray(req.body.sfxWords)
  if ('instructTemplateId' in req.body) patch.instructTemplateId = typeof req.body.instructTemplateId === 'string' ? req.body.instructTemplateId : undefined
  if ('replyLength' in req.body) patch.replyLength = normalizeReplyLength(req.body.replyLength)
  if ('weatherPreferences' in req.body) patch.weatherPreferences = req.body.weatherPreferences ?? undefined
  if ('schedule' in req.body) patch.schedule = Array.isArray(req.body.schedule) ? req.body.schedule : undefined
  if ('likes' in req.body) patch.likes = normalizeStringArray(req.body.likes)
  if ('goals' in req.body) patch.goals = normalizeStringArray(req.body.goals)
  if ('boundaries' in req.body) patch.boundaries = normalizeStringArray(req.body.boundaries)
  if ('socialConnections' in req.body) patch.socialConnections = normalizeSocialConnections(req.body.socialConnections)
  if ('occupation' in req.body) patch.occupation = typeof req.body.occupation === 'string' ? req.body.occupation : undefined
  if ('workplace' in req.body) patch.workplace = typeof req.body.workplace === 'string' ? req.body.workplace : undefined
  if ('homeLocation' in req.body) patch.homeLocation = typeof req.body.homeLocation === 'string' ? req.body.homeLocation : undefined
  if ('frequentedLocations' in req.body) patch.frequentedLocations = normalizeStringArray(req.body.frequentedLocations)
  if ('dateModeOptOut' in req.body) patch.dateModeOptOut = req.body.dateModeOptOut === true
  if ('outreach' in req.body) patch.outreach = normalizeOutreach(req.body.outreach)
  const updated = characterStore.update(id, patch)
  res.json(updated)
})

app.delete('/api/characters/:id', (req, res) => {
  const characterId = req.params.id
  const chats = chatStore.list({ where: 'characterId = ?', params: [characterId] })
  for (const chat of chats) {
    for (const msg of messageStore.list({ where: 'chatId = ?', params: [chat.id] })) messageStore.remove(msg.id as string)
    for (const o of objectiveStore.list({ where: 'chatId = ?', params: [chat.id] })) objectiveStore.remove(o.id as string)
    for (const e of relationshipEventStore.list({ where: 'chatId = ?', params: [chat.id] })) relationshipEventStore.remove(e.id as string)
    for (const f of chatFactStore.list({ where: 'chatId = ?', params: [chat.id] })) chatFactStore.remove(f.id as string)
    chatStore.remove(chat.id as string)
  }
  // A character can also appear as a non-primary group-chat participant — `participants` lives in
  // the JSON blob, not an indexed column, so this can't be a SQL WHERE; it's a full scan (fine on
  // a single-user local table). Drop the dangling id from the array rather than deleting the chat.
  for (const chat of chatStore.list()) {
    const participants = chat.participants as string[] | undefined
    if (!participants?.includes(characterId)) continue
    chatStore.update(chat.id as string, { participants: participants.filter((id) => id !== characterId) })
  }
  // Removes the whole per-character folder in one shot — avatar, sprites, and gallery all live
  // under it together (see server/avatars.ts), so nothing can be left orphaned.
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
  // Mirrors the character-delete cleanup below: `Chat.personaId` is a dangling reference once the
  // persona is gone, not indexed, so a full scan is needed. Left unresolved, the client's persona
  // fetch 404s silently on every load of that chat and it permanently loses its persona binding
  // (name/description never reach the prompt) with no visible error.
  for (const chat of chatStore.list()) {
    // `Chat.personaId` is typed as a required string (no "no persona" case existed until this
    // cleanup), so clear it to '' rather than null/undefined to stay a valid value of that type —
    // `persona?.name || 'You'` and friends already treat any falsy id/lookup miss as "no persona".
    if (chat.personaId === personaId) chatStore.update(chat.id as string, { personaId: '' })
  }
  removeAvatar('personas', personaId)
  personaStore.remove(personaId)
  res.status(204).end()
})

// ---- Chats ----

app.get('/api/chats', (_req, res) => {
  res.json(chatStore.list({ orderBy: 'updatedAt DESC' }))
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

// Forks a chat at a given message (or at its latest message, if none given): a new chat
// carrying the same relationship/gift/gallery state and a copy of the transcript up to that
// point, so a user can try a choice and still have the original to go back to.
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
  // `worldInfoState` is transient per-turn sticky/cooldown bookkeeping whose values are absolute
  // turn numbers from the source chat — meaningless in a branch that may start from a much earlier
  // point, so the fork begins with a clean slate rather than inheriting stale timers. `rapport` is
  // a live-date scene read; a fork branches out of that scene, so it starts without one too.
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

  // Same cutoff rule as events above — a fact learned after the fork point belongs only to the
  // original timeline.
  const sourceFacts = chatFactStore.list({ where: 'chatId = ?', params: [sourceChatId], orderBy: 'createdAt' })
  for (const f of sourceFacts) {
    if (cutoffCreatedAt !== undefined && (f.createdAt as number) > cutoffCreatedAt) continue
    const { id: _fid, chatId: _fcid, ...fRest } = f
    chatFactStore.insert({ ...fRest, id: newId(), chatId: newChatId })
  }

  res.status(201).json(forkedChat)
})

app.delete('/api/chats/:id', (req, res) => {
  const chatId = req.params.id
  for (const msg of messageStore.list({ where: 'chatId = ?', params: [chatId] })) messageStore.remove(msg.id as string)
  for (const o of objectiveStore.list({ where: 'chatId = ?', params: [chatId] })) objectiveStore.remove(o.id as string)
  for (const e of relationshipEventStore.list({ where: 'chatId = ?', params: [chatId] })) relationshipEventStore.remove(e.id as string)
  for (const f of chatFactStore.list({ where: 'chatId = ?', params: [chatId] })) chatFactStore.remove(f.id as string)
  // Any chat forked FROM this one points back via parentChatId — not an indexed column (it lives
  // in the JSON blob, like `participants` above), so a full scan. Left dangling, the header's
  // "⑂ original chat" link would navigate to a chat that no longer exists (a 404 fetch) with no
  // indication why.
  for (const chat of chatStore.list()) {
    if (chat.parentChatId !== chatId) continue
    chatStore.update(chat.id as string, { parentChatId: undefined, forkedFromMessageId: undefined })
  }
  chatStore.remove(chatId)
  res.status(204).end()
})

// ---- Messages ----

// A plain substring scan over every chat's messages rather than a SQL LIKE, so this never needs
// to add the JSON `data` blob column to assertSafeClause's identifier allowlist for what is a
// read-only, non-performance-critical feature on a single-user local database. Must be registered
// before the `/:id` route below, or Express would match "search" itself as an :id.
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
    backgroundUnlocks: req.body.backgroundUnlocks ?? {},
    music,
    gifts: normalizeGiftItems(req.body.gifts),
    items: normalizeItemDefs(req.body.items, allowedFlags),
    customSceneFlags,
    relationshipThresholds: normalizeRelationshipThresholds(req.body.relationshipThresholds),
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
  if ('music' in req.body) patch.music = resolveWorldMusicMap(id, req.body.music)
  if ('backgroundUnlocks' in req.body) patch.backgroundUnlocks = req.body.backgroundUnlocks ?? {}
  if ('gifts' in req.body) patch.gifts = normalizeGiftItems(req.body.gifts)
  if ('customSceneFlags' in req.body) patch.customSceneFlags = normalizeCustomSceneFlags(req.body.customSceneFlags)
  if ('items' in req.body) {
    // Validate against whichever custom flags are actually in effect after this same request —
    // the just-normalized ones if this save also touched customSceneFlags, otherwise the world's
    // existing ones — so an item referencing a custom flag saved in the very same request isn't
    // wrongly rejected as "unrecognized" just because of normalization order.
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
  // Removes the whole per-world folder in one shot — avatar and backgrounds live under it
  // together (see server/avatars.ts), so nothing can be left orphaned.
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
// Append-only audit log alongside the overwritten running totals on Chat — no PUT/DELETE,
// entries are immutable once logged.

app.get('/api/chats/:id/relationship-events', (req, res) => {
  res.json(relationshipEventStore.list({ where: 'chatId = ?', params: [req.params.id], orderBy: 'createdAt DESC' }))
})

app.post('/api/relationship-events', (req, res) => {
  const created = relationshipEventStore.insert({ ...req.body, id: newId(), createdAt: Date.now() })
  res.status(201).json(created)
})

// ---- Chat facts ----
// Durable, individually-retirable facts — unlike relationship events, these DO support PUT
// (retiring one sets active: false; the row stays for the audit trail, never DELETEd).

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
// One self-contained JSON snapshot of every table plus every avatar/sprite/background file
// (inlined as base64), so the entire local install can be moved or recovered in one file —
// unlike character packs (importExport.ts / pack.ts), which mint new ids and are meant for
// sharing a single character, this preserves original ids and is meant to reproduce this
// exact install byte-for-byte.

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
  // Everything below the DB tables must land as one all-or-nothing unit — restore used to wipe
  // and reload each table in sequence with no surrounding transaction, so a single bad row deep
  // in the backup (e.g. one saved under an older schema) left the DB in a mixed old/new state:
  // tables processed before the failure held new data, tables after it still held the old data,
  // with no way to recover the pre-restore state since it had already been partially overwritten.
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
    // Write into a fresh temp directory first and only swap it in once every file has been
    // written successfully — writing directly into `avatarsDir` after wiping it (the old
    // approach) permanently lost every avatar/sprite/background if a write failed partway
    // through, since the original files were already gone by then.
    const tmpDir = `${avatarsDir}.restore-tmp`
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.mkdirSync(tmpDir, { recursive: true })
    for (const f of body.avatarFiles as Record<string, unknown>[]) {
      if (typeof f.relPath !== 'string' || typeof f.base64 !== 'string') continue
      // Backups are trusted local exports, but a maliciously-crafted one could still carry
      // '..' segments — strip them so restore can never write outside avatarsDir.
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

// Catches synchronous throws from any route above (malformed ids, missing required
// fields hitting a NOT NULL column, etc.) and returns clean JSON instead of Express's
// default HTML error page with a leaked stack trace. Must be registered last.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(400).json({ error: err instanceof Error ? err.message : 'Request failed' })
})
