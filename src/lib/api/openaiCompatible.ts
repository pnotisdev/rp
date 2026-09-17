import type { GenerateRequest } from './types'
import { KoboldApiError } from './types'
import { estimateTokens } from '@/lib/tokenEstimate'
import type { ChatBackend, ConnectionCheckResult } from './chatBackend'
import { isOpenMayhem, loadOpenMayhemModels, OPENMAYHEM_PROXY, openMayhemRequestBody } from './openMayhem'

/**
 * OpenRouter increasingly routes its free tier through reasoning models, and reasoning is pure
 * overhead for this app — a roleplay reply is never improved by a hidden "thinking" phase the
 * player never sees, and it comes directly out of `max_tokens`. Left uncapped (the default for
 * most of these models when no `reasoning` field is sent at all), a small reply budget gets spent
 * entirely on reasoning tokens and the model never reaches the actual reply — `generate`/
 * `generateStream` below both read only `content`, so that shows up as a silent empty completion,
 * indistinguishable from the model just declining to answer.
 *
 * `reasoning` is OpenRouter's own unified control (not a standard OpenAI Chat Completions field),
 * so it's only sent to OpenRouter itself — an arbitrary extra top-level field is usually harmless
 * against another provider's endpoint, but there's no upside to sending a directive that only one
 * provider defined.
 */
function isOpenRouter(baseUrl: string): boolean {
  try {
    return /(^|\.)openrouter\.ai$/.test(new URL(baseUrl.trim()).hostname)
  } catch {
    return false
  }
}

// A single client for any provider that speaks the OpenAI Chat Completions wire format —
// OpenAI, OpenRouter, Groq, Together, local servers (llama.cpp, LM Studio, Ollama's OpenAI shim),
// and more. Does not attempt native Anthropic/Google wire formats; OpenRouter already re-exposes
// both through this same shape.
export class OpenAICompatibleClient implements ChatBackend {
  get prefersJsonObject(): boolean { return isOpenMayhem(this.baseUrl) }
  constructor(
    public baseUrl: string,
    private apiKey: string,
    private model: string,
  ) {}

  /**
   * OpenAI renamed `max_tokens` to `max_completion_tokens` for its reasoning models (o1/o3/o4-mini)
   * and has since widened that to at least some GPT-5-family models too — the exact cutoff is a
   * moving target OpenAI hasn't published as a queryable capability, and every other project
   * hitting this (opencode, crush, several LangChain issues) has landed on the same conclusion:
   * there's no clean way to know ahead of time which name a given model wants.
   *
   * So this doesn't try to guess from the model name. It sends the widely-supported `max_tokens`
   * first, same as always — every other provider `OpenAICompatibleClient` talks to (Groq, Together,
   * local llama.cpp/LM Studio/Ollama, and most of OpenAI's own catalog) still expects exactly that
   * name, so guessing `max_completion_tokens` by default would trade one provider's rejection for
   * silently uncapped replies everywhere else `max_completion_tokens` isn't recognised. Only on the
   * one specific 400 OpenAI returns for this — matched by message, not by status code alone, so an
   * unrelated 400 never trips it — does it flip to `max_completion_tokens` and redo that one request;
   * `usesMaxCompletionTokens` then makes the switch stick for every later call this instance makes
   * (the client is memoized per model/provider by `useChatBackendClient`, so this is a one-time cost
   * per model, not a retry on every single turn).
   */
  private usesMaxCompletionTokens = false

