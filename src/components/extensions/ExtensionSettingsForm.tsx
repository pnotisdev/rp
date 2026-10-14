// Edits the values of an extension's declared settings; each change is saved straight away.

import { useEffect, useState } from 'react'
import { NumberField, SelectField, TextField } from '@/components/ui/Field'
import { Toggle } from '@/components/ui/Toggle'
import { extensionsApi } from '@/lib/api/client'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { resolveSettings, type ExtensionRecord, type SettingSpec, type SettingValue } from '@/lib/extensions/manifest'

function save(ext: ExtensionRecord, key: string, value: SettingValue) {
  extensionsApi.setState(ext.id, { settings: { [key]: value } }).catch((e) => toastError(errorMessage(e)))
}

function DraftField({ ext, spec, value }: { ext: ExtensionRecord; spec: SettingSpec; value: SettingValue }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    if (spec.type === 'number') {
      const n = Number(draft)
      if (Number.isFinite(n) && n !== value) save(ext, spec.key, n)
      else setDraft(String(value))
    } else if (draft !== value) save(ext, spec.key, draft)
  }
  return spec.type === 'number' ? (
    <NumberField label={spec.label} hint={spec.hint} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
  ) : (
    <TextField label={spec.label} hint={spec.hint} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
  )
}

export function ExtensionSettingsForm({ ext }: { ext: ExtensionRecord }) {
  const values = resolveSettings(ext.manifest, ext.settings)
  return (
    <div className="space-y-1">
      {ext.manifest.settings.map((spec) => {
        const value = values[spec.key]
        if (spec.type === 'boolean') {
          return <Toggle key={spec.key} label={spec.label} description={spec.hint} checked={value === true} onChange={(v) => save(ext, spec.key, v)} />
        }
        if (spec.type === 'select') {
          return (
            <SelectField key={spec.key} label={spec.label} hint={spec.hint} value={String(value)} onChange={(e) => save(ext, spec.key, e.target.value)}>
              {(spec.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </SelectField>
          )
        }
        return <DraftField key={spec.key} ext={ext} spec={spec} value={value} />
      })}
    </div>
  )
}
