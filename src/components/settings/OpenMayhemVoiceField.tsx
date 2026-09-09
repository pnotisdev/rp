import { SelectField, TextField } from '@/components/ui/Field'
import { openMayhemVoices } from '@/lib/api/openMayhemMedia'
import type { OpenMayhemModel } from '@/lib/api/openMayhem'

export function OpenMayhemVoiceField({ model, value, onChange, label = 'Voice', placeholder = 'Use model default' }: {
  model?: OpenMayhemModel; value: string; onChange: (value: string) => void; label?: string; placeholder?: string
}) {
  const voices = openMayhemVoices(model)
  if (model && !voices) return <TextField label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
  return <SelectField label={label} value={voices?.includes(value) ? value : ''} disabled={!model}
    onChange={(e) => onChange(e.target.value)}
    hint={!model ? 'Choose an available speech model in Settings first.' : value && !voices?.includes(value) ? 'The saved voice is unavailable for this model. Choose a supported voice.' : 'Voices come from the selected model contract.'}>
    <option value="">{placeholder}</option>
    {voices?.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
  </SelectField>
}
