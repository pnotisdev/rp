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

/**
 * NovelAI's own hosted text-generation backend (Kayra, Clio) — a subscription service, not
 * something either the user or this session had an account for while building it. Built to the
 * documented/reverse-engineered contract, cross-checked against SillyTavern's own currently-live
 * source (its real backend proxy `src/endpoints/novelai.js` and frontend `public/scripts/nai-
 * settings.js`) rather than guessed at, but never actually run against a real NovelAI account —
 * treat it the same way as the rest of this app's unverified backends: sanity-check the first real
 * call before trusting it.
 *
 * A genuinely important correction made partway through building this: the initial assumption
 * (from a lower-level Python reference client) was that the prompt itself has to be tokenized with
 * NovelAI's own tokenizer and sent as packed, base64-encoded token ids. SillyTavern's actual,
 * currently-shipping frontend proved that wrong — it sends `input` as plain text with
 * `use_string: true` for the main prompt, every time. NovelAI's own tokenizer (bundled server-side
 * — see `server/novelaiTokenizer.ts`) is still genuinely needed here, just for a narrower purpose:
 * `stop_sequences` and `bad_words_ids` are documented as needing token ids, not strings, unlike
 * every other backend in this app where a stop sequence is a literal string.
 *
 * Deliberately unsupported:
 * - **Erato** (NovelAI's newest model) — a different, Llama-3-family tokenizer with no confirmed
 *   source for its tokenizer file (see `server/novelaiTokenizer.ts`). `getEffectiveMaxContext`/
 *   `tokenizeStopSequences` degrade gracefully for it (no stop sequences, estimated token counts)
 *   rather than erroring, but it's untested and not the intended target.
 * - **`bad_words_ids`/`logit_bias_exp`** — NovelAI-specific anti-repetition/anti-asterisk tuning
 *   SillyTavern applies per-model as its own curated preset content, not a documented API
 *   requirement — skipped as polish rather than correctness.
 * - **The exact SSE streaming field name** — every source found describes the request shape in
 *   detail; none pinned down the response event format for `/ai/generate-stream` (SillyTavern's own
 *   backend just pipes the raw stream through without parsing it, so its frontend's exact parsing
 *   code wasn't reached before this needed to ship). `generateStream` guesses the same `data:`
 *   +`{token}` shape every other backend in this app already uses, with a safety net: a stream that
 *   closes having produced zero tokens automatically retries via the non-streaming endpoint instead
 *   of silently returning nothing.
 */
export class NovelAIClient implements ChatBackend {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` }
  }

  /**
   * This app's stop sequences are plain strings (`GenerateRequest.stop_sequence`), same shape
   * every backend uses — NovelAI's `stop_sequences` parameter wants an array of token-id arrays
   * instead. Routes through the local server's bundled tokenizer (`/api/novelai/tokenize`, see
   * `server/novelaiTokenizer.ts`) since the actual SentencePiece model can't reasonably ship in the
   * browser bundle. Best-effort: any failure (server unreachable, an unsupported model like Erato)
   * just means this call goes out with no stop sequences rather than failing the generation
   * outright — a worse turn-ending experience, not a broken one.
   */
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

  /**
   * Field names and the `Tea_Time-Kayra` defaults (`phrase_rep_pen: 'aggressive'`,
   * `prefix: 'vanilla'`, `use_cache: false`, `return_full_text: false`) come from NovelAI's own
   * bundled preset in SillyTavern's repo, not guessed — but this app has no slider driving several
   * of them (`phrase_rep_pen`, `prefix`, NovelAI's newer `math1_*` sampler), so they're fixed
   * constants rather than exposed controls for now.
   */
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

    // The event-format safety net described in the class doc comment: a "successful" stream that
    // produced no text at all is a much stronger signal of a wrong field-name guess than of a
    // genuinely empty reply — degrade to the non-streaming call instead of returning nothing.
    if (!full && !signal?.aborted) {
      return this.generate(params, signal)
    }
    return full
  }

  /**
   * NovelAI's real per-subscription-tier context caps (SillyTavern's own `nai-settings.js` lists
   * 4096 for the entry tier vs. 8192 for higher ones, at least for Kayra) aren't exposed by any
   * endpoint this client calls — always the caller's own fallback, same as `OpenAICompatibleClient`.
   */
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

  /**
   * Settings → Connection's "does this actually work" check. `GET /user/subscription` is the
   * endpoint SillyTavern's own current backend (`src/endpoints/novelai.js`) calls for exactly this —
   * a real generation costs real subscription-tier quota for no reason, this doesn't. 401 there
   * means a rejected key; any other non-ok is a general error. The response does carry real
   * subscription details (tier, perks), but its exact shape isn't confirmed anywhere this session
   * checked (see the class doc comment's own honesty note) — reachability plus a clear auth-or-not
   * answer is the honest thing to report, not a guessed-at field.
   */
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
