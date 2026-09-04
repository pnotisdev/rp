import { useState } from 'react'
import { KoboldClient } from '@/lib/api/kobold'
import { normalizeCardJson, type CharacterCardData } from '@/lib/characters/cardSpec'
import { parseLenientJson } from '@/lib/jsonRepair'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { TextAreaField } from '@/components/ui/Field'

const SYSTEM_INSTRUCTION = `You write character cards for a roleplay app. Given a short brief, output ONLY a single JSON object (no markdown fences, no commentary before or after) with exactly these fields, ALL of which are plain strings (never arrays or nested objects): name, description, personality, scenario, first_mes, mes_example, creator_notes, plus one array field, "tags", which is an array of short lowercase strings. "description" covers appearance and background. "personality" is a concise trait list capturing how they speak, act and feel. "first_mes" is the character's opening line in-character, written in their voice. "mes_example" is a SINGLE STRING (not an array!) containing 1-2 short example exchanges demonstrating their exact speech pattern, using {{user}} and {{char}} as placeholders, with \\n between lines.

Write like a person, not like an AI. Plain, concrete language. No em dashes. Avoid stock phrasing: "a mix of X and Y", "not just X but Y", tidy lists of three, and lines that tell the reader how to feel. Give the character a specific voice in the personality and example fields rather than a generic pleasant one.

Critical JSON formatting rules: output strictly valid JSON. Every string value must be on a single logical line. Anywhere you need a line break inside a string, write the two characters backslash-n (\\n), never an actual newline. Every property and every array element MUST be followed by a comma unless it is the very last one before a closing } or ]. Use straight double quotes only.`

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
  const [failed, setFailed] = useState(false)
  const [rawOutput, setRawOutput] = useState('')

  const generate = async () => {
    if (!brief.trim()) return
    setBusy(true)
    setFailed(false)
    setRawOutput('')
    try {
      const client = new KoboldClient(baseUrl)
      const prompt = `${SYSTEM_INSTRUCTION}\n\nBrief: ${brief.trim()}\n\nJSON:`
      const text = await client.generate({
        prompt,
        max_length: 1024,
        max_context_length: await client.getEffectiveMaxContext(),
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
      setFailed(true)
      toastError(`${errorMessage(e)} — the model's output wasn't valid JSON. Try again, or try a lower-temperature/more instruction-following model.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Generate a character with AI"
      description="Describe who you want; the connected model will draft a full card for you to review and edit."
      size="lg"
    >
      <TextAreaField
        label="Brief"
        rows={3}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="e.g. a grumpy dwarven blacksmith who secretly writes poetry, gruff but soft-hearted"
      />
      {failed && rawOutput && (
        <details className="mb-3 rounded-xl bg-bg-sunken p-3 text-xs text-text-muted">
          <summary className="cursor-pointer">Raw model output</summary>
          <pre className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-bg-elevated p-2 text-text">
            {rawOutput}
          </pre>
        </details>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={generate} disabled={busy || !brief.trim()}>
          {busy ? 'Generating…' : failed ? 'Retry' : 'Generate'}
        </Button>
      </div>
    </Modal>
  )
}
