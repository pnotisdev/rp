import { KoboldApiError } from './types'
import { uint8ArrayToBase64 } from './binaryUtils'
import type { ImageBackend, ImageGenerateParams, ImageGenerateResult } from './imageBackend'

/**
 * SwarmUI (mcmonkeyprojects) wraps ComfyUI internally but exposes its own simpler, session-based
 * REST API — confirmed from its own official `docs/API.md` and `docs/APIRoutes/T2IAPI.md`:
 * `POST /API/GetNewSession` (no auth by default) returns a `session_id` every other call must
 * include; `POST /API/GenerateText2Image` takes `session_id` plus generation params at the same
 * JSON level and returns `{images: [...]}`, each entry a relative path to `GET` (the docs note it
 * can occasionally be a `data:` URI directly instead). The individual parameter names below
 * (`negativeprompt`, `cfgscale`, ...) follow SwarmUI's documented naming convention but weren't
 * individually confirmed one-by-one in the source actually fetched while building this — the
 * lowest-confidence piece of this client. Never run against a real SwarmUI instance.
 */
export class SwarmUIClient implements ImageBackend {
  private sessionId: string | null = null

  constructor(private baseUrl: string) {}

  private base(): string {
    return this.baseUrl.replace(/\/+$/, '')
  }

  private async fetchNewSession(): Promise<string> {
    let res: Response
    try {
      res = await fetch(`${this.base()}/API/GetNewSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    } catch {
      throw new KoboldApiError(`Could not reach SwarmUI at ${this.baseUrl}.`)
    }
    if (!res.ok) throw new KoboldApiError(`SwarmUI session request failed (${res.status}).`, res.status)
    const data = (await res.json()) as { session_id?: string }
    if (!data.session_id) throw new KoboldApiError('SwarmUI did not return a session_id.')
    this.sessionId = data.session_id
    return this.sessionId
  }

  private async getSession(): Promise<string> {
    return this.sessionId ?? this.fetchNewSession()
  }

  async generateImage(params: ImageGenerateParams, signal?: AbortSignal): Promise<ImageGenerateResult> {
    const sessionId = await this.getSession()
    const body = {
      session_id: sessionId,
      images: 1,
      prompt: params.prompt,
      negativeprompt: params.negativePrompt ?? '',
      width: params.width,
      height: params.height,
      steps: params.steps,
      cfgscale: params.cfgScale,
      seed: params.seed ?? -1,
      ...(params.model ? { model: params.model } : {}),
      ...(params.sampler ? { sampler: params.sampler } : {}),
    }

    const post = (b: typeof body) =>
      fetch(`${this.base()}/API/GenerateText2Image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify(b),
      })

    let res: Response
    try {
      res = await post(body)
    } catch (e) {
      if (signal?.aborted) throw e
      throw new KoboldApiError(`Could not reach SwarmUI at ${this.baseUrl}.`)
    }
    let data = (await res.json().catch(() => ({}))) as { images?: string[]; error?: string; error_id?: string }

    // Per SwarmUI's own docs: any route can return error_id "invalid_session_id" once a session
    // expires — get a fresh one and retry exactly once rather than surface a confusing failure for
    // what's really just a stale cached id.
    if (data.error_id === 'invalid_session_id') {
      const freshId = await this.fetchNewSession()
      res = await post({ ...body, session_id: freshId })
      data = (await res.json().catch(() => ({}))) as { images?: string[]; error?: string; error_id?: string }
    }

    if (!res.ok || data.error) {
      throw new KoboldApiError(`SwarmUI generation failed: ${data.error ?? `HTTP ${res.status}`}`)
    }
    const imagePath = data.images?.[0]
    if (!imagePath) throw new KoboldApiError('SwarmUI reported success but returned no image.')

    if (imagePath.startsWith('data:')) {
      return { base64: imagePath.split(',')[1] ?? '' }
    }
    const imgRes = await fetch(`${this.base()}/${imagePath.replace(/^\/+/, '')}`, { signal })
    if (!imgRes.ok) throw new KoboldApiError(`SwarmUI produced an image but it couldn't be fetched (${imgRes.status}).`)
    return { base64: uint8ArrayToBase64(new Uint8Array(await imgRes.arrayBuffer())) }
  }

  /** No confirmed model-listing endpoint found while building this (unlike the rest of this client, not sourced from SwarmUI's own docs) — empty rather than guessed at. */
  async listModels(): Promise<string[]> {
    return []
  }
}
