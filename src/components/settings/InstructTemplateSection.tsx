import { useState } from 'react'
import { Upload } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { instructTemplatesApi } from '@/lib/api/client'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { BUILTIN_INSTRUCT_TEMPLATES, resolveInstructTemplate, type InstructTemplate } from '@/lib/prompt/instructTemplates'
import { parseSillyTavernPreset } from '@/lib/prompt/sillyTavernPreset'
import { Section } from '@/components/ui/Section'
import { TextField, TextAreaField } from '@/components/ui/Field'
import { Toggle } from '@/components/ui/Toggle'
import { Button } from '@/components/ui/Button'
import { FileButton } from '@/components/ui/FileButton'
import { errorMessage, toastError, toastInfo, toastSuccess } from '@/lib/store/useToastStore'

type EditableFields = Omit<InstructTemplate, 'id' | 'name'>

function fieldsOf(t: InstructTemplate): EditableFields {
  const { id: _id, name: _name, ...fields } = t
  return fields
}

export function InstructTemplateSection() {
  const instructTemplateId = useSettingsStore((s) => s.instructTemplateId)
  const setInstructTemplateId = useSettingsStore((s) => s.setInstructTemplateId)
  const customTemplates = useApiQuery('instruct-templates', () => instructTemplatesApi.list(), []) ?? []
  const active = resolveInstructTemplate(instructTemplateId, customTemplates)

  const [draftName, setDraftName] = useState(`${active.name} (copy)`)
  const [draft, setDraft] = useState<EditableFields>(fieldsOf(active))
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof EditableFields>(key: K, value: EditableFields[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const loadIntoEditor = (t: InstructTemplate) => {
    setDraftName(`${t.name} (copy)`)
    setDraft(fieldsOf(t))
  }

  const saveAsNew = async () => {
    setSaving(true)
    try {
      const created = await instructTemplatesApi.create({ name: draftName.trim() || 'Custom template', ...draft })
      setInstructTemplateId(created.id)
      toastSuccess(`Saved "${created.name}" as the active template`)
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const removeCustom = async (id: string) => {
    await instructTemplatesApi.remove(id)
    if (instructTemplateId === id) setInstructTemplateId('plain-chat')
  }

  /** Import one or more SillyTavern `instruct/*.json` presets as custom templates. */
  const importPresets = async (files: FileList) => {
    let imported = 0
    let lastId = ''
    const skipped: string[] = []
    for (const file of Array.from(files)) {
      try {
        const parsed = parseSillyTavernPreset(JSON.parse(await file.text()))
        if (parsed?.kind === 'instruct') {
          const created = await instructTemplatesApi.create({ ...parsed.template, name: parsed.name })
          imported++
          lastId = created.id
        } else if (parsed?.kind === 'sysprompt') {
          skipped.push(`${file.name} is a system-prompt preset — import it in the System prompt section`)
        } else {
          skipped.push(`${file.name}: ${parsed?.kind === 'unsupported' ? parsed.detail : 'not a SillyTavern preset'}`)
        }
      } catch {
        skipped.push(`${file.name}: not valid JSON`)
      }
    }
    if (imported > 0) {
      if (lastId) setInstructTemplateId(lastId)
      toastSuccess(`Imported ${imported} instruct template${imported === 1 ? '' : 's'}${lastId ? ' (last one is now active)' : ''}`)
    }
    if (skipped.length > 0) toastInfo(skipped.join('\n'))
    if (imported === 0 && skipped.length === 0) toastError('Nothing to import')
  }

  return (
    <Section
      title="Instruct template"
      description="How turns are formatted for the model — match this to your model's training format. Duplicate a builtin below to tweak it, or import a SillyTavern instruct preset."
      surface="bare"
      action={
        <FileButton onPick={importPresets} accept=".json,application/json" multiple title="Import a SillyTavern instruct/*.json preset (multiple allowed)">
          <Upload size={13} strokeWidth={2} />
          Import ST preset
        </FileButton>
      }
    >
      <div className="mb-4 grid grid-cols-1 gap-x-3 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-xs font-medium text-text-muted">Active template</div>
          <select
            value={instructTemplateId}
            onChange={(e) => setInstructTemplateId(e.target.value)}
            className="w-full rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
          >
            <optgroup label="Builtin">
              {BUILTIN_INSTRUCT_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
            {customTemplates.length > 0 && (
              <optgroup label="Custom">
                {customTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="flex items-end">
          <Button onClick={() => loadIntoEditor(active)} className="w-full sm:w-auto">
            Duplicate active template into editor below
          </Button>
        </div>
      </div>

      {customTemplates.length > 0 && (
        <div className="mb-5 space-y-1">
          {customTemplates.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-xl bg-bg-sunken px-4 py-3 text-sm">
              <span className="text-text">
                {t.name}
                {t.id === instructTemplateId && <span className="ml-2 text-[11px] text-accent">active</span>}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setInstructTemplateId(t.id)}>
                  Use
                </Button>
                <Button variant="ghost" onClick={() => loadIntoEditor(t)}>
                  Edit a copy
                </Button>
                <Button variant="ghost" onClick={() => removeCustom(t.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl bg-bg-elevated p-5">
        <TextField label="Name" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <TextAreaField
            label="System prefix"
            rows={2}
            value={draft.systemPrefix}
            onChange={(e) => set('systemPrefix', e.target.value)}
          />
          <TextAreaField
            label="System suffix"
            rows={2}
            value={draft.systemSuffix}
            onChange={(e) => set('systemSuffix', e.target.value)}
          />
          <TextAreaField
            label="User prefix"
            rows={2}
            value={draft.userPrefix}
            onChange={(e) => set('userPrefix', e.target.value)}
          />
          <TextAreaField
            label="User suffix"
            rows={2}
            value={draft.userSuffix}
            onChange={(e) => set('userSuffix', e.target.value)}
          />
          <TextAreaField
            label="Assistant prefix"
            rows={2}
            value={draft.assistantPrefix}
            onChange={(e) => set('assistantPrefix', e.target.value)}
          />
          <TextAreaField
            label="Assistant suffix"
            rows={2}
            value={draft.assistantSuffix}
            onChange={(e) => set('assistantSuffix', e.target.value)}
          />
        </div>
        <TextField
          label="Stop sequences (comma separated)"
          value={draft.stopSequences.join(', ')}
          onChange={(e) => set('stopSequences', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        />
        <div className="rounded-lg bg-bg-sunken px-3">
          <Toggle
            checked={draft.namesInPrompt}
            onChange={(v) => set('namesInPrompt', v)}
            label="Wrap turns with speaker names"
            description="e.g. “{name}: ” before each turn — off for formats like ChatML that carry the role in the prefix/suffix tokens instead."
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={saveAsNew} disabled={saving}>
            {saving ? 'Saving…' : 'Save as new template'}
          </Button>
        </div>
      </div>
    </Section>
  )
}
