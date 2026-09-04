import type {
  GenerateRequest,
  GenerateResponse,
  KoboldModelInfo,
  KoboldVersionInfo,
  PerfInfo,
} from './types'
import { KoboldApiError } from './types'

// Background judge/choice calls (relationshipAssist.ts, choices.ts, objectiveAssist.ts,
// aiAssist.ts) never pass their own AbortSignal — without this, a hung KoboldCpp connection
// wedges them indefinitely. The interactive reply-generation flow always passes its own
// user-controlled signal (tied to the Stop button), so it's untouched by this: a caller-supplied
// signal is used as-is, with no extra timeout layered on top of it.
const DEFAULT_TIMEOUT_MS = 30000

async function req<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const hasOwnSignal = !!init?.signal
  const controller = hasOwnSignal ? undefined : new AbortController()
  const timeout = controller ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS) : undefined
  let res: Response
  try {
    res = await fetch(joinUrl(baseUrl, path), { ...init, signal: init?.signal ?? controller?.signal })
  } catch (e) {
    // An intentional abort (Stop button) isn't "server unreachable" — don't mislabel it.
    if (init?.signal?.aborted) throw e
    if (controller?.signal.aborted) {
      throw new KoboldApiError(
        `${path} timed out after ${DEFAULT_TIMEOUT_MS / 1000}s waiting for KoboldCpp at ${baseUrl}.`,
      )
    }
    throw new KoboldApiError(
      `Could not reach KoboldCpp at ${baseUrl}. Is the server running and reachable?`,
    )
  } finally {
    if (timeout) clearTimeout(timeout)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new KoboldApiError(`${path} failed (${res.status}): ${body.slice(0, 300)}`, res.status)
  }
  return res.json() as Promise<T>
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path
}

export function makeGenKey(): string {
  return `rp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export class KoboldClient {
  constructor(public baseUrl: string) {}

  private cachedMaxContext: number | undefined

  async getVersion(): Promise<KoboldVersionInfo> {
    return req(this.baseUrl, '/api/extra/version')
  }

  async getModel(): Promise<string> {
    const r = await req<KoboldModelInfo>(this.baseUrl, '/api/v1/model')
    return r.result
  }

  async getMaxContextLength(): Promise<number> {
    const r = await req<{ value: number }>(this.baseUrl, '/api/v1/config/max_context_length')
    return r.value
  }

  /**
   * The loaded model's own chat template (the GGUF's embedded Jinja string), from llama.cpp's
   * `/props` endpoint that modern KoboldCpp also serves. Used only to warn when the app's active
   * instruct template doesn't match the model's actual training format. Returns null on any older
   * build that lacks the endpoint or a model with no embedded template — never an error.
   */
  async getChatTemplate(): Promise<string | null> {
    try {
      const r = await req<{ chat_template?: string }>(this.baseUrl, '/props')
      return typeof r.chat_template === 'string' && r.chat_template.trim() ? r.chat_template : null
    } catch {
      return null
    }
  }

  async getTrueMaxContextLength(): Promise<number> {
    const r = await req<{ value: number }>(this.baseUrl, '/api/extra/true_max_context_length')
    return r.value
  }

  /**
   * The judge/assist calls (relationship scoring, choice generation, objective planning, lore
   * suggestions, card field regeneration) each fire their own short `generate()` outside the
   * main chat's configured sampler, and used to hardcode `max_context_length: 4096` — wrong for
   * a smaller-context model (an invalid oversized request) and needlessly restrictive for a
   * bigger one. This asks the server what's actually loaded instead, caching the answer on this
   * instance (one extra request per `KoboldClient`, not per judge call) and falling back to
   * `fallback` if the server is unreachable or doesn't support the endpoint.
   */
  async getEffectiveMaxContext(fallback = 4096): Promise<number> {
    if (this.cachedMaxContext !== undefined) return this.cachedMaxContext
    try {
      const value = await this.getTrueMaxContextLength()
      this.cachedMaxContext = value > 0 ? value : fallback
    } catch {
      this.cachedMaxContext = fallback
    }
    return this.cachedMaxContext
  }

  async getPerf(): Promise<PerfInfo> {
    return req(this.baseUrl, '/api/extra/perf')
  }

  async tokenCount(text: string): Promise<{ count: number; ids: number[] }> {
    const r = await req<{ ids: number[] }>(this.baseUrl, '/api/extra/tokencount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text }),
    })
    return { count: r.ids?.length ?? 0, ids: r.ids ?? [] }
  }

  /** Non-streaming generation. */
  async generate(params: GenerateRequest, signal?: AbortSignal): Promise<string> {
    const r = await req<GenerateResponse>(this.baseUrl, '/api/v1/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal,
    })
    return r.results?.[0]?.text ?? ''
  }

  /**
   * Streaming generation via SSE. Calls onToken for each new token as it
   * arrives, and resolves with the full concatenated text at the end.
   */
  async generateStream(
    params: GenerateRequest,
    onToken: (token: string, full: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    let res: Response
    try {
      res = await fetch(joinUrl(this.baseUrl, '/api/extra/generate/stream'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal,
      })
    } catch (e) {
      // An intentional abort (Stop button) isn't "server unreachable" — there's no partial
      // text to save yet since streaming hadn't started, but don't mislabel it as a crash.
      if (signal?.aborted) return ''
      throw new KoboldApiError(`Could not reach KoboldCpp at ${this.baseUrl} for streaming.`)
    }
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '')
      throw new KoboldApiError(`generate/stream failed (${res.status}): ${body.slice(0, 300)}`)
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
      // Stopped mid-stream — keep whatever text had already arrived instead of throwing
      // it away; the caller treats an aborted stream the same as a short completed one.
      if (signal?.aborted) return full
      throw e
    }
    return full
  }

  /** Best-effort server-side abort of the in-flight generation for a genkey. */
  async abort(genkey: string): Promise<void> {
    await fetch(joinUrl(this.baseUrl, '/api/extra/abort'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ genkey }),
    }).catch(() => {})
  }
}
