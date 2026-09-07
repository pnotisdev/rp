import { KoboldClient } from './kobold'
import { OpenAICompatibleClient } from './openaiCompatible'
import { NovelAIClient } from './novelai'
import type { ChatBackend, ChatBackendId } from './chatBackend'

// Picks which `ChatBackend` implementation to use based on the user's Settings choice.

export interface ChatBackendSettings {
  chatBackend: ChatBackendId
  /** KoboldCpp's own connection URL (Settings → Connection) — used when `chatBackend` is `'koboldcpp'`. */
  baseUrl: string
  chatBackendBaseUrl: string
  chatBackendApiKey: string
  chatBackendModel: string
}

export function createChatBackend(settings: ChatBackendSettings): ChatBackend {
  if (settings.chatBackend === 'openai-compatible') {
    return new OpenAICompatibleClient(
      settings.chatBackendBaseUrl,
      settings.chatBackendApiKey,
      settings.chatBackendModel,
    )
  }
  if (settings.chatBackend === 'novelai') {
    // NovelAI has no base URL field — its two hosts are fixed per model (see novelai.ts).
    return new NovelAIClient(settings.chatBackendApiKey, settings.chatBackendModel)
  }
  return new KoboldClient(settings.baseUrl)
}
