import { X } from 'lucide-react'
import type { CommitmentStatus } from '@/lib/types'
import { COMMITMENT_ORDER, formatCommitmentStatus } from '@/lib/dating/stage'
import type { TriggerAction, TriggerCondition, TriggerStat } from '@/lib/world/triggers'

/**
 * The condition and action row editors for one world rule (`lib/world/triggers.ts`).
 *
 * Their own file rather than more of `WorldsView`, which is already among the largest components
 * here — and a rule needs two of these lists, each with a per-kind form that changes shape as the
 * kind changes. Both are controlled and stateless: the world editor owns the rule array, these
 * only ever hand back a new one.
 */

const TRIGGER_STATS: TriggerStat[] = ['affection', 'warmth', 'trust', 'chemistry', 'comfort', 'respect', 'curiosity', 'tension']

const SELECT_CLASS = 'rounded-md bg-bg px-1.5 py-1 text-text outline-none'

export interface KnownFlag {
  id: string
  label: string
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="text-text-muted transition-colors hover:text-danger">
      <X size={11} strokeWidth={2.5} />
    </button>
  )
}

export function TriggerConditionRows({
  conditions,
  knownFlags,
  onChange,
}: {
  conditions: TriggerCondition[]
  knownFlags: KnownFlag[]
  onChange: (next: TriggerCondition[]) => void
}) {
  const set = (i: number, c: TriggerCondition) => onChange(conditions.map((x, j) => (j === i ? c : x)))

  // Switching kind replaces the whole condition rather than merging: the shapes don't overlap, and
  // carrying a stale `stat` onto a `flag_set` would be invalid data the server would then drop.
  const changeKind = (i: number, kind: TriggerCondition['kind']) => {
    if (kind === 'stat_at_least' || kind === 'stat_below') set(i, { kind, stat: 'affection', value: 50 })
    else if (kind === 'flag_set') set(i, { kind, flag: knownFlags[0]?.id ?? 'first_date' })
    else if (kind === 'commitment_at_least') set(i, { kind, status: 'dating' })
    else set(i, { kind: 'day_at_least', day: 1 })
  }

  return (
    <div className="space-y-1.5">
      {conditions.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="w-9 shrink-0 text-text-muted">{i === 0 ? 'When' : 'and'}</span>
          <select
            value={c.kind}
            onChange={(e) => changeKind(i, e.target.value as TriggerCondition['kind'])}
            aria-label="Condition type"
            className={SELECT_CLASS}
          >
            <option value="stat_at_least">stat at least</option>
            <option value="stat_below">stat below</option>
            <option value="flag_set">flag is set</option>
            <option value="commitment_at_least">commitment at least</option>
            <option value="day_at_least">day at least</option>
          </select>

          {(c.kind === 'stat_at_least' || c.kind === 'stat_below') && (
            <>
              <select
                value={c.stat}
                onChange={(e) => set(i, { ...c, stat: e.target.value as TriggerStat })}
                aria-label="Stat"
                className={SELECT_CLASS}
              >
                {TRIGGER_STATS.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                max={100}
                value={c.value}
                onChange={(e) => set(i, { ...c, value: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                aria-label="Threshold"
                className="w-14 rounded-md bg-bg px-1.5 py-1 text-center text-text outline-none"
              />
            </>
          )}

          {c.kind === 'flag_set' && (
            <select
              value={c.flag}
              onChange={(e) => set(i, { kind: 'flag_set', flag: e.target.value })}
              aria-label="Flag"
              className={SELECT_CLASS}
            >
              {knownFlags.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          )}

          {c.kind === 'commitment_at_least' && (
            <select
              value={c.status}
              onChange={(e) => set(i, { kind: 'commitment_at_least', status: e.target.value as CommitmentStatus })}
              aria-label="Commitment"
              className={SELECT_CLASS}
            >
              {COMMITMENT_ORDER.filter((x) => x !== 'none').map((x) => (
                <option key={x} value={x}>
                  {formatCommitmentStatus(x)}
                </option>
              ))}
            </select>
          )}

          {c.kind === 'day_at_least' && (
            <input
              type="number"
              min={0}
              value={c.day}
              onChange={(e) => set(i, { kind: 'day_at_least', day: Math.max(0, Number(e.target.value) || 0) })}
              aria-label="Day"
              className="w-16 rounded-md bg-bg px-1.5 py-1 text-center text-text outline-none"
            />
          )}

          <RemoveButton onClick={() => onChange(conditions.filter((_, j) => j !== i))} label="Remove condition" />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...conditions, { kind: 'stat_at_least', stat: 'affection', value: 50 }])}
        className="text-[11px] text-accent hover:underline"
      >
        + condition
      </button>
    </div>
  )
}

export function TriggerActionRows({
  actions,
  knownFlags,
  onChange,
}: {
  actions: TriggerAction[]
  knownFlags: KnownFlag[]
  onChange: (next: TriggerAction[]) => void
}) {
  const set = (i: number, a: TriggerAction) => onChange(actions.map((x, j) => (j === i ? a : x)))

  return (
    <div className="mt-2 space-y-1.5">
      {actions.map((a, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="w-9 shrink-0 text-text-muted">{i === 0 ? 'Then' : 'and'}</span>
          <select
            value={a.kind}
            onChange={(e) => {
              const kind = e.target.value as TriggerAction['kind']
              if (kind === 'set_flag') set(i, { kind, flag: knownFlags[0]?.id ?? 'first_date' })
              else set(i, { kind, text: '' })
            }}
            aria-label="Action type"
            className={SELECT_CLASS}
          >
            <option value="remember">remember</option>
            <option value="set_flag">set flag</option>
            <option value="notify">notify me</option>
          </select>

          {a.kind === 'set_flag' ? (
            <select
              value={a.flag}
              onChange={(e) => set(i, { kind: 'set_flag', flag: e.target.value })}
              aria-label="Flag to set"
              className={SELECT_CLASS}
            >
              {knownFlags.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={a.text}
              onChange={(e) => set(i, { ...a, text: e.target.value })}
              placeholder={a.kind === 'remember' ? 'A durable fact the model will remember' : 'A note shown to you'}
              aria-label="Action text"
              className="min-w-0 flex-1 rounded-md bg-bg px-2 py-1 text-text outline-none"
            />
          )}

          <RemoveButton onClick={() => onChange(actions.filter((_, j) => j !== i))} label="Remove action" />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...actions, { kind: 'remember', text: '' }])}
        className="text-[11px] text-accent hover:underline"
      >
        + action
      </button>
    </div>
  )
}
