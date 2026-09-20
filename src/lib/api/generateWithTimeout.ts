import type { ChatBackend } from './chatBackend'
import type { GenerateRequest } from './types'
import type { InstructTemplate } from '../prompt/instructTemplates'
import { wrapAssistPrompt } from '../prompt/instructTemplates'

// Races a backend `generate()` call against a timeout, aborting the request and turning a timeout
// into a clear, labelled error. An `external` AbortSignal (e.g. the user hitting Stop) aborts
// immediately instead of waiting out the timeout, and passes through as a plain AbortError.

export const ASSIST_TIMEOUT_MS = 45_000

/**
 * Optional prompt shaping for a background judge/assist call — never used by the main reply path
 * (which already builds a fully-templated, reasoning-aware prompt of its own via `builder.ts` and
 * `replyMaxTokens`). Applying this to an already-templated prompt would double-wrap it, so only the
 * hand-built, flat-string assist prompts (relationship tracker, objectives, choices, director pick,
 * rapport, scene vision) opt in.
 */
export interface AssistShaping {
  /** Settings -> Generation's reasoning-token headroom, added on top of this call's own small max_length so a thinking model's hidden reasoning has room to finish before the visible JSON is due (see `voice.ts`'s `replyMaxTokens`, which does the same for the main reply). Omitted/0 reproduces today's behavior exactly. */
  reasoningReserve?: number
  /** The active instruct template — already backend-resolved (forced to `plain-chat` for `openai-compatible`, same as the main reply; see `useChatSession.ts`). Wraps the prompt in the template's real turn markers via `wrapAssistPrompt` and merges in its stop sequences. */
  template?: InstructTemplate
}

export async function generateWithTimeout(
  client: ChatBackend,
  params: GenerateRequest,
  label: string,
  external?: AbortSignal,
  shaping?: AssistShaping,
): Promise<string> {
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  if (external?.aborted) controller.abort()
  else external?.addEventListener('abort', onExternalAbort)
  const timer = setTimeout(() => controller.abort(), ASSIST_TIMEOUT_MS)
  try {
    let shapedParams = params
    if (shaping?.template) {
      const template = shaping.template
      shapedParams = {
        ...shapedParams,
        prompt: wrapAssistPrompt(params.prompt, template),
        stop_sequence: template.stopSequences.length
          ? [...(params.stop_sequence ?? []), ...template.stopSequences]
          : params.stop_sequence,
      }
    }
    if (shaping?.reasoningReserve) {
      shapedParams = { ...shapedParams, max_length: params.max_length + Math.max(0, shaping.reasoningReserve) }
    }
    return await client.generate(shapedParams, controller.signal)
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
