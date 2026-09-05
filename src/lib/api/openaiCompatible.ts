import type { GenerateRequest } from './types'
import { KoboldApiError } from './types'
import { estimateTokens } from '@/lib/tokenEstimate'
import type { ChatBackend } from './chatBackend'

/**
 * Section 8's "additional model backends" — a single client for any provider that speaks the
 * OpenAI Chat Completions wire format, which covers far more than just OpenAI itself: OpenRouter
 * (one API key, hundreds of models including Claude and Gemini, proxied through this exact same
 * shape), Groq, Together, local servers (llama.cpp's own `--api` mode, LM Studio, Ollama's OpenAI
 * shim, ...) all speak it too. One implementation instead of one bespoke client per provider,
 * matching how `ttsProviders.ts` already abstracts multiple TTS backends behind one call.
 *
 * Deliberately does NOT attempt native Anthropic/Google wire formats (a different request/response
 * shape each) — OpenRouter already re-exposes both through this one shape, which covers the actual
 * need with a fraction of the surface area. A genuine native Claude/Gemini client is a reasonable,
 * separate follow-up if OpenRouter's proxy ever isn't the right fit (e.g. wanting Anthropic's
 * prompt caching or Gemini's own safety settings directly).
 *
 * Honesty about what this hasn't been checked against: every other client in this codebase is
 * verified live, end to end, against the real service it talks to. This one is built strictly to
 * each provider's own documented Chat Completions contract plus mocked-response unit tests — ask
 * whoever adds a real API key to sanity-check the first real call before trusting it for anything
 * that matters.
 */
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

  /**
   * `GenerateRequest.messages` when the caller built one (the main chat generation path); every
   * other call site (background judge/assist calls) only ever builds `prompt`, a flat instruct-
   * template-formatted string meant for a text-completion API — wrapped as a single user turn here
   * so those call sites work against this backend completely unchanged, just without a proper
   * system/user split.
   */
  private body(params: GenerateRequest, stream: boolean): Record<string, unknown> {
    const messages = params.messages?.length ? params.messages : [{ role: 'user' as const, content: params.prompt }]
    const body: Record<string, unknown> = {
      model: this.model || 'gpt-4o-mini',
      messages,
      stream,
    }
    // Only the fields with a real, name-and-meaning-compatible equivalent in the OpenAI Chat
    // Completions contract get mapped — everything KoboldCpp-specific with no such equivalent
    // (top_k, min_p, typical, tfs, rep_pen*, dry_*, mirostat*, sampler_order, banned_tokens,
    // grammar) is silently dropped rather than sent as a field the API would ignore or reject.
    if (typeof params.temperature === 'number') body.temperature = params.temperature
    if (typeof params.top_p === 'number') body.top_p = params.top_p
    if (typeof params.presence_penalty === 'number') body.presence_penalty = params.presence_penalty
    if (typeof params.frequency_penalty === 'number') body.frequency_penalty = params.frequency_penalty
    // OpenAI's own flat field name for its native reasoning models (o1/o3/gpt-5 family) — also
    // accepted as an alias by OpenRouter's gateway for any reasoning-capable model it proxies, so
    // one field covers both without branching on which gateway is configured. OpenRouter's own
    // richer `reasoning: {effort, max_tokens, exclude}` object (more knobs, plus response-side
    // `reasoning_details` for preserving a model's chain of thought across turns) is deliberately
    // not implemented — narrower scope, picked over the fuller passthrough when this was built.
    if (params.reasoning_effort) body.reasoning_effort = params.reasoning_effort
    if (params.verbosity) body.verbosity = params.verbosity
    // `max_tokens` is the long-standing, still-widely-supported field name every gateway
    // (OpenRouter, Groq, ...) normalizes; a handful of newer OpenAI reasoning models
    // (o1/o3/gpt-5-family) want `max_completion_tokens` instead and reject this one outright —
    // a genuine, documented gap in this first pass rather than a silent one.
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
      throw new KoboldApiError(`Chat completion failed (${res.status}): ${(await this.parseErrorBody(res)).slice(0, 300)}`, res.status)
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content ?? ''
  }

  /**
   * SSE streaming, same shape as `KoboldClient.generateStream` (split on blank lines, read `data:`
   * lines) but a different payload per event — `choices[0].delta.content` instead of `{token}` —
   * and a literal `data: [DONE]` sentinel marking the end, which every OpenAI-compatible gateway
   * sends and which is not itself JSON.
   */
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
      throw new KoboldApiError(`Chat completion stream failed (${res.status}): ${(await this.parseErrorBody(res)).slice(0, 300)}`)
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
}
