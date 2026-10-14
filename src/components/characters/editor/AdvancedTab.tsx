import {
  REPLY_LENGTH_HINTS,
  REPLY_LENGTH_LABELS,
  deriveCardReplyBand,
  
  type ReplyLength,
} from '@/lib/characters/voice'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import { BUILTIN_INSTRUCT_TEMPLATES } from '@/lib/prompt/instructTemplates'
import { LorebookEditor } from '@/components/worldinfo/LorebookEditor'
import { maximumImmersionChecklist } from '@/lib/prompt/immersionPreset'
import type { CharacterEditorState } from './useCharacterEditor'

export function AdvancedTab({ f }: { f: CharacterEditorState }) {
  const {
    form, instructTemplateId, setInstructTemplateId, replyLength, setReplyLength,
    customInstructTemplates, set, applyMaximumImmersion,
  } = f
  return (
    <div className="space-y-10">
      <Section
        title="Maximum Immersion"
        description="One-click bundle for an author who wants the deepest, most immersive setup this app can offer, curated from settings that already exist rather than new mechanics."
        surface="bare"
        action={
          <Button variant="secondary" onClick={applyMaximumImmersion} className="inline-flex items-center">
            Apply Maximum Immersion
          </Button>
        }
      >
        <ul className="space-y-1.5 rounded-xl bg-bg-sunken p-3 text-xs text-text-muted">
          {maximumImmersionChecklist().applied.map((item) => (
            <li key={item.label}>
              <span className="font-medium text-text">{item.label}:</span> {item.detail}
            </li>
          ))}
          {maximumImmersionChecklist().recommended.map((item) => (
            <li key={item.label} className="opacity-80">
              <span className="font-medium text-text">{item.label} (not applied for you):</span> {item.detail}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Prompt overrides" description="Replaces or reinforces the default instruction sent to the model for this character." surface="bare">
        <TextAreaField
          label="System prompt override"
          hint="Replaces the default instruction entirely."
          rows={3}
          value={form.system_prompt ?? ''}
          onChange={(e) => set('system_prompt', e.target.value)}
        />
        <TextAreaField
          label="Post-history instructions"
          hint="Injected right before the model's turn. Good for reinforcing style or rules."
          rows={2}
          value={form.post_history_instructions ?? ''}
          onChange={(e) => set('post_history_instructions', e.target.value)}
        />
        <SelectField
          label="Instruct template override"
          hint="Overrides the global Settings → Generation default for chats with this character. Useful for a character you always run against a specific model."
          value={instructTemplateId}
          onChange={(e) => setInstructTemplateId(e.target.value)}
        >
          <option value="">Use global default</option>
          <optgroup label="Builtin">
            {BUILTIN_INSTRUCT_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
          {customInstructTemplates.length > 0 && (
            <optgroup label="Custom">
              {customInstructTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          )}
        </SelectField>
        <SelectField
          label="Reply length"
          hint={
            replyLength === 'auto'
              ? (() => {
                  const d = deriveCardReplyBand(form)
                  const from =
                    d.source === 'examples'
                      ? 'measured from this card’s example dialogue'
                      : d.source === 'greeting'
                        ? 'estimated from the greeting (no example dialogue to measure)'
                        : 'default. This card has no example dialogue or greeting to measure'
                  return `${REPLY_LENGTH_HINTS.auto} Currently resolves to "${REPLY_LENGTH_LABELS[d.band]}"${
                    d.measuredWords ? ` (~${d.measuredWords} words/turn)` : ''
                  }, ${from}.`
                })()
              : REPLY_LENGTH_HINTS[replyLength]
          }
          value={replyLength}
          onChange={(e) => setReplyLength(e.target.value as ReplyLength)}
        >
          {(['auto', 'brief', 'moderate', 'detailed'] as const).map((v) => (
            <option key={v} value={v}>
              {REPLY_LENGTH_LABELS[v]}
            </option>
          ))}
        </SelectField>
      </Section>

      <Section title="Metadata" surface="bare">
        <TextField
          label="Tags (comma separated)"
          value={(form.tags ?? []).join(', ')}
          onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
        />
        <div className="grid grid-cols-2 gap-x-3">
          <TextField label="Creator" value={form.creator ?? ''} onChange={(e) => set('creator', e.target.value)} />
          <TextField label="Version" value={form.character_version ?? ''} onChange={(e) => set('character_version', e.target.value)} />
        </div>
        <TextAreaField label="Creator notes" rows={2} value={form.creator_notes ?? ''} onChange={(e) => set('creator_notes', e.target.value)} />
      </Section>

      <Section title="Character lore" description="Lore that belongs to this character specifically. Travels with the card, unlike a standalone lorebook." surface="bare">
        <LorebookEditor
          book={form.character_book ?? { name: `${form.name} Lore`, entries: [], token_budget: 512, scan_depth: 8 }}
          onChange={(book) => set('character_book', book)}
          aiContext={form}
        />
      </Section>
    </div>
  )
}
