import { ImagePlus } from 'lucide-react'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { GenerateImageButton } from '@/components/ui/GenerateImageButton'
import { RegenerateFieldButton } from '../RegenerateFieldButton'
import { fixedFieldHint } from './helpers'
import type { CharacterEditorState } from './useCharacterEditor'

export function IdentityTab({ f }: { f: CharacterEditorState }) {
  const {
    character, setTab, form, avatarDataUrl, setAvatarDataUrl, worldId, setWorldId, setShowGenerate,
    setShowTemplates, worlds, set, applyMaximumImmersion, handleAvatarPick,
  } = f
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setShowGenerate(true)} className="flex items-center gap-1.5">
          Generate with AI
        </Button>
        {!character && <Button onClick={() => setShowTemplates(true)}>Start from a template</Button>}
        <Button
          variant="secondary"
          onClick={() => {
            applyMaximumImmersion()
            setTab('advanced')
          }}
          className="flex items-center gap-1.5"
          title={
            'One click: sets this character\'s system prompt to "Immersive, no meta", switches the global sampler to "Creative", and turns on slow-burn pacing + visual novel mode. See the Advanced tab for the full checklist and a recommendation to bind a "Dating Sim" world.'
          }
        >
          Maximum Immersion
        </Button>
      </div>

      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <label
            className="portrait-frame group relative flex h-24 w-24 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border bg-bg-sunken"
            aria-label="Change character avatar"
          >
            {avatarDataUrl ? (
              <img src={avatarDataUrl} alt="" className="h-full w-full rounded-xl object-cover" />
            ) : (
              <span className="flex flex-col items-center gap-1 text-[11px] text-text-muted">
                <ImagePlus size={18} strokeWidth={1.5} />
                Avatar
              </span>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleAvatarPick(e.target.files[0])}
            />
          </label>
          <div className="absolute -bottom-1.5 -right-1.5">
            <GenerateImageButton
              label="Generate avatar with AI"
              initialPrompt={form.description ? `portrait of ${form.name || 'a character'}, ${form.description}`.slice(0, 300) : ''}
              onGenerated={setAvatarDataUrl}
            />
          </div>
        </div>
        <div className="flex-1 space-y-0">
          <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          <SelectField label="World" value={worldId} onChange={(e) => setWorldId(e.target.value)}>
            <option value="">No world (standalone)</option>
            {worlds.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </SelectField>
        </div>
      </div>

      <TextAreaField
        label="Description"
        hint={fixedFieldHint('Appearance, background, core facts. Supports {{char}} / {{user}}.', form.description)}
        rows={4}
        value={form.description}
        onChange={(e) => set('description', e.target.value)}
        actions={<RegenerateFieldButton character={form} fieldKey="description" onResult={(t) => set('description', t)} />}
      />
      <TextAreaField
        label="Personality"
        hint={fixedFieldHint(
          'How they speak, act, and feel. The more specific, the more the model imitates their voice.',
          form.personality,
        )}
        rows={3}
        value={form.personality}
        onChange={(e) => set('personality', e.target.value)}
        actions={<RegenerateFieldButton character={form} fieldKey="personality" onResult={(t) => set('personality', t)} />}
      />
      <TextAreaField
        label="Scenario"
        hint={fixedFieldHint('The situation the chat starts in.', form.scenario)}
        rows={2}
        value={form.scenario}
        onChange={(e) => set('scenario', e.target.value)}
        actions={<RegenerateFieldButton character={form} fieldKey="scenario" onResult={(t) => set('scenario', t)} />}
      />
      <TextAreaField
        label="First message"
        rows={3}
        value={form.first_mes}
        onChange={(e) => set('first_mes', e.target.value)}
      />
      <TextAreaField
        label="Alternate greetings"
        hint="One per line. Optional gate prefix: [affection>=40] Your line"
        rows={3}
        value={(form.alternate_greetings ?? []).join('\n')}
        onChange={(e) => set('alternate_greetings', e.target.value.split('\n').filter(Boolean))}
      />
      <TextAreaField
        label="Example messages"
        hint={fixedFieldHint(
          'Few-shot dialogue examples, e.g. <START>\\n{{user}}: ...\\n{{char}}: ...',
          form.mes_example,
        )}
        rows={4}
        value={form.mes_example}
        onChange={(e) => set('mes_example', e.target.value)}
      />
    </div>
  )
}
