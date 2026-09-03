import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { isValidRegexScript } from '@/lib/text/regexScripts'
import { newId } from '@/lib/id'
import type { RegexScript } from '@/lib/types'
import { Section } from '@/components/ui/Section'
import { ListEditor } from '@/components/ui/ListEditor'
import { SelectField, TextField } from '@/components/ui/Field'
import { Toggle } from '@/components/ui/Toggle'

export function RegexScriptsSection() {
  const scripts = useSettingsStore((s) => s.regexScripts)
  const setScripts = useSettingsStore((s) => s.setRegexScripts)

  const update = (id: string, patch: Partial<RegexScript>) =>
    setScripts(scripts.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const add = () =>
    setScripts([
      ...scripts,
      { id: newId(), name: `Script ${scripts.length + 1}`, find: '', replace: '', target: 'display', enabled: true },
    ])
  const remove = (id: string) => setScripts(scripts.filter((s) => s.id !== id))

  return (
    <Section
      title="Regex scripts"
      description="Find/replace rules run over message text. Display rules change only what's on screen; prompt rules change only the history sent back to the model. The stored message is never touched."
      surface="bare"
    >
      <ListEditor
        items={scripts}
        getKey={(s) => s.id}
        onAdd={add}
        onRemove={(s) => remove(s.id)}
        addLabel="Add script"
        emptyHint="No scripts. Add one to trim artifacts, reformat narration, or strip a tic the model keeps copying."
        renderItem={(script) => {
          const valid = isValidRegexScript(script)
          return (
            <div className="space-y-1">
              <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-[1fr_150px]">
                <TextField label="Name" value={script.name} onChange={(e) => update(script.id, { name: e.target.value })} />
                <SelectField
                  label="Applies to"
                  value={script.target}
                  onChange={(e) => update(script.id, { target: e.target.value as RegexScript['target'] })}
                >
                  <option value="display">Display only</option>
                  <option value="prompt">Prompt only</option>
                  <option value="both">Both</option>
                </SelectField>
              </div>
              <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-[1fr_1fr_90px]">
                <TextField
                  label="Find (regex)"
                  value={script.find}
                  onChange={(e) => update(script.id, { find: e.target.value })}
                  placeholder="\s+—\s+"
                  className={valid ? '' : 'ring-1 ring-danger/50'}
                />
                <TextField
                  label="Replace"
                  value={script.replace}
                  onChange={(e) => update(script.id, { replace: e.target.value })}
                  placeholder=", "
                />
                <TextField
                  label="Flags"
                  value={script.flags ?? ''}
                  onChange={(e) => update(script.id, { flags: e.target.value.replace(/[^gimsuy]/g, '') || undefined })}
                  placeholder="i"
                />
              </div>
              {!valid && <p className="text-[11px] text-danger">That pattern doesn't compile — it's being skipped.</p>}
              <div className="rounded-lg bg-bg-sunken px-3">
                <Toggle checked={script.enabled} onChange={(v) => update(script.id, { enabled: v })} label="Enabled" />
              </div>
            </div>
          )
        }}
      />
    </Section>
  )
}
