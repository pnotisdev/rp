import { useRef, useState } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { createImageBackend } from '@/lib/api/createImageBackend'
import { errorMessage } from '@/lib/store/useToastStore'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { TextAreaField } from '@/components/ui/Field'

interface ExpressionOption {
  id: string
  label: string
  hasSprite: boolean
}

/**
 * Section 11's own headline item: "generate a full expression set from one description in a
 * single pass instead of one-off images." One base appearance description, a pick of which
 * expressions to fill in (defaults to whatever doesn't already have art — a bulk regenerate is
 * an explicit opt-in, not the default), then one generation call per expression, sequential
 * rather than parallel — the same reasoning this codebase already applies to a local single-GPU
 * KoboldCpp server extends just as much to a local Stable Diffusion one. Applies each sprite the
 * moment it lands rather than waiting for the whole batch, so a stopped or partially-failed run
 * still keeps everything that did succeed.
 */
export function GenerateExpressionSetDialog({
  expressions,
  initialPrompt,
  onGenerated,
  onClose,
}: {
  expressions: ExpressionOption[]
  initialPrompt: string
  onGenerated: (expressionId: string, dataUrl: string) => void
  onClose: () => void
}) {
  const [basePrompt, setBasePrompt] = useState(initialPrompt)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(expressions.filter((e) => !e.hasSprite).map((e) => e.id)))
  const [busy, setBusy] = useState(false)
  const [stopRequested, setStopRequested] = useState(false)
  // A ref, not just the state above: `generate()` runs as one long-lived async closure, and a
  // `setStopRequested(true)` from the Stop button re-renders the component but can't change what
  // that already-running closure sees for a plain state variable — checking `stopRequested`
  // itself in the loop below would silently never actually stop anything. The ref is mutated
  // in-place and read fresh every iteration, so the check below always sees the current value.
  const stopRef = useRef(false)
  const [progress, setProgress] = useState<{ done: number; total: number; currentLabel: string | null }>({
    done: 0,
    total: 0,
    currentLabel: null,
  })
  const [results, setResults] = useState<{ succeeded: string[]; failed: string[] } | null>(null)

  const imageBackend = useSettingsStore((s) => s.imageBackend)
  const imageBackendBaseUrl = useSettingsStore((s) => s.imageBackendBaseUrl)
  const imageBackendUsername = useSettingsStore((s) => s.imageBackendUsername)
  const imageBackendPassword = useSettingsStore((s) => s.imageBackendPassword)
  const imageBackendModel = useSettingsStore((s) => s.imageBackendModel)

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const generate = async () => {
    const targets = expressions.filter((e) => selected.has(e.id))
    if (!targets.length || busy || !basePrompt.trim()) return
    setBusy(true)
    setStopRequested(false)
    stopRef.current = false
    setResults(null)
    setProgress({ done: 0, total: targets.length, currentLabel: targets[0].label })

    const backend = createImageBackend({ imageBackend, imageBackendBaseUrl, imageBackendUsername, imageBackendPassword, imageBackendModel })
    const succeeded: string[] = []
    const failed: string[] = []

    for (let i = 0; i < targets.length; i++) {
      if (stopRef.current) break
      const exp = targets[i]
      setProgress({ done: i, total: targets.length, currentLabel: exp.label })
      try {
        const result = await backend.generateImage({
          prompt: `${basePrompt.trim()}, ${exp.label.toLowerCase()} expression`,
          width: 832,
          height: 1216,
          steps: 28,
          cfgScale: 7,
          model: imageBackendModel || undefined,
        })
        if (!result.base64) throw new Error('The backend returned no image data.')
        onGenerated(exp.id, `data:image/png;base64,${result.base64}`)
        succeeded.push(exp.label)
      } catch (e) {
        failed.push(`${exp.label} (${errorMessage(e)})`)
      }
      setProgress({ done: i + 1, total: targets.length, currentLabel: exp.label })
    }

    setResults({ succeeded, failed })
    setBusy(false)
  }

  return (
    <Modal
      onClose={onClose}
      title="Generate expression set"
      description="One base description, generated once per expression below — each lands in its slot as it finishes, so stopping partway still keeps what's already done."
      size="lg"
      scrollable
    >
      <TextAreaField
        label="Base appearance"
        rows={3}
        value={basePrompt}
        onChange={(e) => setBasePrompt(e.target.value)}
        placeholder="e.g. portrait of Sumire, dark purple twintails, library background"
        hint={`Sends to ${imageBackend} — see Settings → Images. Each expression appends its own name to this.`}
      />

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-medium text-text">Expressions ({selected.size} selected)</span>
          <div className="flex gap-2">
            <button type="button" className="text-xs text-accent hover:underline" onClick={() => setSelected(new Set(expressions.map((e) => e.id)))}>
              Select all
            </button>
            <button type="button" className="text-xs text-accent hover:underline" onClick={() => setSelected(new Set())}>
              Select none
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {expressions.map((exp) => (
            <Chip key={exp.id} on={selected.has(exp.id)} onClick={() => toggle(exp.id)} disabled={busy}>
              {exp.label}
              {exp.hasSprite && ' •'}
            </Chip>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-text-muted">Pre-selected: expressions with no art yet. A dot marks one that already has a sprite.</p>
      </div>

      {busy && (
        <div className="mt-4 rounded-xl bg-bg-elevated p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-text">
              Generating {progress.currentLabel} ({progress.done + 1} of {progress.total})…
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                stopRef.current = true
                setStopRequested(true)
              }}
              disabled={stopRequested}
            >
              {stopRequested ? 'Stopping…' : 'Stop'}
            </Button>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-sunken">
            <div className="h-full bg-accent transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
        </div>
      )}

      {results && (
        <div className="mt-4 rounded-xl bg-bg-elevated p-4 text-xs">
          {results.succeeded.length > 0 && <p className="text-text">Generated: {results.succeeded.join(', ')}</p>}
          {results.failed.length > 0 && <p className="mt-1 text-danger">Failed: {results.failed.join('; ')}</p>}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {results ? 'Close' : 'Cancel'}
        </Button>
        {!results && (
          <Button variant="primary" onClick={generate} disabled={busy || !selected.size || !basePrompt.trim()}>
            {busy ? 'Generating…' : `Generate ${selected.size || ''}`}
          </Button>
        )}
      </div>
    </Modal>
  )
}
