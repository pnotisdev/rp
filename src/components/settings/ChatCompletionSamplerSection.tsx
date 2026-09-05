import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { REASONING_EFFORT_OPTIONS, VERBOSITY_OPTIONS } from '@/lib/api/chatCompletionSampler'
import { Slider } from '@/components/ui/Slider'
import { SelectField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'

/**
 * The chat-completion-native counterpart to the "Generation" section's KoboldCpp sampler — the
 * user's own framing after live-testing section 8: "text completion and chat completion presets
 * are different" (matching SillyTavern's own split between the two). Shown instead of (not
 * alongside) the KoboldCpp sampler whenever `chatBackend` is `'openai-compatible'` — see
 * `SamplingControls.tsx`. Reply length stays on the shared "Context & length" section above either
 * way; it's a universal "how long should a reply be" concept, not a sampler internal.
 */
export function ChatCompletionSamplerSection() {
  const chatCompletionSampler = useSettingsStore((s) => s.chatCompletionSampler)
  const setChatCompletionSampler = useSettingsStore((s) => s.setChatCompletionSampler)

  return (
    <Section
      title="Generation (chat completion)"
      description="Real OpenAI Chat Completions parameters for the backend configured in Settings → Connection — kept separate from the KoboldCpp sampler above so switching backends never overwrites either one's tuning."
      surface="bare"
    >
      <div className="rounded-xl bg-bg-elevated p-5">
        <Slider
          label="Temperature"
          min={0}
          max={2}
          step={0.01}
          value={chatCompletionSampler.temperature}
          onChange={(v) => setChatCompletionSampler({ temperature: v })}
          description="Lower = safer and more predictable. Higher = more surprising and varied."
        />
        <Slider
          label="Top P"
          min={0}
          max={1}
          step={0.01}
          value={chatCompletionSampler.top_p}
          onChange={(v) => setChatCompletionSampler({ top_p: v })}
          description="How narrowly the model sticks to its most likely next words."
        />
        <Slider
          label="Frequency penalty"
          min={-2}
          max={2}
          step={0.01}
          value={chatCompletionSampler.frequency_penalty}
          onChange={(v) => setChatCompletionSampler({ frequency_penalty: v })}
          description="Discourages reusing the same tokens often, scaled by how often they've already appeared."
        />
        <Slider
          label="Presence penalty"
          min={-2}
          max={2}
          step={0.01}
          value={chatCompletionSampler.presence_penalty}
          onChange={(v) => setChatCompletionSampler({ presence_penalty: v })}
          description="Discourages reusing any token that's appeared at all, regardless of how often."
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField
          label="Reasoning effort"
          hint="Reasoning models only (e.g. MiniMax M3, o-series, DeepSeek R1). Ignored by non-reasoning models."
          value={chatCompletionSampler.reasoningEffort}
          onChange={(e) => setChatCompletionSampler({ reasoningEffort: e.target.value as typeof chatCompletionSampler.reasoningEffort })}
        >
          {REASONING_EFFORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Verbosity"
          hint="Newer OpenAI models only (GPT-5 family). Ignored elsewhere."
          value={chatCompletionSampler.verbosity}
          onChange={(e) => setChatCompletionSampler({ verbosity: e.target.value as typeof chatCompletionSampler.verbosity })}
        >
          {VERBOSITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
      </div>
    </Section>
  )
}
