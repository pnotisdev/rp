import { ImagePlus } from 'lucide-react'
import { fileToDataUrl } from '@/lib/characters/importExport'
import { WORLD_TEMPLATES } from '@/lib/world/worldTemplates'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { Chip } from '@/components/ui/Chip'
import type { EditorState } from './useWorldEditor'

export function OverviewTab({ f }: { f: EditorState }) {
  const {
    name, setName, description, setDescription, rules, setRules, template, setTemplate,
    avatarDataUrl, setAvatarDataUrl,
  } = f
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <label
          className="portrait-frame group relative flex h-24 w-32 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border bg-bg-sunken"
          aria-label="Change cover image"
        >
          {avatarDataUrl ? (
            <img src={avatarDataUrl} alt="" className="h-full w-full rounded-xl object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-[11px] text-text-muted">
              <ImagePlus size={18} strokeWidth={1.5} />
              Cover
            </span>
          )}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => e.target.files?.[0] && setAvatarDataUrl(await fileToDataUrl(e.target.files[0]))}
          />
        </label>
        <div className="flex-1">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      <TextAreaField
        label="Description"
        hint="Setting, tone, atmosphere. Always included for any character living here."
        rows={5}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <TextAreaField
        label="Rules"
        hint="Hard constraints the model should never contradict. Magic system, tech level, taboos."
        rows={3}
        value={rules}
        onChange={(e) => setRules(e.target.value)}
      />
      <div>
        <div className="mb-1.5 text-sm text-text">Template</div>
        <p className="mb-2 text-xs text-text-muted">
          Which tabs this world shows. Gifts/items/thresholds ("Dating sim") and the world clock
          ("Clock") aren't every setting's business. Switching doesn't touch anything you've already
          entered on a hidden tab.
        </p>
        <div className="flex flex-wrap gap-2">
          {WORLD_TEMPLATES.map((t) => (
            <Chip key={t.id} on={template === t.id} onClick={() => setTemplate(t.id)}>
              {t.label}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  )
}
