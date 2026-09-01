import { useState } from 'react'
import { KoboldClient } from '@/lib/api/kobold'
import { normalizeCardJson, type CharacterCardData } from '@/lib/characters/cardSpec'
import { parseLenientJson } from '@/lib/jsonRepair'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { Button } from '@/components/ui/Button'
import { TextAreaField } from '@/components/ui/Field'

const SYSTEM_INSTRUCTION = `You write character cards for a roleplay app. Given a short brief, output ONLY a single JSON object (no markdown fences, no commentary before or after) with exactly these fields, ALL of which are plain strings (never arrays or nested objects): name, description, personality, scenario, first_mes, mes_example, creator_notes — plus one array field, "tags", which is an array of short lowercase strings. "description" covers appearance and background. "personality" is a concise trait list capturing how they speak, act and feel. "first_mes" is the character's opening line in-character, written in their voice. "mes_example" is a SINGLE STRING (not an array!) containing 1-2 short example exchanges demonstrating their exact speech pattern, using {{user}} and {{char}} as placeholders, with \\n between lines.

Critical JSON formatting rules: output strictly valid JSON. Every string value must be on a single logical line — anywhere you need a line break inside a string, write the two characters backslash-n (\\n), never an actual newline. Every property and every array element MUST be followed by a comma unless it is the very last one before a closing } or ]. Use straight double quotes only.`

export function GenerateCharacterDialog({
  onGenerated,
  onClose,
}: {
  onGenerated: (card: CharacterCardData) => void
  onClose: () => void
}) {
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawOutput, setRawOutput] = useState('')

  const generate = async () => {
    if (!brief.trim()) return
    setBusy(true)
    setError(null)
    setRawOutput('')
    try {
      const client = new KoboldClient(baseUrl)
      const prompt = `${SYSTEM_INSTRUCTION}\n\nBrief: ${brief.trim()}\n\nJSON:`
      const text = await client.generate({
        prompt,
        max_length: 1024,
        max_context_length: 4096,
        temperature: 0.8,
        top_p: 0.95,
        top_k: 0,
        min_p: 0.05,
        typical: 1,
        tfs: 1,
        rep_pen: 1.1,
        rep_pen_range: 1024,
        rep_pen_slope: 0.7,
        stop_sequence: ['\n\n\n', '```'],
        trim_stop: true,
      })
      setRawOutput(text)
      const json = parseLenientJson(text)
      const card = normalizeCardJson(json)
      if (!card.name.trim()) card.name = brief.trim().slice(0, 40) || 'New Character'
      onGenerated(card)
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} — the model's output wasn't valid JSON. Try again, or try a lower-temperature/more instruction-following model.`
          : String(e),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-bg-elevated p-7 themed-shadow">
        <h2 className="mb-1 text-sm font-semibold text-text">Generate a character with AI</h2>
        <p className="mb-3 text-xs text-text-muted">
          Describe who you want; the connected model will draft a full card for you to review and edit.
        </p>
        <TextAreaField
          label="Brief"
          rows={3}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. a grumpy dwarven blacksmith who secretly writes poetry, gruff but soft-hearted"
        />
        {error && (
          <div className="mb-3 rounded-xl bg-danger/10 p-3 text-xs text-danger">
            {error}
            {rawOutput && (
              <details className="mt-1.5">
                <summary className="cursor-pointer">Raw model output</summary>
                <pre className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-bg-sunken p-2 text-text">
                  {rawOutput}
                </pre>
              </details>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={generate} disabled={busy || !brief.trim()}>
            {busy ? 'Generating…' : error ? 'Retry' : 'Generate'}
          </Button>
        </div>
      </div>
    </div>
  )
}
