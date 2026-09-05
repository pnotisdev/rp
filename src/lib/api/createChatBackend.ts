import { KoboldClient } from './kobold'
import { OpenAICompatibleClient } from './openaiCompatible'
import type { ChatBackend, ChatBackendId } from './chatBackend'

export interface ChatBackendSettings {
  chatBackend: ChatBackendId
  /** KoboldCpp's own connection URL (Settings → Connection) — used when `chatBackend` is `'koboldcpp'`. */
  baseUrl: string
  chatBackendBaseUrl: string
  chatBackendApiKey: string
  chatBackendModel: string
}

/**
 * Section 8's "additional model backends" factory — the one place that decides which `ChatBackend`
 * implementation a generate call actually talks to, based on the user's Settings choice. Every call
 * site that used to do `new KoboldClient(baseUrl)` directly (the main chat loop, every background
 * judge/assist call — relationship scoring, choice suggestion, objective planning, outreach
 * messages, VN scene vision, character generation/regeneration) now goes through this instead, so
 * switching Settings to `'openai-compatible'` redirects the entire app in one place, not just the
 * main chat loop.
 *
 * The one deliberate exception is `useConnectionStatus`'s Settings → Connection health check, which
 * stays directly on `KoboldClient` — it reports the local KoboldCpp server's own status (version,
 * loaded model, chat-template detection), a concept a hosted API has no equivalent of.
 */
export function createChatBackend(settings: ChatBackendSettings): ChatBackend {
  if (settings.chatBackend === 'openai-compatible') {
    return new OpenAICompatibleClient(
      settings.chatBackendBaseUrl,
      settings.chatBackendApiKey,
      settings.chatBackendModel,
    )
  }
  return new KoboldClient(settings.baseUrl)
}
