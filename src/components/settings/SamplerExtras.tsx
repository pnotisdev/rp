import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { formatLogitBias, parseBreakers, parseList, parseLogitBias, parseSamplerOrder } from '@/lib/prompt/samplerExtras'
import { TextAreaField, TextField } from '@/components/ui/Field'

/** The sampler fields that are text, not a number: banned words, token biases, grammar, guidance, sampler order and DRY breakers. */
export function SamplerExtras() {
  const sampler = useSettingsStore((s) => s.sampler)
  const setSampler = useSettingsStore((s) => s.setSampler)
  return (
    <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 rounded-lg border border-border bg-bg-elevated p-5 sm:grid-cols-2">
      <TextAreaField
        label="Banned words and phrases"
        rows={3}
        hint="One per line. The server bans these as it writes (KoboldCpp)."
        defaultValue={(sampler.banned_tokens ?? []).join('\n')}
        onBlur={(e) => setSampler({ banned_tokens: parseList(e.target.value) })}
      />
      <TextAreaField
        label="Token bias"
        rows={3}
        hint="Lines of tokenId: bias, from -100 (never) to 100 (always). Ids belong to the loaded model."
        defaultValue={formatLogitBias(sampler.logit_bias)}
        onBlur={(e) => setSampler({ logit_bias: parseLogitBias(e.target.value) })}
      />
      <TextAreaField
        label="Grammar (GBNF)"
        rows={3}
        className="sm:col-span-2"
        hint="Forces the reply into a shape. Leave empty for free text."
        defaultValue={sampler.grammar ?? ''}
        onBlur={(e) => setSampler({ grammar: e.target.value })}
      />
      <TextAreaField
        label="Negative prompt (guidance)"
        rows={2}
        className="sm:col-span-2"
        hint="Needs a guidance scale above 1, and KoboldCpp started with --enableguidance."
        defaultValue={sampler.negative_prompt ?? ''}
        onBlur={(e) => setSampler({ negative_prompt: e.target.value })}
      />
      <TextField
        label="Sampler order"
        hint="Comma-separated ids; empty uses the server's own order."
        defaultValue={(sampler.sampler_order ?? []).join(', ')}
        onBlur={(e) => setSampler({ sampler_order: parseSamplerOrder(e.target.value) })}
      />
      <TextField
        label="DRY sequence breakers"
        hint='A JSON list such as ["\n", ":"], or a comma list.'
        defaultValue={JSON.stringify(sampler.dry_sequence_breakers ?? [])}
        onBlur={(e) => setSampler({ dry_sequence_breakers: parseBreakers(e.target.value) })}
      />
    </div>
  )
}
