// "Ask AI" strip under the Studio editor: describe a change, the model rewrites files into the draft.

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { resolveAssistShaping } from '@/lib/api/assistShaping'
import { isAbortError } from '@/lib/characters/generateFullCharacter'
import { askStudio, type StudioChanges, type StudioSnapshot } from '@/lib/extensions/studioAssist'
import { useChatBackendClient } from '@/lib/hooks/useChatBackendClient'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import guide from '../../../docs/guides/extensions.md?raw'

const IDEAS = ['Add a reset button', 'Make it look cleaner', 'Remember the last value between sessions']

export function StudioAiBar({
  snapshot,
  onApply,
  onUndo,
  canUndo,
}: {
  snapshot: StudioSnapshot
  onApply: (changes: StudioChanges) => void
  onUndo: () => void
  canUndo: boolean
}) {
  const client = useChatBackendClient()
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  async function run() {
    if (!request.trim() || busy) return
    setBusy(true)
    setSummary('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const changes = await askStudio(client, request, snapshot, { guide, shaping: await resolveAssistShaping(240_000), signal: controller.signal })
      onApply(changes)
      const names = [...(changes.manifest !== undefined ? ['manifest.json'] : []), ...Object.keys(changes.files)]
      setSummary(`Changed ${names.join(', ')}. Check the preview, then Save.`)
      setRequest('')
    } catch (e) {
      if (!isAbortError(e) && !controller.signal.aborted) toastError(errorMessage(e))
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-3">
      <div className="flex items-center gap-2">
        <input
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run()}
          disabled={busy}
          placeholder="Ask AI to change this extension…"
          aria-label="Ask AI to change this extension"
          className="min-w-0 flex-1 rounded-xl border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted/60 focus:border-accent/70"
        />
        {busy ? (
          <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void run()} disabled={!request.trim()}>
            Apply
          </Button>
        )}
        {canUndo && !busy && (
          <Button variant="ghost" onClick={onUndo}>
            Undo
          </Button>
        )}
      </div>
      {busy && <p className="mt-2 text-xs text-text-muted">Writing the change. This can take a minute on a local model…</p>}
      {!busy && summary && <p className="mt-2 text-xs text-text-muted">{summary}</p>}
      {!busy && !summary && !request && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {IDEAS.map((idea) => (
            <button key={idea} type="button" onClick={() => setRequest(idea)} className="rounded-lg px-2 py-1 text-[11px] text-text-muted ring-1 ring-border transition-colors hover:text-text">
              {idea}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
