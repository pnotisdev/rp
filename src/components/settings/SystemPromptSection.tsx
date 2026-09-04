import { useState } from 'react'
import { Plus, Upload, X } from 'lucide-react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { BUILTIN_SYSTEM_PROMPTS, DEFAULT_SYSTEM_PROMPT } from '@/lib/prompt/systemPrompts'
import { parseSillyTavernPreset } from '@/lib/prompt/sillyTavernPreset'
import { Section } from '@/components/ui/Section'
import { TextAreaField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { FileButton } from '@/components/ui/FileButton'
import { toastError, toastInfo, toastSuccess } from '@/lib/store/useToastStore'

/**
 * User control over the instruction block at the top of every generation (rule 2 of the prompt
 * overhaul). A character's own `system_prompt` field still wins when set; this is the global
 * fallback that replaced the old hardcoded line.
 *
 * The store holds a plain string. Empty means "use the built-in default" (`DEFAULT_SYSTEM_PROMPT`,
 * i.e. the first built-in variation). Picking any other built-in variation, or a user preset, sets
 * the string to that full text so it stays editable afterward. Post-history steering is appended
 * after any per-character post-history and applies to every chat.
 */
export function SystemPromptSection() {
  const systemPrompt = useSettingsStore((s) => s.systemPrompt)
  const setSystemPrompt = useSettingsStore((s) => s.setSystemPrompt)
  const postHistoryInstructions = useSettingsStore((s) => s.postHistoryInstructions)
  const setPostHistoryInstructions = useSettingsStore((s) => s.setPostHistoryInstructions)
  const promptPresets = useSettingsStore((s) => s.promptPresets)
  const addPromptPreset = useSettingsStore((s) => s.addPromptPreset)
  const removePromptPreset = useSettingsStore((s) => s.removePromptPreset)

  const [saving, setSaving] = useState(false)
  const [presetName, setPresetName] = useState('')

  // An empty stored value behaves as the first built-in; treat it as that one for the picker.
  const effectivePrompt = systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT
  const activeBuiltin = BUILTIN_SYSTEM_PROMPTS.find((p) => p.prompt === effectivePrompt)
  const activeUserPreset = promptPresets.find(
    (p) => p.systemPrompt.trim() === systemPrompt.trim() && p.postHistoryInstructions.trim() === postHistoryInstructions.trim(),
  )
  const selectValue = activeUserPreset ? `user:${activeUserPreset.id}` : activeBuiltin ? `builtin:${activeBuiltin.id}` : 'custom'
  const activeUse = activeBuiltin?.use

  const onSelect = (value: string) => {
    if (value === 'custom') return
    const [kind, id] = value.split(':')
    if (kind === 'builtin') {
      const preset = BUILTIN_SYSTEM_PROMPTS.find((p) => p.id === id)
      if (preset) setSystemPrompt(preset.id === BUILTIN_SYSTEM_PROMPTS[0].id ? '' : preset.prompt)
    } else {
      const preset = promptPresets.find((p) => p.id === id)
      if (preset) {
        setSystemPrompt(preset.systemPrompt)
        setPostHistoryInstructions(preset.postHistoryInstructions)
      }
    }
  }

  const savePreset = () => {
    addPromptPreset(presetName)
    setPresetName('')
    setSaving(false)
  }

  /** Load a SillyTavern `sysprompt/*.json` preset into the editable fields. */
  const importPreset = async (files: FileList) => {
    const file = files[0]
    try {
      const parsed = parseSillyTavernPreset(JSON.parse(await file.text()))
      if (parsed?.kind === 'sysprompt') {
        setSystemPrompt(parsed.prompt)
        setPostHistoryInstructions(parsed.postHistory)
        toastSuccess(`Loaded "${parsed.name}" — edit or save it as a preset below`)
      } else if (parsed?.kind === 'instruct') {
        toastInfo('That is an instruct preset — import it in the Instruct template section instead.')
      } else {
        toastError(parsed?.kind === 'unsupported' ? `Can't import ${parsed.detail}` : 'Not a SillyTavern system-prompt preset')
      }
    } catch {
      toastError(`${file.name}: not valid JSON`)
    }
  }

  return (
    <Section
      title="System prompt"
      description="The instruction block at the very top of every generation. A character's own system-prompt override (Character editor -> Advanced) still wins when set; this is the global default for everyone else. Ten built-in variations with different feels, or write your own."
      surface="bare"
      action={
        <FileButton onPick={importPreset} accept=".json,application/json" title="Import a SillyTavern sysprompt/*.json preset">
          <Upload size={13} strokeWidth={2} />
          Import ST preset
        </FileButton>
      }
    >
      <div className="mb-1.5 text-xs font-medium text-text-muted">Preset</div>
      <select
        value={selectValue}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
      >
        <optgroup label="Built-in">
          {BUILTIN_SYSTEM_PROMPTS.map((p) => (
            <option key={p.id} value={`builtin:${p.id}`}>
              {p.name}
            </option>
          ))}
        </optgroup>
        {promptPresets.length > 0 && (
          <optgroup label="Your presets">
            {promptPresets.map((p) => (
              <option key={p.id} value={`user:${p.id}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
        {selectValue === 'custom' && <option value="custom">Custom (edited)</option>}
      </select>
      {activeUse && <p className="mt-1.5 text-xs text-text-muted">{activeUse}</p>}

      <div className="mb-4 mt-3 flex flex-wrap items-center gap-2">
        {promptPresets.map((p) => (
          <div key={p.id} className="group relative">
            <span
              className={`inline-flex rounded-lg border py-1 pl-2.5 pr-7 text-xs ${
                activeUserPreset?.id === p.id ? 'border-accent/40 text-accent' : 'border-border text-text-muted'
              }`}
            >
              {p.name}
            </span>
            <button
              onClick={() => removePromptPreset(p.id)}
              aria-label={`Delete the ${p.name} preset`}
              className="absolute right-0.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-text-muted opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        ))}
        {saving ? (
          <span className="flex items-center gap-1.5">
            <input
              autoFocus
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') savePreset()
                if (e.key === 'Escape') setSaving(false)
              }}
              placeholder="Preset name"
              className="w-36 rounded-lg bg-bg-sunken px-2.5 py-1 text-xs text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 placeholder:text-text-muted/55"
            />
            <Button variant="primary" onClick={savePreset}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setSaving(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <button
            onClick={() => setSaving(true)}
            className="flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-xs text-text-muted transition-colors hover:border-accent hover:text-text"
          >
            <Plus size={12} strokeWidth={2} />
            Save current as preset
          </button>
        )}
      </div>

      <TextAreaField
        label="System prompt"
        hint="Supports {{char}} / {{user}}. Blank uses the built-in default shown as placeholder. Edit freely; picking a preset above replaces it."
        rows={8}
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        placeholder={DEFAULT_SYSTEM_PROMPT}
        actions={
          systemPrompt.trim() ? (
            <Button variant="ghost" onClick={() => setSystemPrompt('')}>
              Reset to default
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}>
              Load default to edit
            </Button>
          )
        }
      />
      <TextAreaField
        label="Post-history steering (optional)"
        hint="Injected right before the model's turn, after any per-character post-history instructions. A reliable slot for a rule the model keeps forgetting. Applies to every chat."
        rows={3}
        value={postHistoryInstructions}
        onChange={(e) => setPostHistoryInstructions(e.target.value)}
        placeholder="e.g. Keep replies to two or three paragraphs. Never end on a question."
      />
    </Section>
  )
}
