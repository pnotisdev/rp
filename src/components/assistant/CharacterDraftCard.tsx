// The review card for a drafted character: the core card up front, one collapsible block per build stage, and Save.

import { UserPlus } from 'lucide-react'
import { describeDraft } from '@/lib/assistant/draftSummary'
import type { GeneratedCharacter } from '@/lib/assistant/thread'
import { STAGE_LABELS, type OptionalStage } from '@/lib/characters/generateFullCharacter'
import { Button } from '@/components/ui/Button'

function Rows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2">
          <dt className="w-24 shrink-0 text-[10px] uppercase tracking-[0.06em] text-text-muted/70">{row.label}</dt>
          <dd className="min-w-0 flex-1 whitespace-pre-wrap text-text">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function CharacterDraftCard({
  generated,
  busy,
  onSave,
  onRedo,
}: {
  generated: GeneratedCharacter
  busy: boolean
  onSave: () => void
  onRedo: (stage: OptionalStage) => void
}) {
  const { card, failedStages, skippedStages, savedCharacterId } = generated
  const core = [
    { label: 'Personality', value: card.personality },
    { label: 'Scenario', value: card.scenario },
    { label: 'First message', value: card.first_mes },
  ].filter((r) => r.value?.trim())
  const failed = failedStages ?? []
  const skipped = skippedStages ?? []

  return (
    <div className="mt-3 rounded-xl border border-romance/40 bg-romance/5 p-4">
      <div className="text-base font-semibold text-romance">{card.name}</div>
      <p className="mt-1 whitespace-pre-wrap text-xs text-text-muted">{card.description}</p>
      <div className="mt-3 border-t border-romance/20 pt-3 text-xs">
        <Rows rows={core} />
      </div>
      <div className="mt-3 border-t border-romance/20 text-xs">
        {describeDraft(generated).map((s) => {
          const skip = skipped.find((x) => x.stage === s.stage)
          return (
            <details key={s.stage} className="border-b border-romance/10 py-1.5">
              <summary className="flex cursor-pointer select-none items-center gap-2">
                <span className={s.rows.length ? 'text-text' : 'text-text-muted'}>{s.label}</span>
                <span className={`text-[10px] ${failed.includes(s.stage) ? 'text-warning' : 'text-text-muted/70'}`}>
                  {s.rows.length ? s.rows.length : skip ? 'left blank' : failed.includes(s.stage) ? 'nothing usable' : 'empty'}
                </span>
              </summary>
              <div className="space-y-2 pb-1 pt-2">
                {skip && <p className="text-text-muted">{skip.reason}</p>}
                {s.rows.length > 0 && <Rows rows={s.rows} />}
                {!savedCharacterId && !skip && (
                  <Button variant="ghost" onClick={() => onRedo(s.stage)} disabled={busy}>
                    {s.rows.length ? 'Redo this section' : 'Write this section'}
                  </Button>
                )}
              </div>
            </details>
          )
        })}
      </div>
      {failed.length > 0 && !savedCharacterId && (
        <p className="mt-3 text-xs text-warning">
          Some sections came back empty ({failed.map((s) => STAGE_LABELS[s as OptionalStage] ?? s).join(', ')}). Write them again above, or fill them in after saving.
        </p>
      )}
      <div className="mt-3">
        {savedCharacterId ? (
          <span className="text-xs text-success">Saved to your characters.</span>
        ) : (
          <Button variant="primary" onClick={onSave} className="inline-flex items-center gap-1.5">
            <UserPlus size={14} />
            Save to characters
          </Button>
        )}
      </div>
    </div>
  )
}
