import type { GenerateRequest } from './types'
import { KoboldApiError } from './types'
import { estimateTokens } from '@/lib/tokenEstimate'
import type { ChatBackend, ConnectionCheckResult } from './chatBackend'

const TEXT_NOVELAI = 'https://text.novelai.net'
const API_NOVELAI = 'https://api.novelai.net'

/** Kayra (and Erato, not supported here) serve off a different host than every older model. */
function baseUrlForModel(model: string): string {
  return model.includes('kayra') || model.includes('erato') ? TEXT_NOVELAI : API_NOVELAI
}

// NovelAI's hosted text-generation backend (Kayra, Clio). Built to the documented/reverse-
// engineered contract, never run against a real account — sanity-check the first real call.
// Sends `input` as plain text (`use_string: true`); NovelAI's tokenizer (server-side, see
// `server/novelaiTokenizer.ts`) is only needed for `stop_sequences`, which want token ids.
// Deliberately unsupported: Erato, and `bad_words_ids`/`logit_bias_exp` preset tuning. The SSE
// streaming event format is an unconfirmed guess; `generateStream` falls back to `generate()`
// if a stream ever produces zero tokens.
export class NovelAIClient implements ChatBackend {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` }
  }

  /** Converts plain-string stop sequences to the token-id arrays NovelAI wants, via the server's bundled tokenizer. Best-effort: any failure just means no stop sequences rather than a failed generation. */
  private async tokenizeStopSequences(stopSequences: string[] | undefined): Promise<number[][] | undefined> {
    if (!stopSequences?.length) return undefined
    try {
      const results = await Promise.all(
        stopSequences.map(async (text) => {
          const res = await fetch('/api/novelai/tokenize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, model: this.model }),
          })
          if (!res.ok) return null
          const data = (await res.json()) as { ids?: number[] }
          return data.ids?.length ? data.ids : null
        }),
      )
      const valid = results.filter((r): r is number[] => !!r)
      return valid.length ? valid : undefined
    } catch {
      return undefined
    }
  }

  /** Field names and defaults (`phrase_rep_pen`, `prefix`, `use_cache`, `return_full_text`) come from NovelAI's own bundled preset; a few have no slider in this app so they're fixed constants. */
  private async body(params: GenerateRequest): Promise<Record<string, unknown>> {
    return {
      input: params.prompt,
      model: this.model,
      parameters: {
        use_string: true,
        temperature: params.temperature ?? 1,
        max_length: params.max_length,
        min_length: 1,
        tail_free_sampling: params.tfs ?? 1,
        repetition_penalty: params.rep_pen ?? 1,
        repetition_penalty_range: params.rep_pen_range ?? 0,
        repetition_penalty_slope: params.rep_pen_slope ?? 0,
        repetition_penalty_frequency: 0,
        repetition_penalty_presence: params.presence_penalty ?? 0,
        top_a: params.top_a ?? 0,
        top_p: params.top_p ?? 1,
        top_k: params.top_k ?? 0,
        typical_p: params.typical ?? 1,
        mirostat_lr: params.mirostat_eta ?? 1,
        mirostat_tau: params.mirostat_tau ?? 0,
        min_p: params.min_p ?? 0,
        phrase_rep_pen: 'aggressive',
        prefix: 'vanilla',
        use_cache: false,
        return_full_text: false,
        generate_until_sentence: false,
        stop_sequences: await this.tokenizeStopSequences(params.stop_sequence),
      },
    }
  }

  private async parseErrorBody(res: Response): Promise<string> {
    return res.text().catch(() => '')
  }

  async generate(params: GenerateRequest, signal?: AbortSignal): Promise<string> {
    let res: Response
    try {
      res = await fetch(`${baseUrlForModel(this.model)}/ai/generate`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(await this.body(params)),
        signal,
      })
    } catch (e) {
      if (signal?.aborted) throw e
      throw new KoboldApiError('Could not reach NovelAI. Check your network connection.')
    }
    if (!res.ok) {
      throw new KoboldApiError(`NovelAI generation failed (${res.status}): ${(await this.parseErrorBody(res)).slice(0, 300)}`, res.status)
    }
    const data = (await res.json()) as { output?: string }
    return data.output ?? ''
  }

  /** See the class doc comment: the response event format here is a best-effort guess, with a fallback to `generate()` if it ever produces zero tokens. */
  async generateStream(params: GenerateRequest, onToken: (token: string, full: string) => void, signal?: AbortSignal): Promise<string> {
    let res: Response
    try {
      res = await fetch(`${baseUrlForModel(this.model)}/ai/generate-stream`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(await this.body(params)),
        signal,
      })
    } catch (e) {
      if (signal?.aborted) return ''
      throw new KoboldApiError('Could not reach NovelAI for streaming.')
    }
    if (!res.ok || !res.body) {
      throw new KoboldApiError(`NovelAI generate-stream failed (${res.status}): ${(await this.parseErrorBody(res)).slice(0, 300)}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let sepIndex: number
        while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sepIndex)
          buffer = buffer.slice(sepIndex + 2)

          const dataLines = rawEvent
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
          if (dataLines.length === 0) continue
          const dataStr = dataLines.join('\n')
          try {
            const parsed = JSON.parse(dataStr) as { token?: string }
            if (typeof parsed.token === 'string') {
              full += parsed.token
              onToken(parsed.token, full)
            }
          } catch {
            // ignore malformed/keepalive events
          }
        }
      }
    } catch (e) {
      if (signal?.aborted) return full
      throw e
    }

    // A stream that produced no text at all likely means the guessed event format is wrong.
    if (!full && !signal?.aborted) {
      return this.generate(params, signal)
    }
    return full
  }

  /** Real per-tier context caps aren't exposed by any endpoint here — always the caller's own fallback. */
  async getEffectiveMaxContext(fallback = 4096): Promise<number> {
    return fallback
  }

  /** Real token count via the same local tokenizer `stop_sequences` uses, when the model has one bundled — the generic character-estimate otherwise (Erato, or the local server unreachable). */
  async tokenCount(text: string): Promise<{ count: number }> {
    try {
      const res = await fetch('/api/novelai/tokenize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model: this.model }),
      })
      if (res.ok) {
        const data = (await res.json()) as { ids?: number[] }
        if (data.ids) return { count: data.ids.length }
      }
    } catch {
      // fall through to the estimate
    }
    return { count: estimateTokens(text) }
  }

  /** No server-side interrupt endpoint found in any reference client — the caller's own `AbortSignal` already stops the client-side read either way. */
  async abort(): Promise<void> {}

  /** Not a locally-loaded GGUF — nothing to compare the active instruct template against. */
  async getChatTemplate(): Promise<string | null> {
    return null
  }

  /** Settings → Connection's reachability+auth check, via `GET /user/subscription` (costs no generation quota). */
  async checkConnection(): Promise<ConnectionCheckResult> {
    if (!this.apiKey.trim()) return { ok: false, detail: 'No API key set.' }
    let res: Response
    try {
      res = await fetch(`${API_NOVELAI}/user/subscription`, { headers: this.headers() })
    } catch {
      return { ok: false, detail: 'Could not reach NovelAI.' }
    }
    if (res.status === 401) return { ok: false, detail: 'The API key was rejected.' }
    if (!res.ok) return { ok: false, detail: `Unexpected response (${res.status}).` }
    return { ok: true }
  }
}
