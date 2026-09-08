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

/** Same shape as `KnownFlag` — a rule's own id/label — kept as a distinct alias since a `trigger_fired` condition picks from the world's OTHER rules, not its scene flags. */
export type KnownTrigger = KnownFlag

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
  knownTriggers = [],
  onChange,
}: {
  conditions: TriggerCondition[]
  knownFlags: KnownFlag[]
  /** Other rules in this world a `trigger_fired` condition can reference — the caller excludes this rule's own id, since a rule can never reference itself. Defaults to none, which still works: the condition falls back to a free-typed id field. */
  knownTriggers?: KnownTrigger[]
  onChange: (next: TriggerCondition[]) => void
}) {
  const set = (i: number, c: TriggerCondition) => onChange(conditions.map((x, j) => (j === i ? c : x)))

  // Switching kind replaces the whole condition rather than merging: the shapes don't overlap, and
  // carrying a stale `stat` onto a `flag_set` would be invalid data the server would then drop.
  const changeKind = (i: number, kind: TriggerCondition['kind']) => {
    if (kind === 'stat_at_least' || kind === 'stat_below') set(i, { kind, stat: 'affection', value: 50 })
    else if (kind === 'flag_set') set(i, { kind, flag: knownFlags[0]?.id ?? 'first_date' })
    else if (kind === 'commitment_at_least') set(i, { kind, status: 'dating' })
    else if (kind === 'trigger_fired') set(i, { kind, triggerId: knownTriggers[0]?.id ?? '' })
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
            <option value="trigger_fired">another rule has fired</option>
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

          {c.kind === 'trigger_fired' &&
            (knownTriggers.length > 0 ? (
              <select
                value={c.triggerId}
                onChange={(e) => set(i, { kind: 'trigger_fired', triggerId: e.target.value })}
                aria-label="Rule"
                className={SELECT_CLASS}
              >
                {knownTriggers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={c.triggerId}
                onChange={(e) => set(i, { kind: 'trigger_fired', triggerId: e.target.value })}
                placeholder="another rule's id"
                aria-label="Rule id"
                className="min-w-0 flex-1 rounded-md bg-bg px-2 py-1 text-text outline-none"
              />
            ))}

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
        <div key={i} className={`flex flex-wrap gap-1.5 text-[11px] ${a.kind === 'start_scene' ? 'items-start' : 'items-center'}`}>
          <span className="w-9 shrink-0 pt-1 text-text-muted">{i === 0 ? 'Then' : 'and'}</span>
          <select
            value={a.kind}
            onChange={(e) => {
              const kind = e.target.value as TriggerAction['kind']
              if (kind === 'set_flag') set(i, { kind, flag: knownFlags[0]?.id ?? 'first_date' })
              else if (kind === 'social_reaction') set(i, { kind, topic: '' })
              else if (kind === 'start_scene') set(i, { kind, title: '', description: '', objectiveTitle: '' })
              else set(i, { kind, text: '' })
            }}
            aria-label="Action type"
            className={SELECT_CLASS}
          >
            <option value="remember">remember</option>
            <option value="set_flag">set flag</option>
            <option value="notify">notify me</option>
            <option value="social_reaction">a named connection reacts</option>
            <option value="start_scene">starts a scene</option>
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
          ) : a.kind === 'social_reaction' ? (
            <input
              value={a.topic}
              onChange={(e) => set(i, { kind: 'social_reaction', topic: e.target.value })}
              placeholder="What they heard about, e.g. the engagement. Picks one of the character's own authored connections to react"
              aria-label="Topic a connection reacts to"
              className="min-w-0 flex-1 rounded-md bg-bg px-2 py-1 text-text outline-none"
            />
          ) : a.kind === 'start_scene' ? (
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <input
                value={a.title}
                onChange={(e) => set(i, { ...a, title: e.target.value })}
                placeholder="Scene title (e.g. She asks you to walk her home)"
                aria-label="Scene title"
                className="w-full rounded-md bg-bg px-2 py-1 text-text outline-none"
              />
              <input
                value={a.description}
                onChange={(e) => set(i, { ...a, description: e.target.value })}
                placeholder="A line or two setting up the moment"
                aria-label="Scene description"
                className="w-full rounded-md bg-bg px-2 py-1 text-text outline-none"
              />
              <input
                value={a.objectiveTitle}
                onChange={(e) => set(i, { ...a, objectiveTitle: e.target.value })}
                placeholder="Objective shown to the player (e.g. Walk her home)"
                aria-label="Scene objective"
                className="w-full rounded-md bg-bg px-2 py-1 text-text outline-none"
              />
              <input
                value={a.objectiveDescription ?? ''}
                onChange={(e) => set(i, { ...a, objectiveDescription: e.target.value || undefined })}
                placeholder="Objective detail (optional)"
                aria-label="Scene objective detail"
                className="w-full rounded-md bg-bg px-2 py-1 text-text outline-none"
              />
              <p className="text-text-muted">
                Fires as a free, no-energy-cost live scene. No hidden agenda or walkout risk, same as any other hangout.
              </p>
            </div>
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
