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

export interface GenerateRequest extends Partial<GenerationParams> {
  prompt: string
  max_length: number
  max_context_length: number
  quiet?: boolean
  genkey?: string
  /** Base64-encoded images (no data: prefix), for vision-capable models with a loaded mmproj. */
  images?: string[]
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
