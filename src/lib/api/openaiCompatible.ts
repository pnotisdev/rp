import type { ChatCompletionMessage, ChatContentPart, GenerateRequest } from './types'
import { BRAND } from '@/lib/brand'
import { imageMimeOfBase64 } from './binaryUtils'
import { KoboldApiError } from './types'
import { estimateTokens } from '@/lib/tokenEstimate'
import type { ChatBackend, ConnectionCheckResult } from './chatBackend'
import { isOpenMayhem, loadOpenMayhemModels, OPENMAYHEM_PROXY, openMayhemRequestBody } from './openMayhem'

/** OpenRouter increasingly routes its free tier through reasoning models */
function isOpenRouter(baseUrl: string): boolean {
  try {
    return /(^|\.)openrouter\.ai$/.test(new URL(baseUrl.trim()).hostname)
  } catch {
    return false
  }
}

/** Attaches pictures to the last user turn as `image_url` parts, so a vision model on a hosted backend can see them. */
export function withImages(messages: ChatCompletionMessage[], images: string[] | undefined): ChatCompletionMessage[] {
  if (!images?.length) return messages
  const at = messages.map((m) => m.role).lastIndexOf('user')
  if (at < 0) return messages
  const target = messages[at]
  const text = typeof target.content === 'string' ? target.content : target.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join(' ')
  const parts: ChatContentPart[] = [
    { type: 'text', text },
    ...images.map((img) => ({ type: 'image_url' as const, image_url: { url: img.startsWith('data:') ? img : `data:${imageMimeOfBase64(img)};base64,${img}` } })),
  ]
  return messages.map((m, i) => (i === at ? { ...m, content: parts } : m))
}

// A single client for any provider that speaks the OpenAI Chat Completions wire format
export class OpenAICompatibleClient implements ChatBackend {
  get prefersJsonObject(): boolean { return isOpenMayhem(this.baseUrl) }
  constructor(
    public baseUrl: string,
    private apiKey: string,
    private model: string,
  ) {}

  /** OpenAI renamed `max_tokens` to `max_completion_tokens` for its reasoning models (o1/o3/o4-mini) and has since widened that to at… */
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
    const messages = withImages(params.messages?.length ? params.messages : [{ role: 'user' as const, content: params.prompt }], params.images)
    const body: Record<string, unknown> = {
      model: this.model || (isOpenMayhem(this.baseUrl) ? '' : 'gpt-4o-mini'),
      messages,
      stream,
    }
    // Only fields with a real equivalent in the OpenAI Chat Completions contract are mapped
    if (typeof params.temperature === 'number') body.temperature = params.temperature
    if (typeof params.top_p === 'number') body.top_p = params.top_p
    if (typeof params.presence_penalty === 'number') body.presence_penalty = params.presence_penalty
    if (typeof params.frequency_penalty === 'number') body.frequency_penalty = params.frequency_penalty
    if (params.reasoning_effort) body.reasoning_effort = params.reasoning_effort
    if (params.verbosity) body.verbosity = params.verbosity
    // See `isOpenRouter`'s doc comment.
    if (isOpenRouter(this.baseUrl)) {
      body.reasoning = params.reasoning_effort ? { effort: params.reasoning_effort } : { enabled: false }
    }
    // See `usesMaxCompletionTokens`'s doc comment
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

  /** The `reasoning: {enabled: false}` request above is a request, not a guarantee */
  private reasoningExhaustedError(reasoningChars: number): KoboldApiError {
    return new KoboldApiError(
      `The model spent its whole reply budget on hidden reasoning and never wrote an actual reply (${reasoningChars} reasoning characters, 0 in the reply). Try a larger Reply length, or a model without a "thinking" step.`,
    )
  }

  /** The fetch + error-classification shared by `generate` and `generateStream` */
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
    // `reasoning_content` is DeepSeek's own name for the same idea when reached directly (not through OpenRouter's `reasoning`)
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
      // Matches this method's own pre-existing contract (distinct from `generate`'s
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
    // Never surfaced as reply text (`onToken` is never called with it)
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
        return { ok: false, detail: `Could not load the OpenMayhem catalog through the ${BRAND.name} server.` }
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

  /** Nano-GPT's key check: `POST {host}/api/check-balance` (deliberately not under `/v1`), with the key as `x-api-key`, returning `{… */
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
