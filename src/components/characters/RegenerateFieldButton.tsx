import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useChatBackendClient } from '@/lib/hooks/useChatBackendClient'
import { regenerateCardField } from '@/lib/characters/aiAssist'
import type { CharacterCardData } from '@/lib/characters/cardSpec'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { Button } from '@/components/ui/Button'

/**
 * The per-field "rewrite with AI" control in the character editor. Clicking opens a small popover
 * with an optional steer ("colder, ex-military", "less mystery, more specifics") — the fastest fix
 * when the plain rewrite still comes back generic — then runs `regenerateCardField`, which grounds
 * the rewrite in the current text and the rest of the card rather than inventing from scratch.
 */
export function RegenerateFieldButton({
  character,
  fieldKey,
  onResult,
}: {
  character: CharacterCardData
  fieldKey: 'description' | 'personality' | 'scenario'
  onResult: (text: string) => void
}) {
  const client = useChatBackendClient()
  const styleGuidance = useSettingsStore((s) => s.styleGuidance)
  const [open, setOpen] = useState(false)
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const text = await regenerateCardField(client, character, fieldKey, {
        hint: hint.trim() || undefined,
        styleGuidance,
      })
      if (text) {
        onResult(text)
        setOpen(false)
        setHint('')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Rewrite this field with AI, keeping it consistent with the rest of the card"
        aria-label="Rewrite this field with AI"
        aria-expanded={open}
        className={`transition-colors hover:text-accent ${open ? 'text-accent' : 'text-text-muted'}`}
      >
        <RotateCcw size={13} strokeWidth={2} className={busy ? 'animate-spin' : ''} />
      </button>

      {open && (
        // Not a <label>-based Field here: this popover renders inside the parent field's own <label>
        // (the `actions` slot), and nesting labels misroutes focus.
        <div className="absolute right-0 top-6 z-20 w-64 rounded-xl border border-border bg-bg-elevated p-3 text-left shadow-xl">
          <span className="mb-1 block text-xs font-medium text-text-muted">Rewrite with AI</span>
          <textarea
            rows={2}
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run()
            }}
            placeholder="Optional: what to change, e.g. colder, ex-military"
            disabled={busy}
            autoFocus
            className="w-full resize-y rounded-xl bg-bg-sunken px-3 py-2 text-sm leading-relaxed text-text outline-none ring-1 ring-transparent transition-shadow placeholder:text-text-muted/55 focus:ring-accent/40"
          />
          <p className="mt-1 text-[11px] text-text-muted">
            Leave blank for a straight pass. It keeps the facts and reworks the prose.
            {styleGuidance.trim() && ' Your writing style from Settings is applied.'}
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={run} disabled={busy}>
              {busy ? 'Rewriting…' : 'Rewrite'}
            </Button>
          </div>
          {error && <p className="mt-2 rounded-lg bg-danger/10 p-2 text-[11px] text-danger">{error}</p>}
        </div>
      )}
    </span>
  )
}
