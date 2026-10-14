// The glue between the settings, the embeddings server and the chat: what to look up before a reply, and what to remember after one.

import { messagesApi, vectorsApi } from '@/lib/api/client'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { embedTexts, type EmbeddingConfig } from './embeddings'
import { embeddingConfigFrom, indexMessages, retrieveMemories, type MemoryDeps } from './memory'

export function memoryDeps(cfg: EmbeddingConfig): MemoryDeps {
  return { embed: (texts) => embedTexts(cfg, texts), api: vectorsApi }
}

/** The settings, or null when similarity search is off or has nowhere to send text. */
function active() {
  const s = useSettingsStore.getState()
  const cfg = embeddingConfigFrom(s)
  return s.vectorsEnabled && cfg.baseUrl.trim() ? { s, cfg } : null
}

let last: { key: string; result: string[] } | null = null

/** Passages for the prompt that match the last few messages. A failure never stops a reply: it just means no extra passages. */
export async function retrieveForPrompt(args: { chatId: string; characterId: string; history: { id: string; text: string }[]; recent: { id: string }[] }): Promise<string[]> {
  const on = active()
  if (!on) return []
  const query = args.history.slice(-2).map((m) => m.text).join('\n').trim()
  const key = `${args.chatId}|${query}|${on.s.vectorTopK}|${on.s.vectorMinScore}`
  // A reply can rebuild its prompt more than once; the same question is not asked twice.
  if (last?.key === key) return last.result
  try {
    const result = await retrieveMemories(memoryDeps(on.cfg), query, {
      chatId: args.chatId,
      characterId: args.characterId,
      skipMessageIds: args.recent.map((m) => m.id),
      k: on.s.vectorTopK,
      minScore: on.s.vectorMinScore,
      chatMemory: on.s.vectorChatMemory,
    })
    last = { key, result }
    return result
  } catch (e) {
    console.warn('Memory search failed:', e)
    return []
  }
}

/** Adds the chat's new messages to its memory, in the background. */
export async function syncChatMemory(chatId: string): Promise<void> {
  const on = active()
  if (!on || !on.s.vectorChatMemory) return
  try {
    const messages = await messagesApi.listByChat(chatId)
    await indexMessages(
      memoryDeps(on.cfg),
      chatId,
      messages.map((m) => ({ id: m.id, name: m.name, text: m.text, failed: m.failed })),
      24,
      on.s.vectorChunkChars,
    )
  } catch (e) {
    console.warn('Saving the chat to memory failed:', e)
  }
}
