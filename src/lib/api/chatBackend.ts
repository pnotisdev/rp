import type { GenerateRequest } from './types'

// Shared interface implemented by `KoboldClient` and every hosted-provider client, plus the
// provider metadata (ids, labels, known OpenAI-compatible providers) used to pick between them.

export interface ChatBackend {
  /** Opt JSON-producing assists into an object envelope and a validated JSON-mode request. */
  readonly prefersJsonObject?: boolean
  generate(params: GenerateRequest, signal?: AbortSignal): Promise<string>
  generateStream(params: GenerateRequest, onToken: (token: string, full: string) => void, signal?: AbortSignal): Promise<string>
  /** The model's actual max context, cached — or a sane fallback for a backend with no introspection endpoint. */
  getEffectiveMaxContext(fallback?: number): Promise<number>
  tokenCount(text: string): Promise<{ count: number }>
  /** Best-effort server-side abort — a no-op for a backend with no such endpoint. */
  abort(genkey: string): Promise<void>
  /** The loaded model's own chat template — always null for a backend that isn't running a local GGUF. */
  getChatTemplate(): Promise<string | null>
}

/** Lightweight reachability+auth probe implemented by every non-KoboldCpp backend, for Settings → Connection. */
export interface ConnectionCheckResult {
  ok: boolean
  /** A short, specific reason for a failure — undefined for success or an unexplained failure. */
  detail?: string
}

export type ChatBackendId = 'koboldcpp' | 'openai-compatible' | 'novelai'

export const CHAT_BACKEND_LABELS: Record<ChatBackendId, string> = {
  koboldcpp: 'KoboldCpp (local)',
  'openai-compatible': 'OpenAI-compatible (OpenAI, OpenRouter, Groq, local servers, ...)',
  novelai: 'NovelAI (hosted, subscription)',
}

/** NovelAI's own two current text models this app supports. */
export const NOVELAI_MODELS = [
  { id: 'kayra-v1', label: 'Kayra' },
  { id: 'clio-v1', label: 'Clio' },
] as const

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
  /** Shown as the Model field's placeholder once this provider is picked. */
  modelExample: string
}

/** SillyTavern-style provider picker: picking one pre-fills Settings → Connection's base URL. */
export const KNOWN_CHAT_PROVIDERS: KnownChatProvider[] = [
  { id: 'openmayhem', label: 'OpenMayhem', baseUrl: 'https://api.openmayhem.ai/v1', modelExample: 'hauhaucs/qwen3.6-35b-a3b-uncensored' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelExample: 'gpt-4o-mini' },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelExample: 'openrouter/anthropic/claude-3.5-sonnet',
  },
  {
    id: 'nano-gpt',
    label: 'Nano-GPT',
    baseUrl: 'https://nano-gpt.com/api/v1',
    modelExample: 'anthropic/claude-sonnet-5',
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
