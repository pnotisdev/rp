import {
  BookMarked,
  
  
  
  History,
  
  
  
  
  Settings2,
  
  
  
  
  
  X,
} from 'lucide-react'
import { WORLD_TEMPLATES, normalizeWorldTemplateId, type WorldTemplateId } from '@/lib/world/worldTemplates'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import { SelectField } from '@/components/ui/Field'
import { formatDeltas } from './helpers'
import type { EditorState } from './useRelationshipPanel'

export function MoreTab({ f }: { f: EditorState }) {
  const { chat, overrideValue, setOverride, vnModeOverrideValue, setVnModeOverride, setChatMode, events, activeFacts, newFactText, setNewFactText, addFact, retireFact } = f
  return (
    <div className="space-y-3">
      <Section
        title="Chat settings"
        icon={Settings2}
        surface="sunken"
        contentClassName="!p-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <SelectField
          label="Play style"
          hint="Just a label, shown in the header and chat list. It doesn't touch the toggles below."
          value={normalizeWorldTemplateId(chat.mode)}
          onChange={(e) => setChatMode(e.target.value as WorldTemplateId)}
        >
          {WORLD_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Track relationship for this chat"
          hint="Overrides the global Settings → Generation default, just for this chat."
          value={overrideValue('autoTrackRelationship')}
          onChange={(e) => setOverride('autoTrackRelationship', e.target.value as 'default' | 'on' | 'off')}
        >
          <option value="default">Use global default</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </SelectField>
        <SelectField
          label="Suggest choices for this chat"
          hint="Overrides the global Settings → Generation default, just for this chat."
          value={overrideValue('autoSuggestChoices')}
          onChange={(e) => setOverride('autoSuggestChoices', e.target.value as 'default' | 'on' | 'off')}
        >
          <option value="default">Use global default</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </SelectField>
        <SelectField
          label="Visual Novel mode for this chat"
          hint="Overrides the global Settings → Appearance default, just for this chat. 'Auto' turns it on only once this character has sprites and the world has scene art."
          value={vnModeOverrideValue()}
          onChange={(e) => setVnModeOverride(e.target.value as 'default' | 'on' | 'off' | 'auto')}
        >
          <option value="default">Use global default</option>
          <option value="on">On</option>
          <option value="auto">Auto</option>
          <option value="off">Off</option>
        </SelectField>
      </Section>

      {/* Chat-wide, not per-character — stays the same across the character switcher above. */}
      <Section title="What's remembered in this chat" icon={BookMarked} surface="sunken" contentClassName="!p-3">
        <div className="mb-3 flex flex-wrap gap-2">
          {activeFacts.map((f) => (
            <button
              key={f.id}
              onClick={() => retireFact(f.id)}
              title="Click to forget this"
              className="flex items-center gap-1.5 rounded-md bg-bg-elevated px-3 py-1 text-xs text-text hover:text-danger"
            >
              {f.text}
              <X size={11} strokeWidth={2} />
            </button>
          ))}
          {activeFacts.length === 0 && <span className="text-xs text-text-muted">Nothing remembered yet.</span>}
        </div>
        <div className="flex gap-2">
          <input
            value={newFactText}
            onChange={(e) => setNewFactText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFact()}
            placeholder="Add a fact by hand (e.g. &quot;Allergic to cats&quot;)"
            className="flex-1 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-text outline-none"
          />
          <Button onClick={addFact} disabled={!newFactText.trim()}>Add</Button>
        </div>
      </Section>

      <details className="rounded-xl bg-bg-sunken p-3">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-text">
          <History size={14} strokeWidth={2} className="shrink-0 text-text-muted" />
          History ({events.length})
        </summary>
        <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
          {events.map((e) => (
            <div key={e.id} className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs">
              <div className="text-text">{e.reason}</div>
              <div className="text-text-muted">
                {new Date(e.createdAt).toLocaleString()}
                {formatDeltas(e.deltas) ? ` · ${formatDeltas(e.deltas)}` : ''}
                {e.newFlags?.length ? ` · +${e.newFlags.join(', ')}` : ''}
              </div>
            </div>
          ))}
          {events.length === 0 && <div className="text-xs text-text-muted">Nothing logged yet.</div>}
        </div>
      </details>
    </div>
  )
}
