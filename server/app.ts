import express from 'express'
import {
  characterStore,
  chatStore,
  messageStore,
  newId,
  objectiveStore,
  personaStore,
  presetStore,
  themeStore,
  worldInfoBookStore,
  worldStore,
  avatarsDir,
} from './db.ts'
import { removeAvatar, resolveAvatar } from './avatars.ts'

export const app = express()
app.use(express.json({ limit: '25mb' }))
app.use('/avatars', express.static(avatarsDir))

function notFound(res: express.Response) {
  res.status(404).json({ error: 'Not found' })
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
  const created = characterStore.insert({
    id,
    card: req.body.card,
    avatarDataUrl,
    worldId: req.body.worldId || undefined,
    createdAt: now,
    updatedAt: now,
  })
  res.status(201).json(created)
})

app.put('/api/characters/:id', (req, res) => {
  const id = req.params.id
  const patch: Record<string, unknown> = { updatedAt: Date.now() }
  if ('card' in req.body) patch.card = req.body.card
  if ('worldId' in req.body) patch.worldId = req.body.worldId || undefined
  if ('avatarDataUrl' in req.body) patch.avatarDataUrl = resolveAvatar('characters', id, req.body.avatarDataUrl)
  const updated = characterStore.update(id, patch)
  if (!updated) return notFound(res)
  res.json(updated)
})

app.delete('/api/characters/:id', (req, res) => {
  const characterId = req.params.id
  const chats = chatStore.list({ where: 'characterId = ?', params: [characterId] })
  for (const chat of chats) {
    for (const msg of messageStore.list({ where: 'chatId = ?', params: [chat.id] })) messageStore.remove(msg.id as string)
    for (const o of objectiveStore.list({ where: 'chatId = ?', params: [chat.id] })) objectiveStore.remove(o.id as string)
    chatStore.remove(chat.id as string)
  }
  removeAvatar('characters', characterId)
  characterStore.remove(characterId)
  res.status(204).end()
})

// ---- Personas ----

app.get('/api/personas', (_req, res) => {
  res.json(personaStore.list({ orderBy: 'createdAt' }))
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
  const patch: Record<string, unknown> = {}
  if ('name' in req.body) patch.name = req.body.name
  if ('description' in req.body) patch.description = req.body.description
  if ('avatarDataUrl' in req.body) patch.avatarDataUrl = resolveAvatar('personas', id, req.body.avatarDataUrl)
  const updated = personaStore.update(id, patch)
  if (!updated) return notFound(res)
  res.json(updated)
})

app.delete('/api/personas/:id', (req, res) => {
  removeAvatar('personas', req.params.id)
  personaStore.remove(req.params.id)
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
    personaId: req.body.personaId ?? '',
    title: req.body.title,
    createdAt: now,
    updatedAt: now,
  })
  res.status(201).json(created)
})

app.put('/api/chats/:id', (req, res) => {
  const { characterId: _c, id: _id, createdAt: _ca, ...patch } = req.body
  const updated = chatStore.update(req.params.id, { ...patch, updatedAt: Date.now() })
  if (!updated) return notFound(res)
  res.json(updated)
})

app.delete('/api/chats/:id', (req, res) => {
  const chatId = req.params.id
  for (const msg of messageStore.list({ where: 'chatId = ?', params: [chatId] })) messageStore.remove(msg.id as string)
  for (const o of objectiveStore.list({ where: 'chatId = ?', params: [chatId] })) objectiveStore.remove(o.id as string)
  chatStore.remove(chatId)
  res.status(204).end()
})

// ---- Messages ----

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
  const created = worldInfoBookStore.insert({ ...req.body, id: req.body.id || newId(), createdAt: Date.now() })
  res.status(201).json(created)
})

app.put('/api/world-info-books/:id', (req, res) => {
  const updated = worldInfoBookStore.update(req.params.id, req.body)
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

app.delete('/api/themes/:id', (req, res) => {
  themeStore.remove(req.params.id)
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
  const created = worldStore.insert({
    id,
    name: req.body.name,
    description: req.body.description,
    rules: req.body.rules,
    lorebook: req.body.lorebook,
    avatarDataUrl,
    createdAt: now,
    updatedAt: now,
  })
  res.status(201).json(created)
})

app.put('/api/worlds/:id', (req, res) => {
  const id = req.params.id
  const patch: Record<string, unknown> = { ...req.body, updatedAt: Date.now() }
  if ('avatarDataUrl' in req.body) patch.avatarDataUrl = resolveAvatar('worlds', id, req.body.avatarDataUrl)
  const updated = worldStore.update(id, patch)
  if (!updated) return notFound(res)
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
