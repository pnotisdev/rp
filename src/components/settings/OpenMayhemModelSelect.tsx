import { SelectField } from '@/components/ui/Field'

export function OpenMayhemModelSelect({ models, loading, value, onChange }: {
  models: string[] | null
  loading: boolean
  value: string
  onChange: (model: string) => void
}) {
  const options = models ?? []
  const selected = options.includes(value)
  const hint = loading ? 'Checking available providers…'
    : models === null ? 'Could not check model availability. Use Test connection to retry.'
      : options.length === 0 ? 'No chat models currently have an available provider. This list refreshes automatically.'
        : value && !selected ? 'The selected model is currently unavailable. Choose another model or wait for it to return.'
          : 'Only models with an available provider. Refreshes every 30 seconds and when you return to this window.'
  return (
    <SelectField label="Model" value={selected ? value : ''} disabled={options.length === 0}
      onChange={(e) => onChange(e.target.value)} hint={hint}>
      {!selected && <option value="" disabled>{loading ? 'Loading models…' : options.length ? 'Choose an available model…' : 'No available models'}</option>}
      {options.map((model) => <option key={model} value={model}>{model}</option>)}
    </SelectField>
  )
}
