import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useChatBackendClient } from '@/lib/hooks/useChatBackendClient'
import { regenerateCardField } from '@/lib/characters/aiAssist'
import type { CharacterCardData } from '@/lib/characters/cardSpec'

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const text = await regenerateCardField(client, character, fieldKey)
      if (text) onResult(text)
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
        onClick={run}
        disabled={busy}
        title="Regenerate this field with AI, keeping it consistent with the rest of the card"
        aria-label="Regenerate this field with AI"
        className="text-text-muted transition-colors hover:text-accent disabled:opacity-40"
      >
        <RotateCcw size={13} strokeWidth={2} className={busy ? 'animate-spin' : ''} />
      </button>
      {error && (
        <span className="absolute right-0 top-5 z-10 w-48 rounded-lg bg-danger/10 p-2 text-[11px] text-danger">
          {error}
        </span>
      )}
    </span>
  )
}
