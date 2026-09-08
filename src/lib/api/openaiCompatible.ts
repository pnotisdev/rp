import type { GenerateRequest } from './types'
import { KoboldApiError } from './types'
import { estimateTokens } from '@/lib/tokenEstimate'
import type { ChatBackend, ConnectionCheckResult } from './chatBackend'

// A single client for any provider that speaks the OpenAI Chat Completions wire format —
// OpenAI, OpenRouter, Groq, Together, local servers (llama.cpp, LM Studio, Ollama's OpenAI shim),
// and more. Does not attempt native Anthropic/Google wire formats; OpenRouter already re-exposes
// both through this same shape.
export class OpenAICompatibleClient implements ChatBackend {
  constructor(
    public baseUrl: string,
    private apiKey: string,
    private model: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    }
  }

  private url(): string {
    return this.baseUrl.replace(/\/+$/, '') + '/chat/completions'
  }

  /** Uses `params.messages` when the caller built one, else wraps `params.prompt` as a single user turn. */
  private body(params: GenerateRequest, stream: boolean): Record<string, unknown> {
    const messages = params.messages?.length ? params.messages : [{ role: 'user' as const, content: params.prompt }]
    const body: Record<string, unknown> = {
      model: this.model || 'gpt-4o-mini',
      messages,
      stream,
    }
    // Only fields with a real equivalent in the OpenAI Chat Completions contract are mapped;
    // KoboldCpp-specific sampler fields with no equivalent are silently dropped.
    if (typeof params.temperature === 'number') body.temperature = params.temperature
    if (typeof params.top_p === 'number') body.top_p = params.top_p
    if (typeof params.presence_penalty === 'number') body.presence_penalty = params.presence_penalty
    if (typeof params.frequency_penalty === 'number') body.frequency_penalty = params.frequency_penalty
    if (params.reasoning_effort) body.reasoning_effort = params.reasoning_effort
    if (params.verbosity) body.verbosity = params.verbosity
    // max_tokens is the widely-supported name; newer o1/o3/gpt-5-family models want
    // max_completion_tokens instead and reject this one — a known gap, not handled here.
    if (typeof params.max_length === 'number') body.max_tokens = params.max_length
    if (params.stop_sequence?.length) body.stop = params.stop_sequence
    return body
  }

  private async parseErrorBody(res: Response): Promise<string> {
    const text = await res.text().catch(() => '')
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } }
      return parsed.error?.message || text
    } catch {
      return text
    }
  }

  /** Appends a retry hint to a 429's own error message: the real `Retry-After` value if present, else a soft hedge (some providers' 429 text overclaims permanence). */
  private rateLimitHint(res: Response): string {
    const retryAfterSeconds = Number(res.headers.get('retry-after'))
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      const readable = retryAfterSeconds < 60 ? `${Math.ceil(retryAfterSeconds)}s` : `${Math.ceil(retryAfterSeconds / 60)}m`
      return ` (the provider says to retry in about ${readable})`
    }
    return ' (this can sometimes clear on its own within a minute or two, despite the wording above)'
  }

  async generate(params: GenerateRequest, signal?: AbortSignal): Promise<string> {
    let res: Response
    try {
      res = await fetch(this.url(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.body(params, false)),
        signal,
      })
    } catch (e) {
      if (signal?.aborted) throw e
      throw new KoboldApiError(`Could not reach ${this.baseUrl}. Is the base URL and network correct?`)
    }
    if (!res.ok) {
      const hint = res.status === 429 ? this.rateLimitHint(res) : ''
      throw new KoboldApiError(`Chat completion failed (${res.status}): ${(await this.parseErrorBody(res)).slice(0, 300)}${hint}`, res.status)
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content ?? ''
  }

  /** SSE streaming: splits on blank lines, reads `data:` lines, each payload `choices[0].delta.content`, ending on the `data: [DONE]` sentinel. */
  async generateStream(params: GenerateRequest, onToken: (token: string, full: string) => void, signal?: AbortSignal): Promise<string> {
    let res: Response
    try {
      res = await fetch(this.url(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.body(params, true)),
        signal,
      })
    } catch (e) {
      if (signal?.aborted) return ''
      throw new KoboldApiError(`Could not reach ${this.baseUrl} for streaming.`)
    }
    if (!res.ok || !res.body) {
      const hint = res.status === 429 ? this.rateLimitHint(res) : ''
      throw new KoboldApiError(`Chat completion stream failed (${res.status}): ${(await this.parseErrorBody(res)).slice(0, 300)}${hint}`)
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
          if (dataStr === '[DONE]') continue
          try {
            const parsed = JSON.parse(dataStr) as { choices?: { delta?: { content?: string } }[] }
            const token = parsed.choices?.[0]?.delta?.content
            if (typeof token === 'string' && token) {
              full += token
              onToken(token, full)
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
    return full
  }

  /** No universal introspection endpoint across OpenAI-compatible providers — always the caller's own fallback. */
  async getEffectiveMaxContext(fallback = 4096): Promise<number> {
    return fallback
  }

  /** No universal tokenizer endpoint either — the same estimate the rest of the app already falls back to whenever the real tokenizer is unreachable. */
  async tokenCount(text: string): Promise<{ count: number }> {
    return { count: estimateTokens(text) }
  }

  /** No server-side interrupt endpoint — the caller's own `AbortSignal` already stops the client-side read. */
  async abort(): Promise<void> {}

  /** Not a locally-loaded GGUF — nothing to compare the active instruct template against. */
  async getChatTemplate(): Promise<string | null> {
    return null
  }

  /** Settings → Connection's reachability+auth check, without a real (billed) chat completion. Uses `GET /models` (validates the key on most providers) except for OpenRouter and Nano-GPT, whose `/models` is public and returns 200 for any key — `/key` (OpenRouter) and the balance endpoint (Nano-GPT) are used there instead, and double as a usage/balance readout for the success detail. */
  async checkConnection(): Promise<ConnectionCheckResult> {
    const trimmed = this.baseUrl.replace(/\/+$/, '')
    if (!trimmed) return { ok: false, detail: 'No base URL set.' }
    if (trimmed.includes('nano-gpt.com')) return this.checkNanoGptBalance(trimmed)
    const isOpenRouter = trimmed.includes('openrouter.ai')
    const url = isOpenRouter ? `${trimmed}/key` : `${trimmed}/models`
    let res: Response
    try {
      res = await fetch(url, { headers: this.headers() })
    } catch {
      return { ok: false, detail: `Could not reach ${this.baseUrl}.` }
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, detail: 'The API key was rejected.' }
    }
    if (!res.ok) {
      return { ok: false, detail: `Unexpected response (${res.status}).` }
    }
    if (isOpenRouter) {
      try {
        const data = (await res.json()) as {
          data?: { is_free_tier?: boolean; usage?: number; limit?: number | null }
        }
        const key = data.data
        if (key) {
          const spent = typeof key.usage === 'number' ? `$${key.usage.toFixed(2)} used` : undefined
          const cap = typeof key.limit === 'number' ? ` of $${key.limit} limit` : ''
          const tier = key.is_free_tier ? 'Free-tier key' : undefined
          return { ok: true, detail: spent ? `${spent}${cap}` : tier }
        }
      } catch {
        // Already authenticated (status checked above) — an unparseable body just means no bonus detail.
      }
    }
    return { ok: true }
  }

  /**
   * Nano-GPT's key check: `POST {host}/api/check-balance` (deliberately not under `/v1`), with the
   * key as `x-api-key`, returning `{ usd_balance, nano_balance, nanoDepositAddress }`. A bad key
   * comes back non-2xx (live: 401 for a malformed key, with its own error body), so any non-ok
   * response here is treated as a rejected key. The USD balance becomes the success detail,
   * mirroring OpenRouter's usage readout.
   */
  private async checkNanoGptBalance(trimmed: string): Promise<ConnectionCheckResult> {
    const balanceUrl = `${trimmed.replace(/\/v1$/, '')}/check-balance`
    let res: Response
    try {
      res = await fetch(balanceUrl, { method: 'POST', headers: { ...this.headers(), 'x-api-key': this.apiKey } })
    } catch {
      return { ok: false, detail: `Could not reach ${this.baseUrl}.` }
    }
    if (!res.ok) return { ok: false, detail: 'The API key was rejected.' }
    try {
      const data = (await res.json()) as { usd_balance?: string | number }
      const usd = Number(data.usd_balance)
      if (Number.isFinite(usd)) return { ok: true, detail: `$${usd.toFixed(2)} balance` }
    } catch {
      // Already authenticated (status ok) — an unparseable body just means no balance figure to show.
    }
    return { ok: true }
  }
}
