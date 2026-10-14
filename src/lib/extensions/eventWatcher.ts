// Turns data changes (new messages, relationship state, the open chat) into events for subscribed extensions.

import { messagesApi, subscribe } from '@/lib/api/client'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { emitHostEvent, hasSubscribers } from './events'
import { appHostApi } from './hostApi'

/** Starts watching; returns a stop function. Does no work while no extension subscribes to an event. */
export function startEventWatchers(): () => void {
  const seen = new Set<string>()
  let seenChat: string | null = null
  let lastState = ''
  let stateChat: string | null = null
  let checking = false

  async function checkMessages(): Promise<void> {
    if (!hasSubscribers('message')) return
    const chatId = useSettingsStore.getState().activeChatId
    if (!chatId) return
    const messages = await messagesApi.listByChat(chatId).catch(() => null)
    if (!messages) return
    if (seenChat !== chatId) {
      seenChat = chatId
      seen.clear()
      for (const m of messages) if (m.text.trim()) seen.add(m.id)
      return
    }
    for (const m of messages) {
      if (seen.has(m.id) || !m.text.trim() || m.failed) continue
      seen.add(m.id)
      emitHostEvent('message', { id: m.id, chatId, role: m.role, name: m.name, text: m.text, createdAt: m.createdAt })
    }
  }

  async function checkState(): Promise<void> {
    if (!hasSubscribers('state') || checking) return
    checking = true
    try {
      const chatId = useSettingsStore.getState().activeChatId
      const state = await appHostApi.stateGet().catch(() => null)
      const signature = JSON.stringify(state)
      const baseline = stateChat !== chatId
      stateChat = chatId
      if (signature !== lastState) {
        lastState = signature
        if (!baseline && state) emitHostEvent('state', state)
      }
    } finally {
      checking = false
    }
  }

  const stopStore = useSettingsStore.subscribe((s, prev) => {
    if (s.activeChatId === prev.activeChatId) return
    emitHostEvent('chat', { chatId: s.activeChatId })
    void checkMessages()
    void checkState()
  })
  const stopChats = subscribe('chats', () => void checkState())
  const stopMessages = subscribe('messages', () => void checkMessages())
  return () => {
    stopStore()
    stopChats()
    stopMessages()
  }
}
