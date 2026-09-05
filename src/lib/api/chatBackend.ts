import type { GenerateRequest } from './types'

/**
 * Section 8's "additional model backends" — one interface both the existing `KoboldClient` and a
 * new hosted-provider client implement, the same "one abstraction, many providers" shape
 * `ttsProviders.ts` already uses for text-to-speech. Deliberately narrow: only the methods every
 * real call site (the main chat loop, every background judge/assist call, character-field
 * regeneration) actually calls. KoboldCpp-specific status/diagnostics (`getVersion`, `getPerf`,
 * `getMaxContextLength`, ...) stay directly on `KoboldClient` — they back the Connection settings
 * tab's own KoboldCpp-specific status display, not something a hosted API has an equivalent of.
 */
export interface ChatBackend {
  generate(params: GenerateRequest, signal?: AbortSignal): Promise<string>
  generateStream(params: GenerateRequest, onToken: (token: string, full: string) => void, signal?: AbortSignal): Promise<string>
  /** The model's actual max context, cached — or a sane fallback for a backend with no introspection endpoint. */
  getEffectiveMaxContext(fallback?: number): Promise<number>
  tokenCount(text: string): Promise<{ count: number }>
  /** Best-effort server-side abort — a no-op for a backend with no such endpoint; the caller's own `AbortSignal` already stops the client-side read either way. */
  abort(genkey: string): Promise<void>
  /** The loaded model's own chat template, for the instruct-template-mismatch nudge — meaningless (and always null) for a backend that isn't running a local GGUF. */
  getChatTemplate(): Promise<string | null>
}

export type ChatBackendId = 'koboldcpp' | 'openai-compatible'

export const CHAT_BACKEND_LABELS: Record<ChatBackendId, string> = {
  koboldcpp: 'KoboldCpp (local)',
  'openai-compatible': 'OpenAI-compatible (OpenAI, OpenRouter, Groq, local servers, ...)',
}

export interface ChatBackendConfig {
  backend: ChatBackendId
  /** 'openai-compatible' only. */
  baseUrl: string
  apiKey: string
  model: string
}

export interface KnownChatProvider {
  id: string
  label: string
  baseUrl: string
  /** Shown as the Model field's placeholder once this provider is picked — a realistic id, not a promise it's the best/cheapest option there. */
  modelExample: string
}

/**
 * SillyTavern-style provider picker (user's own reference, after live-testing section 8): each
 * entry's `baseUrl` is that vendor's own documented OpenAI-compatible endpoint, so picking one
 * pre-fills Settings → Connection instead of the user needing to know/paste it themselves. Honesty
 * note matching the rest of section 8: only OpenRouter's entry has actually been exercised against
 * a real account this session (see ROADMAP.md #121/#122) — the rest are correct per each vendor's
 * own docs but not independently re-verified here. "Custom" isn't in this list; it's simply
 * whatever the user types that matches none of these.
 */
export const KNOWN_CHAT_PROVIDERS: KnownChatProvider[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelExample: 'gpt-4o-mini' },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelExample: 'openrouter/anthropic/claude-3.5-sonnet',
  },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', modelExample: 'llama-3.3-70b-versatile' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', modelExample: 'mistral-large-latest' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', modelExample: 'deepseek-chat' },
  {
    id: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    modelExample: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    modelExample: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
  },
  {
    id: 'google-ai-studio',
    label: 'Google AI Studio (Gemini)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelExample: 'gemini-2.0-flash',
  },
  { id: 'xai', label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', modelExample: 'grok-2-latest' },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    modelExample: 'whatever you loaded in LM Studio',
  },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', modelExample: 'llama3.2' },
]
