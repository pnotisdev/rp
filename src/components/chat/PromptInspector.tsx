import { useEffect, useState } from 'react'
import type { PromptBuildResult } from '@/lib/prompt/builder'
import { Button } from '@/components/ui/Button'

export function PromptInspector({
  loadPrompt,
  summary,
  onUpdateSummary,
  onClose,
}: {
  loadPrompt: () => Promise<PromptBuildResult | null>
  summary?: string
  onUpdateSummary: () => Promise<string | null>
  onClose: () => void
}) {
  const [result, setResult] = useState<PromptBuildResult | null | 'error'>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadPrompt()
      .then((r) => !cancelled && setResult(r))
      .catch(() => !cancelled && setResult('error'))
    return () => {
      cancelled = true
    }
  }, [loadPrompt])

  const refreshSummary = async () => {
    setSummarizing(true)
    setSummaryError(null)
    try {
      await onUpdateSummary()
      const r = await loadPrompt()
      setResult(r)
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : String(e))
    } finally {
      setSummarizing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-bg-elevated p-7 themed-shadow">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Prompt inspector</h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        {result === null && <p className="text-sm text-text-muted">Building…</p>}
        {result === 'error' && (
          <p className="text-sm text-danger">Couldn't build the prompt — pick a character first.</p>
        )}
        {result && result !== 'error' && (
          <div className="flex-1 overflow-y-auto">
            <div className="mb-5 flex flex-wrap gap-4 text-xs text-text-muted">
              <span>
                <strong className="text-text">{result.tokensUsed}</strong> / {result.contextBudget} tok used
              </span>
              <span>
                <strong className="text-text">{result.includedMessageCount}</strong> messages included
              </span>
              {result.excludedMessageCount > 0 && (
                <span className="text-danger">{result.excludedMessageCount} older messages dropped (context full)</span>
              )}
            </div>

            <div className="mb-5 rounded-xl bg-bg-sunken p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-text-muted">Long-term memory (summary)</h3>
                <Button variant="ghost" onClick={refreshSummary} disabled={summarizing}>
                  {summarizing ? 'Updating…' : '↻ Update now'}
                </Button>
              </div>
              {summaryError && <p className="mb-2 text-xs text-danger">{summaryError}</p>}
              {summary?.trim() ? (
                <p className="text-xs text-text">{summary}</p>
              ) : (
                <p className="text-xs text-text-muted">
                  No summary yet — once this chat has enough history, older turns are folded in here
                  automatically so they aren't just dropped when the context fills up.
                </p>
              )}
            </div>

            <h3 className="mb-1 text-xs font-semibold text-text-muted">
              World info activated ({result.activatedEntries.length})
            </h3>
            {result.activatedEntries.length === 0 ? (
              <p className="mb-5 text-xs text-text-muted">
                None matched the recent conversation yet — add keywords, or set an entry to "Always".
              </p>
            ) : (
              <ul className="mb-5 space-y-1 text-xs">
                {result.activatedEntries.map((e) => (
                  <li key={e.id} className="rounded-lg bg-bg-sunken px-2.5 py-1.5">
                    <span className="font-medium text-text">{e.keys.join(', ') || '(no keys)'}</span>
                    <span className="text-text-muted"> — {e.content.slice(0, 80)}</span>
                  </li>
                ))}
              </ul>
            )}
            {result.droppedForBudget.length > 0 && (
              <p className="mb-5 text-xs text-danger">
                {result.droppedForBudget.length} entr{result.droppedForBudget.length === 1 ? 'y' : 'ies'} matched but
                didn't fit the lorebook's token budget: {result.droppedForBudget.map((e) => e.keys[0] ?? e.comment).join(', ')}
              </p>
            )}

            <h3 className="mb-1 text-xs font-semibold text-text-muted">Exact text sent to the model</h3>
            <pre className="whitespace-pre-wrap rounded-xl bg-bg-sunken p-4 text-xs text-text">{result.prompt}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
