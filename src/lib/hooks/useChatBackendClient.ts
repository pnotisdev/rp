import { useMemo } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { createChatBackend } from '@/lib/api/createChatBackend'
import { invalidateTokenCache } from '@/lib/tokenCache'
import type { ChatBackend } from '@/lib/api/chatBackend'

/** Section 8's "additional model backends" */
export function useChatBackendClient(): ChatBackend {
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const chatBackend = useSettingsStore((s) => s.chatBackend)
  const chatBackendBaseUrl = useSettingsStore((s) => s.chatBackendBaseUrl)
  const chatBackendApiKey = useSettingsStore((s) => s.chatBackendApiKey)
  const chatBackendModel = useSettingsStore((s) => s.chatBackendModel)
  return useMemo(() => {
    // A different backend or model means a different tokenizer, so every memoized token count from
    // the previous one is now wrong.
    invalidateTokenCache()
    return createChatBackend({ chatBackend, baseUrl, chatBackendBaseUrl, chatBackendApiKey, chatBackendModel })
  }, [chatBackend, baseUrl, chatBackendBaseUrl, chatBackendApiKey, chatBackendModel])
}
