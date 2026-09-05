import type { ChatCompletionSamplerParams, GenerateRequest } from './types'

/** For the Reasoning effort / Verbosity `SelectField`s — 'auto' first since it's the default. */
export const REASONING_EFFORT_OPTIONS: { value: ChatCompletionSamplerParams['reasoningEffort']; label: string }[] = [
  { value: 'auto', label: 'Auto (default)' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

export const VERBOSITY_OPTIONS: { value: ChatCompletionSamplerParams['verbosity']; label: string }[] = [
  { value: 'auto', label: 'Auto (default)' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

/**
 * Maps the chat-completion-native sampler onto the fields of `GenerateRequest` that
 * `OpenAICompatibleClient` actually reads — the counterpart to spreading `sampler`
 * (`GenerationParams`) directly for the KoboldCpp path. `'auto'` omits `reasoning_effort`/
 * `verbosity` entirely rather than sending the literal string `"auto"`, since most providers
 * treat an absent field as their own default and `"auto"` isn't itself a documented value for
 * either field on every provider.
 */
export function chatCompletionSamplerToRequest(
  params: ChatCompletionSamplerParams,
): Pick<GenerateRequest, 'temperature' | 'top_p' | 'presence_penalty' | 'frequency_penalty' | 'reasoning_effort' | 'verbosity'> {
  return {
    temperature: params.temperature,
    top_p: params.top_p,
    presence_penalty: params.presence_penalty,
    frequency_penalty: params.frequency_penalty,
    reasoning_effort: params.reasoningEffort === 'auto' ? undefined : params.reasoningEffort,
    verbosity: params.verbosity === 'auto' ? undefined : params.verbosity,
  }
}
