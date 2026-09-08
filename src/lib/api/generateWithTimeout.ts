import type { ChatBackend } from './chatBackend'
import type { GenerateRequest } from './types'

// Races a backend `generate()` call against a timeout, aborting the request and turning a timeout
// into a clear, labelled error. An `external` AbortSignal (e.g. the user hitting Stop) aborts
// immediately instead of waiting out the timeout, and passes through as a plain AbortError.

export const ASSIST_TIMEOUT_MS = 45_000

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
      throw new Error(`${label} timed out after ${Math.round(ASSIST_TIMEOUT_MS / 1000)}s. The model backend didn't respond in time.`)
    }
    throw e
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', onExternalAbort)
  }
}
