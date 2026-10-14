// The real HostApi: connects the extension bridge to the app's data, model backend and live chat session.

import { charactersApi, chatFactsApi, chatsApi, extensionsApi, instructTemplatesApi, messagesApi, personasApi, worldInfoBooksApi, worldsApi } from '@/lib/api/client'
import { createChatBackend } from '@/lib/api/createChatBackend'
import { generateWithTimeout } from '@/lib/api/generateWithTimeout'
import { defaultGiftInventory, giftById } from '@/lib/dating/gifts'
import { itemById } from '@/lib/dating/items'
import { computeWarmth, getRelationshipStats, getRelationshipTrack } from '@/lib/dating/stage'
import { newId } from '@/lib/id'
import { getInstructTemplate, resolveInstructTemplate } from '@/lib/prompt/instructTemplates'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { toastError, toastInfo, toastSuccess } from '@/lib/store/useToastStore'
import type { LorebookEntry } from '@/lib/characters/cardSpec'
import type { StoredMessage } from '@/lib/types'
import { PHASES } from '@/lib/world/calendar'
import { getChatSession } from './chatSessionRegistry'
import type { HostApi, LoreEntryOut, MessageOut } from './bridge'

async function activeChat() {
  const chatId = useSettingsStore.getState().activeChatId
  if (!chatId) return null
  const chat = await chatsApi.get(chatId)
  return chat && !chat.deletedAt ? chat : null
}

async function requireChat() {
  const chat = await activeChat()
  if (!chat) throw new Error('No chat is open. Open a chat first.')
  return chat
}

async function worldFor(characterId: string) {
  const character = await charactersApi.get(characterId)
  const world = character?.worldId ? await worldsApi.get(character.worldId) : undefined
  return { character, world }
}

function messageOut(m: StoredMessage): MessageOut {
  return { id: m.id, role: m.role, name: m.name, text: m.text, createdAt: m.createdAt }
}

function entryOut(e: LorebookEntry, index: number): LoreEntryOut {
  return { id: e.id ?? index, keys: e.keys, content: e.content, comment: e.comment ?? '', enabled: e.enabled }
}

async function loadBook(bookId: string) {
  const book = await worldInfoBooksApi.get(bookId)
  if (!book) throw new Error(`No lorebook with id "${bookId}"`)
  return book
}

