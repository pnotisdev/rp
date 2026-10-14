import { useRef, useState } from 'react'
import { worldsApi } from '@/lib/api/client'
import { resolveAssistShaping } from '@/lib/api/assistShaping'
import { isAbortError } from '@/lib/characters/generateFullCharacter'
import { useChatBackendClient } from '@/lib/hooks/useChatBackendClient'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { errorMessage, toastError, toastInfo, toastSuccess } from '@/lib/store/useToastStore'
import type { WorldCard } from '@/lib/types'
import { WORLD_STAGE_LABELS, draftWorld, toLorebookEntries, type WorldStage, type WorldStageStatus } from '@/lib/world/generateWorld'
import type { WorldTemplateId } from '@/lib/world/worldTemplates'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { LoreReviewList, type ReviewEntry } from '@/components/worldinfo/LoreReviewList'

type Step = 'brief' | 'working' | 'review'
type StageState = Record<WorldStage, WorldStageStatus | 'pending'>

const EXAMPLES = [
  'A fog-bound fishing town where the tide decides the working day',
  'A cozy magic academy that is quietly failing its inspection',
  'Cyberpunk Osaka in 2090, run by rival delivery guilds',
]

const GLYPH: Record<WorldStageStatus | 'pending', string> = { pending: '·', start: '…', done: '✓', failed: '✕' }

/** Briefs a world into existence: the model drafts the setting, rules and lore, and nothing is saved until the user reviews it. */
export function GenerateWorldDialog({ onCreated, onClose }: { onCreated: (world: WorldCard) => void; onClose: () => void }) {
  const client = useChatBackendClient()
  const styleGuidance = useSettingsStore((s) => s.styleGuidance)
  const [step, setStep] = useState<Step>('brief')
  const [brief, setBrief] = useState('')
  const [template, setTemplate] = useState<WorldTemplateId>('freeform')
  const [amount, setAmount] = useState<'8' | '16' | '24'>('16')
  const [stages, setStages] = useState<StageState>({ core: 'pending', lore: 'pending' })
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rules, setRules] = useState('')
  const [entries, setEntries] = useState<ReviewEntry[]>([])
  const [saving, setSaving] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const stop = () => abortRef.current?.abort()

  const generate = async () => {
    if (!brief.trim()) return
    setStep('working')
    setStages({ core: 'pending', lore: 'pending' })
    setProgress(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const draft = await draftWorld(
        client,
        { brief, loreCount: Number(amount), styleGuidance },
        {
          shaping: await resolveAssistShaping(120_000),
          signal: controller.signal,
          onStage: (stage, status) => setStages((prev) => ({ ...prev, [stage]: status })),
          onBatch: (done, total) => setProgress({ done, total }),
        },
      )
      setName(draft.name)
      setDescription(draft.description)
      setRules(draft.rules)
      setEntries(draft.entries.map((e) => ({ ...e, keep: true })))
      if (draft.failed.length) toastInfo("The setting was drafted, but the lorebook step produced nothing usable. You can add lore in the editor.")
      setStep('review')
    } catch (e) {
      if (!isAbortError(e) && !controller.signal.aborted) toastError(`${errorMessage(e)}. Try again, or try a model that follows instructions more closely.`)
      setStep('brief')
    } finally {
      abortRef.current = null
    }
  }

  const create = async () => {
    setSaving(true)
    try {
      const world = await worldsApi.create({
        name: name.trim(),
        description: description.trim(),
        rules: rules.trim(),
        template,
        lorebook: { name: '', entries: toLorebookEntries(entries.filter((e) => e.keep)), token_budget: 512, scan_depth: 8 },
      })
      toastSuccess(`Created "${world.name}"`)
      onCreated(world)
    } catch (e) {
      toastError(errorMessage(e))
      setSaving(false)
    }
  }

  return (
    <Modal
      onClose={step === 'working' ? stop : onClose}
      title="Generate a world with AI"
      description={
        step === 'review'
          ? 'Review what the model wrote. Edit anything, untick lore you do not want, then create the world.'
          : 'Describe the setting. The connected model drafts its description, rules and lore for you to review before anything is saved.'
      }
      size="xl"
      scrollable
    >
      <div className="flex-1 overflow-y-auto">
        {step === 'brief' && (
          <>
            <TextAreaField label="What kind of world?" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. a fog-bound fishing town where the tide decides the working day" />
            <div className="mb-5 flex flex-wrap gap-1.5">
              {EXAMPLES.map((example) => (
                <Chip key={example} on={brief === example} onClick={() => setBrief(example)}>
                  {example}
                </Chip>
              ))}
            </div>
            <p className="mb-1 text-xs font-medium text-text-muted">Play style</p>
            <SegmentedControl
              className="mb-5"
              options={[
                { value: 'freeform', label: 'Freeform' },
                { value: 'visual_novel', label: 'Visual novel' },
                { value: 'dating_sim', label: 'Dating sim' },
              ]}
              value={template}
              onChange={setTemplate}
            />
            <p className="mb-1 text-xs font-medium text-text-muted">How much lore</p>
            <SegmentedControl
              options={[
                { value: '8', label: 'A few' },
                { value: '16', label: 'Some' },
                { value: '24', label: 'Lots' },
              ]}
              value={amount}
              onChange={setAmount}
            />
            {styleGuidance.trim() && <p className="mt-4 text-[11px] text-text-muted">Your writing style from Settings is applied.</p>}
          </>
        )}

        {step === 'working' && (
          <ul className="space-y-1 rounded-xl bg-bg-sunken p-4 text-sm">
            {(['core', 'lore'] as WorldStage[]).map((stage) => {
              const status = stages[stage]
              const tone = status === 'failed' ? 'text-danger' : status === 'done' ? 'text-text' : status === 'start' ? 'text-accent' : 'text-text-muted'
              return (
                <li key={stage} className={tone}>
                  <span className="inline-block w-5 tabular-nums">{GLYPH[status]}</span>
                  {WORLD_STAGE_LABELS[stage]}
                  {stage === 'lore' && progress && status === 'start' ? ` (${progress.done} of ${progress.total})` : ''}
                  {status === 'start' && ' …'}
                </li>
              )
            })}
          </ul>
        )}

        {step === 'review' && (
          <>
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <TextAreaField label="Description" rows={7} value={description} onChange={(e) => setDescription(e.target.value)} />
            <TextAreaField label="Rules" rows={4} value={rules} onChange={(e) => setRules(e.target.value)} hint="Hard limits the model should never contradict." />
            <p className="mb-2 mt-5 text-sm font-semibold text-text">Lore</p>
            {entries.length > 0 ? <LoreReviewList entries={entries} onChange={setEntries} /> : <p className="rounded-xl bg-bg-sunken p-3 text-xs text-text-muted">No lore came back. You can still create the world and add lore in the editor.</p>}
          </>
        )}
      </div>

      <div className="mt-4 flex shrink-0 justify-end gap-2">
        {step === 'brief' && (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void generate()} disabled={!brief.trim()}>
              Generate
            </Button>
          </>
        )}
        {step === 'working' && (
          <Button variant="ghost" onClick={stop}>
            Stop
          </Button>
        )}
        {step === 'review' && (
          <>
            <Button variant="ghost" onClick={() => setStep('brief')} disabled={saving}>
              Back
            </Button>
            <Button variant="primary" onClick={() => void create()} disabled={saving || !name.trim()}>
              {saving ? 'Creating…' : 'Create world'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  )
}
