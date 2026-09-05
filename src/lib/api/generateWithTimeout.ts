import type { ChatBackend } from './chatBackend'
import type { GenerateRequest } from './types'

/**
 * A slow or rate-limited backend response that simply never resolves — confirmed live against a
 * rate-limited free OpenRouter model during a long playthrough session — used to leave whichever
 * UI awaited a bare `client.generate(...)` call stuck forever: no error, no way to cancel, no way
 * to retry, because the awaited promise never settled either way. First fixed for the relationship
 * judge/assist calls (`relationshipAssist.ts`'s own `generateWithTimeout`, kept as its own copy
 * there since that file was under concurrent, unrelated edits when this shared version was carved
 * out) and for `objectiveAssist.ts`'s task/objective assist calls; this is the shared version every
 * other one-off `client.generate` call site outside those two files should use instead of hand-
 * rolling the same `AbortController` + `setTimeout` dance again.
 *
 * Races the call against a timeout that aborts the underlying request (every backend's `generate`
 * already accepts a `signal`) and turns a timeout specifically into a clear, labelled error —
 * anything else (a real 429, a parse error upstream, ...) passes through unchanged.
 */
export const ASSIST_TIMEOUT_MS = 45_000

/**
 * `external` lets a multi-call orchestrator (e.g. `generateFullCharacter.ts`, which chains a card
 * draft into a profile draft into a bonds draft) abort the in-flight call the moment the user hits
 * Stop, instead of waiting out the current stage's full 45s timeout. A timeout still reads as the
 * labelled timeout error; an external abort passes through as a plain `AbortError` the orchestrator
 * recognises and stops on.
 */
export async function generateWithTimeout(
  client: ChatBackend,
  params: GenerateRequest,
  label: string,
  external?: AbortSignal,
): Promise<string> {
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  if (external?.aborted) controller.abort()
  else external?.addEventListener('abort', onExternalAbort)
  const timer = setTimeout(() => controller.abort(), ASSIST_TIMEOUT_MS)
  try {
    return await client.generate(params, controller.signal)
  } catch (e) {
    if (external?.aborted) throw e instanceof Error ? e : new Error('aborted')
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${Math.round(ASSIST_TIMEOUT_MS / 1000)}s — the model backend didn't respond in time.`)
    }
    throw e
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', onExternalAbort)
  }
}