export const appHostApi: HostApi = {
  async scopeId(scope) {
    const chat = await activeChat()
    if (!chat) return null
    if (scope === 'chat') return chat.id
    if (scope === 'character') return chat.characterId
    return (await worldFor(chat.characterId)).world?.id ?? null
  },
  kvList: (extId, scope, scopeId) => extensionsApi.kvList(extId, scope, scopeId),
  kvSet: (extId, scope, scopeId, key, value) => extensionsApi.kvSet(extId, scope, scopeId, key, value),
  kvRemove: (extId, scope, scopeId, key) => extensionsApi.kvRemove(extId, scope, scopeId, key),
  notify(source, text, kind) {
    const message = `${source}: ${text}`
    if (kind === 'error') toastError(message)
    else if (kind === 'success') toastSuccess(message)
    else toastInfo(message)
  },

  async chatInfo() {
    const chat = await activeChat()
    if (!chat) return null
    const [{ character, world }, persona] = await Promise.all([worldFor(chat.characterId), chat.personaId ? personasApi.get(chat.personaId) : Promise.resolve(undefined)])
    return {
      chatId: chat.id,
      title: chat.title,
      characterId: chat.characterId,
      characterName: character?.card.name ?? '',
      personaName: persona?.name ?? 'You',
      worldId: world?.id ?? null,
      worldName: world?.name ?? null,
      mode: chat.mode ?? null,
    }
  },
  async chatMessages(limit) {
    const chat = await requireChat()
    const all = await messagesApi.listByChat(chat.id)
    return all.filter((m) => m.text.trim() && !m.failed).slice(-limit).map(messageOut)
  },
  async chatAppend(text, as) {
    const chat = await requireChat()
    const [{ character }, persona] = await Promise.all([worldFor(chat.characterId), chat.personaId ? personasApi.get(chat.personaId) : Promise.resolve(undefined)])
    const message: StoredMessage = {
      id: newId(),
      chatId: chat.id,
      role: as,
      name: as === 'user' ? (persona?.name ?? 'You') : (character?.card.name ?? 'Character'),
      text,
      createdAt: Date.now(),
    }
    await messagesApi.create(message)
    return messageOut(message)
  },
  async chatSend(text) {
    const session = getChatSession()
    if (!session || session.chatId !== useSettingsStore.getState().activeChatId) throw new Error('Open the chat first: messages can only be sent while the chat window is showing.')
    if (session.isGenerating()) throw new Error('The character is still replying.')
    await session.sendUserMessage(text)
  },

  async stateGet() {
    const chat = await activeChat()
    if (!chat) return null
    const track = getRelationshipTrack(chat, chat.characterId)
    const { world } = await worldFor(chat.characterId)
    const stats = getRelationshipStats({ relationshipStats: track.relationshipStats })
    const affection = track.affection ?? 0
    return {
      affection,
      warmth: computeWarmth(affection, stats),
      stage: track.relationshipStage ?? 'near_strangers',
      stats,
      flags: chat.sceneFlags ?? [],
      commitment: track.commitmentStatus ?? 'none',
      coins: chat.giftCoins ?? 0,
      inventory: { ...(chat.giftInventory ?? {}), ...(chat.itemInventory ?? {}) },
      day: world?.currentDay ?? null,
      phase: world ? PHASES[world.currentPhaseIndex ?? 0] : null,
    }
  },
  async stateSetFlag(flag, on) {
    const chat = await requireChat()
    const flags = new Set(chat.sceneFlags ?? [])
    if (on) flags.add(flag)
    else flags.delete(flag)
    const next = [...flags]
    await chatsApi.update(chat.id, { sceneFlags: next })
    return next
  },
  async stateAddCoins(amount) {
    const chat = await requireChat()
    const coins = Math.max(0, (chat.giftCoins ?? 0) + amount)
    await chatsApi.update(chat.id, { giftCoins: coins })
    return coins
  },
  async stateGiveItem(id, count) {
    const chat = await requireChat()
    const { world } = await worldFor(chat.characterId)
    if (itemById(id, world)) {
      const items = { ...(chat.itemInventory ?? {}) }
      items[id] = (items[id] ?? 0) + count
      await chatsApi.update(chat.id, { itemInventory: items })
      return { ...(chat.giftInventory ?? {}), ...items }
    }
    if (giftById(id, world)) {
      const gifts = { ...(chat.giftInventory ?? defaultGiftInventory(world)) }
      gifts[id] = (gifts[id] ?? 0) + count
      await chatsApi.update(chat.id, { giftInventory: gifts })
      return { ...gifts, ...(chat.itemInventory ?? {}) }
    }
    throw new Error(`Unknown item "${id}" in this world.`)
  },

  async loreBooks() {
    return (await worldInfoBooksApi.list()).map((b) => ({ id: b.id, name: b.name, entries: b.book.entries.length }))
  },
  async loreEntries(bookId) {
    return (await loadBook(bookId)).book.entries.map(entryOut)
  },
  async loreAdd(bookId, entry) {
    const book = await loadBook(bookId)
    const entries = book.book.entries
    const nextId = entries.reduce((max, e, i) => Math.max(max, e.id ?? i), -1) + 1
    const fresh: LorebookEntry = {
      id: nextId,
      keys: entry.keys,
      comment: entry.comment,
      content: entry.content,
      constant: false,
      selective: false,
      insertion_order: nextId,
      enabled: true,
      activationMode: 'keyword',
    }
    await worldInfoBooksApi.update(bookId, { book: { ...book.book, entries: [...entries, fresh] } })
    return entryOut(fresh, entries.length)
  },
  async loreRemove(bookId, entryId) {
    const book = await loadBook(bookId)
    const entries = book.book.entries.filter((e, i) => (e.id ?? i) !== entryId)
    await worldInfoBooksApi.update(bookId, { book: { ...book.book, entries } })
  },
  async factsList() {
    const chat = await requireChat()
    return (await chatFactsApi.listByChat(chat.id)).filter((f) => f.active).map((f) => ({ id: f.id, text: f.text, importance: f.importance ?? 0.5 }))
  },
  async factsAdd(text, importance) {
    const chat = await requireChat()
    const fact = await chatFactsApi.create({ chatId: chat.id, text, importance })
    return { id: fact.id, text: fact.text, importance }
  },
  async charactersList() {
    return (await charactersApi.list()).map((c) => ({ id: c.id, name: c.card.name, tags: c.card.tags ?? [] }))
  },

  async generate(prompt, opts) {
    const s = useSettingsStore.getState()
    const client = createChatBackend({
      chatBackend: s.chatBackend,
      baseUrl: s.baseUrl,
      chatBackendBaseUrl: s.chatBackendBaseUrl,
      chatBackendApiKey: s.chatBackendApiKey,
      chatBackendModel: s.chatBackendModel,
    })
    const template =
      s.chatBackend === 'openai-compatible' ? getInstructTemplate('plain-chat') : resolveInstructTemplate(s.instructTemplateId, await instructTemplatesApi.list())
    const text = await generateWithTimeout(
      client,
      {
        prompt: opts.system ? `${opts.system}\n\n${prompt}` : prompt,
        messages: opts.system ? [{ role: 'system', content: opts.system }, { role: 'user', content: prompt }] : undefined,
        max_length: opts.maxTokens,
        max_context_length: s.sampler.max_context_length,
        temperature: opts.temperature,
        top_p: 0.95,
        top_k: 0,
        min_p: 0.05,
        typical: 1,
        tfs: 1,
        rep_pen: 1.1,
        rep_pen_range: 1024,
        rep_pen_slope: 0.7,
      },
      'Extension request',
      undefined,
      { reasoningReserve: s.reasoningTokenReserve, template },
    )
    return text.trim()
  },
}
