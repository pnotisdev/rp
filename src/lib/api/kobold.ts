import type {
  GenerateRequest,
  GenerateResponse,
  KoboldModelInfo,
  KoboldVersionInfo,
  PerfInfo,
} from './types'
import { KoboldApiError } from './types'

async function req<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(joinUrl(baseUrl, path), init)
  } catch (e) {
    // An intentional abort (Stop button) isn't "server unreachable" — don't mislabel it.
    if (init?.signal?.aborted) throw e
    throw new KoboldApiError(
      `Could not reach KoboldCpp at ${baseUrl}. Is the server running and reachable?`,
    )
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

  async getTrueMaxContextLength(): Promise<number> {
    const r = await req<{ value: number }>(this.baseUrl, '/api/extra/true_max_context_length')
    return r.value
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