  private isMaxTokensParamError(message: string): boolean {
    const m = message.toLowerCase()
    return m.includes('max_tokens') && m.includes('max_completion_tokens')
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    }
  }

  private url(): string {
    if (isOpenMayhem(this.baseUrl)) return `${OPENMAYHEM_PROXY}/chat/completions`
    return this.baseUrl.replace(/\/+$/, '') + '/chat/completions'
  }

  /** Uses `params.messages` when the caller built one, else wraps `params.prompt` as a single user turn. */
  private body(params: GenerateRequest, stream: boolean): Record<string, unknown> {
    const messages = params.messages?.length ? params.messages : [{ role: 'user' as const, content: params.prompt }]
    const body: Record<string, unknown> = {
      model: this.model || (isOpenMayhem(this.baseUrl) ? '' : 'gpt-4o-mini'),
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
    // See `isOpenRouter`'s doc comment. An explicit effort still wins (translated into OpenRouter's
    // own shape alongside the OpenAI-style field above, so either convention reaches the model);
    // "Auto" — no explicit choice made — means "off" here, not "let the provider pick its own
    // default", because that default is what was silently eating the whole reply budget.
    if (isOpenRouter(this.baseUrl)) {
      body.reasoning = params.reasoning_effort ? { effort: params.reasoning_effort } : { enabled: false }
    }
    // See `usesMaxCompletionTokens`'s doc comment — starts as the widely-supported `max_tokens`;
    // only becomes `max_completion_tokens` after that exact rejection has actually been seen.
    if (typeof params.max_length === 'number') {
      body[this.usesMaxCompletionTokens ? 'max_completion_tokens' : 'max_tokens'] = params.max_length
    }
    if (params.stop_sequence?.length) body.stop = params.stop_sequence
    if (params.jsonOutput && this.prefersJsonObject) body.response_format = { type: 'json_object' }
    return body
  }

  private async parseErrorBody(res: Response): Promise<string> {
    const text = await res.text().catch(() => '')
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string }
      return parsed.error?.message || parsed.message || text
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

  /**
   * The `reasoning: {enabled: false}` request above is a request, not a guarantee — a model that
   * can't take the hint (or isn't reached through OpenRouter at all) still burns the whole
   * `max_tokens` budget on reasoning and returns empty `content`. An ordinary empty `content` is
   * left to whatever the caller already does with one (unchanged); this only intervenes for the one
   * case that looks identical to that but has a completely different fix — more reply budget, or a
   * model without a "thinking" step — which is worth surfacing rather than leaving indistinguishable
   * from the model just declining to answer.
   */
  private reasoningExhaustedError(reasoningChars: number): KoboldApiError {
    return new KoboldApiError(
      `The model spent its whole reply budget on hidden reasoning and never wrote an actual reply (${reasoningChars} reasoning characters, 0 in the reply). Try a larger Reply length, or a model without a "thinking" step.`,
    )
  }

  /**
   * The fetch + error-classification shared by `generate` and `generateStream` — including the
   * one-time `max_tokens` -> `max_completion_tokens` retry (see `usesMaxCompletionTokens`'s doc
   * comment). Returns an `ok` `Response` with its body untouched, for the caller to read as JSON or
   * as a stream; throws a `KoboldApiError` for anything that isn't recoverable this way.
   */
  private async postChatCompletion(params: GenerateRequest, stream: boolean, signal?: AbortSignal): Promise<Response> {
    const unreachableMessage = stream ? `Could not reach ${this.baseUrl} for streaming.` : `Could not reach ${this.baseUrl}. Is the base URL and network correct?`
    const failedMessage = stream ? 'Chat completion stream failed' : 'Chat completion failed'

    for (let attempt = 0; attempt < 2; attempt++) {
      const rawBody = this.body(params, stream)
      const body = isOpenMayhem(this.baseUrl) ? await openMayhemRequestBody(rawBody) : rawBody
      let res: Response
      try {
        res = await fetch(this.url(), { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal })
      } catch (e) {
        if (signal?.aborted) throw e
        throw new KoboldApiError(unreachableMessage)
      }
      if (res.ok) return res

      const errorText = (await this.parseErrorBody(res)).slice(0, 300)
      if (attempt === 0 && !this.usesMaxCompletionTokens && this.isMaxTokensParamError(errorText)) {
        this.usesMaxCompletionTokens = true
        continue
      }
      const hint = res.status === 429 ? this.rateLimitHint(res) : ''
      throw new KoboldApiError(`${failedMessage} (${res.status}): ${errorText}${hint}`, res.status)
    }
    // Unreachable — the loop always either returns or throws — but keeps the return type honest.
    throw new KoboldApiError(`${failedMessage}: retry did not resolve.`)
  }

  async generate(params: GenerateRequest, signal?: AbortSignal): Promise<string> {
    const res = await this.postChatCompletion(params, false, signal)
    const data = (await res.json()) as {
      choices?: { message?: { content?: string; reasoning?: string; reasoning_content?: string } }[]
    }
    const message = data.choices?.[0]?.message
    const content = message?.content ?? ''
    if (isOpenMayhem(this.baseUrl) && !content.trim()) {
      throw new KoboldApiError('OpenMayhem returned no reply text. Check the model and response token limit; generation may still have used credit.')
    }
    // `reasoning_content` is DeepSeek's own name for the same idea when reached directly (not through
    // OpenRouter's `reasoning`) — checked either way so this isn't tied to one provider's wire format.
    const reasoning = message?.reasoning || message?.reasoning_content || ''
    if (!content.trim() && reasoning.trim()) throw this.reasoningExhaustedError(reasoning.length)
    return content
  }

  /** SSE streaming: splits on blank lines, reads `data:` lines, each payload `choices[0].delta.content`, ending on the `data: [DONE]` sentinel. */
  async generateStream(params: GenerateRequest, onToken: (token: string, full: string) => void, signal?: AbortSignal): Promise<string> {
    let res: Response
    try {
      res = await this.postChatCompletion(params, true, signal)
    } catch (e) {
      // Matches this method's own pre-existing contract (distinct from `generate`'s, which throws):
      // an abort before the request landed resolves quietly rather than surfacing as a failure.
      if (signal?.aborted) return ''
      throw e
    }
    if (!res.body) {
      throw new KoboldApiError(`Chat completion stream failed: ${this.baseUrl} returned no response body.`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''
    // Never surfaced as reply text (`onToken` is never called with it) — tracked only so an
    // all-reasoning, no-content stream can be told apart from a model that legitimately sent nothing.
    let reasoningChars = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')

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
          let parsed: {
            error?: { message?: string }
            choices?: { delta?: { content?: string; reasoning?: string; reasoning_content?: string } }[]
          }
          try { parsed = JSON.parse(dataStr) } catch { continue }
          if (!parsed || typeof parsed !== 'object') continue
          if (parsed.error) throw new KoboldApiError(parsed.error.message || 'The provider failed while streaming the reply.')
          const delta = parsed.choices?.[0]?.delta
          const token = delta?.content
          if (typeof token === 'string' && token) {
            full += token
            onToken(token, full)
          }
          const reasoningToken = delta?.reasoning || delta?.reasoning_content
          if (typeof reasoningToken === 'string') reasoningChars += reasoningToken.length
        }
      }
    } catch (e) {
      if (signal?.aborted) return full
      throw e
    }
    if (isOpenMayhem(this.baseUrl) && !full.trim()) {
      throw new KoboldApiError('OpenMayhem returned no reply text. Check the model and response token limit; generation may still have used credit.')
    }
    if (!full.trim() && reasoningChars > 0) throw this.reasoningExhaustedError(reasoningChars)
    return full
  }

  /** OpenMayhem publishes context metadata; other providers retain the caller's fallback. */
  async getEffectiveMaxContext(fallback = 4096): Promise<number> {
    if (isOpenMayhem(this.baseUrl)) {
      try {
        const context = (await loadOpenMayhemModels()).find((m) => m.id === this.model)?.context_length
        if (typeof context === 'number' && Number.isFinite(context) && context > 0) return Math.floor(context)
      } catch { /* Keep generation's existing fallback when metadata is unavailable. */ }
    }
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
    if (isOpenMayhem(this.baseUrl)) {
      if (!this.apiKey.trim()) return { ok: false, detail: 'Enter your OpenMayhem API key.' }
      try {
        const models = await loadOpenMayhemModels()
        const model = models.find((m) => m.id === this.model)
        if (!model) return { ok: false, detail: 'Choose a model from the OpenMayhem chat catalog.' }
        if (model.availability === 'offline') return { ok: false, detail: 'This model has no providers online. Choose another model or check again later.' }
        return { ok: true, detail: 'Catalog reachable. Your key and credit are checked on your first reply; this check spends no credit.' }
      } catch {
        return { ok: false, detail: 'Could not load the OpenMayhem catalog through the RP Suite server.' }
      }
    }
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
