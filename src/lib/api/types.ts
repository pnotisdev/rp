// Shapes for the KoboldCpp / KoboldAI United API (api/v1 + api/extra).
// Field names match the wire format exactly since we serialize these directly.

export interface GenerationParams {
  max_context_length: number
  max_length: number
  temperature: number
  top_p: number
  top_k: number
  top_a?: number
  min_p: number
  typical: number
  tfs: number
  rep_pen: number
  rep_pen_range: number
  rep_pen_slope: number
  presence_penalty?: number
  dry_multiplier?: number
  dry_base?: number
  dry_allowed_length?: number
  dry_sequence_breakers?: string[]
  mirostat?: number
  mirostat_tau?: number
  mirostat_eta?: number
  sampler_order?: number[]
  stop_sequence?: string[]
  banned_tokens?: string[]
  grammar?: string
  trim_stop?: boolean
}

/** One turn in a native chat-completion request — see `GenerateRequest.messages`. */
export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * The user's own framing after trying section 8 live: "text completion and chat completion
 * presets are different" (SillyTavern keeps two entirely separate preset systems for exactly this
 * reason). This is the chat-completion-native counterpart to `GenerationParams` — real OpenAI Chat
 * Completions concepts (`frequency_penalty`, `reasoning_effort`, `verbosity`) instead of KoboldCpp
 * sampler internals (`top_k`/`min_p`/`rep_pen`/DRY/mirostat/...) that have no equivalent on a
 * hosted API and were previously just silently dropped by `OpenAICompatibleClient`. Stored
 * separately from `sampler` (`useSettingsStore.chatCompletionSampler`) so switching backends never
 * fights over one shared params object.
 */
export interface ChatCompletionSamplerParams {
  temperature: number
  top_p: number
  frequency_penalty: number
  presence_penalty: number
  /** 'auto' omits the field entirely — most providers treat an absent value as their own default. */
  reasoningEffort: 'auto' | 'low' | 'medium' | 'high'
  /** OpenAI's newer GPT-5-family knob. 'auto' omits the field. */
  verbosity: 'auto' | 'low' | 'medium' | 'high'
}

export const DEFAULT_CHAT_COMPLETION_SAMPLER: ChatCompletionSamplerParams = {
  temperature: 1,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  reasoningEffort: 'auto',
  verbosity: 'auto',
}

export interface GenerateRequest extends Partial<GenerationParams> {
  prompt: string
  max_length: number
  max_context_length: number
  quiet?: boolean
  genkey?: string
  /** Base64-encoded images (no data: prefix), for vision-capable models with a loaded mmproj. */
  images?: string[]
  /**
   * Section 8's "additional model backends": every call site already builds `prompt` as one flat,
   * instruct-template-formatted string — the shape KoboldCpp's own text-completion API wants, and
   * `KoboldClient` ignores this field entirely. A hosted chat-completion backend (OpenAI/Claude/
   * Gemini/OpenRouter/...) wants a proper `{role, content}[]` array instead; when a caller supplies
   * one, `OpenAICompatibleClient` sends it as-is. Callers that don't (every background judge/assist
   * call — relationship scoring, choice suggestion, memory summary, ...) still work against a
   * hosted backend without any changes on their part: it falls back to wrapping `prompt` as a
   * single user message, which is correct/complete, just not split into a proper system turn the
   * way the main chat generation path (which does supply this) is.
   */
  messages?: ChatCompletionMessage[]
  /**
   * `ChatCompletionSamplerParams`'s three fields with no `GenerationParams` equivalent —
   * `temperature`/`top_p`/`presence_penalty` already exist there and are reused as-is.
   * `KoboldClient` ignores all three; `OpenAICompatibleClient` maps them directly.
   */
  frequency_penalty?: number
  reasoning_effort?: 'low' | 'medium' | 'high'
  verbosity?: 'low' | 'medium' | 'high'
}

export interface GenerateResponse {
  results: { text: string; finish_reason?: string }[]
}

export interface GenerateStreamChunk {
  token: string
}

export interface KoboldModelInfo {
  result: string
}

export interface KoboldVersionInfo {
  result: string
  version: string
}

/**
 * `/api/extra/perf` — reports the MOST RECENT completed generation, not a running/live figure.
 * The original shape here (`last_process`/`last_eval`/`last_seconds`) never actually matched a
 * real KoboldCpp response — caught only now, while wiring up the Generation HUD (section 15),
 * since nothing had called `getPerf()` before. Fields below are what a live 1.118.1 server
 * actually returns; the index signature covers the rest (image/TTS/transcribe counters, uptime,
 * horde fields) that this app has no use for yet.
 */
export interface PerfInfo {
  last_process_time: number
  last_eval_time: number
  last_process_speed: number
  last_eval_speed: number
  last_token_count: number
  last_input_count: number
  total_gens: number
  stop_reason: number
  queue: number
  idle: number
  [k: string]: unknown
}

export class KoboldApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
    this.name = 'KoboldApiError'
  }
}
