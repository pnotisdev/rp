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

/** Chat-completion-native counterpart to `GenerationParams` — real OpenAI Chat Completions fields instead of KoboldCpp sampler internals. Stored separately from `sampler` so switching backends never fights over one shared params object. */
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
  /** Requested by structured assists; currently mapped only for OpenMayhem models whose contract supports it. */
  jsonOutput?: boolean
  prompt: string
  max_length: number
  max_context_length: number
  quiet?: boolean
  genkey?: string
  /** Base64-encoded images (no data: prefix), for vision-capable models with a loaded mmproj. */
  images?: string[]
  /** Proper `{role, content}[]` turns for a hosted chat-completion backend; `KoboldClient` ignores this. Callers that only build `prompt` (most background judge/assist calls) fall back to it being wrapped as a single user message. */
  messages?: ChatCompletionMessage[]
  /** `ChatCompletionSamplerParams` fields with no `GenerationParams` equivalent. `KoboldClient` ignores all three; `OpenAICompatibleClient` maps them directly. */
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

/** `/api/extra/perf` — reports the MOST RECENT completed generation, not a running/live figure. Index signature covers the rest (image/TTS/transcribe counters, uptime, horde fields) this app has no use for. */
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
