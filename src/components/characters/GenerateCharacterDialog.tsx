import { useState } from 'react'
import { useChatBackendClient } from '@/lib/hooks/useChatBackendClient'
import { normalizeCardJson, type CharacterCardData } from '@/lib/characters/cardSpec'
import { draftCharacterFromPortrait } from '@/lib/characters/aiAssist'
import { fileToDataUrl } from '@/lib/characters/importExport'
import { parseLenientJson } from '@/lib/jsonRepair'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Chip } from '@/components/ui/Chip'
import { TextAreaField } from '@/components/ui/Field'

const SYSTEM_INSTRUCTION = `You write character cards for a roleplay app. Given a short brief, output ONLY a single JSON object (no markdown fences, no commentary before or after) with exactly these fields, ALL of which are plain strings (never arrays or nested objects): name, description, personality, scenario, first_mes, mes_example, creator_notes, plus one array field, "tags", which is an array of short lowercase strings. "description" covers appearance and background. "personality" is a concise trait list capturing how they speak, act and feel. "first_mes" is the character's opening line in-character, written in their voice. "mes_example" is a SINGLE STRING (not an array!) containing 1-2 short example exchanges demonstrating their exact speech pattern, using {{user}} and {{char}} as placeholders, with \\n between lines.

Write like a person, not like an AI. Plain, concrete language. No em dashes. Avoid stock phrasing: "a mix of X and Y", "not just X but Y", tidy lists of three, and lines that tell the reader how to feel. Give the character a specific voice in the personality and example fields rather than a generic pleasant one.

Critical JSON formatting rules: output strictly valid JSON. Every string value must be on a single logical line. Anywhere you need a line break inside a string, write the two characters backslash-n (\\n), never an actual newline. Every property and every array element MUST be followed by a comma unless it is the very last one before a closing } or ]. Use straight double quotes only.`

export function GenerateCharacterDialog({
  onGenerated,
  onClose,
  worldTone,
}: {
  onGenerated: (card: CharacterCardData) => void
  onClose: () => void
  /** The currently-selected world's own description, if any — fits an image-drafted character to its tone/setting instead of inventing one that might contradict it. */
  worldTone?: string
}) {
  const client = useChatBackendClient()
  const [mode, setMode] = useState<'brief' | 'portrait'>('brief')
  const [brief, setBrief] = useState('')
  const [portraitFile, setPortraitFile] = useState<File | null>(null)
  const [portraitPreview, setPortraitPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [rawOutput, setRawOutput] = useState('')

  const pickPortrait = async (file: File) => {
    setPortraitFile(file)
    setPortraitPreview(await fileToDataUrl(file))
  }

  const generate = async () => {
    if (mode === 'brief' && !brief.trim()) return
    if (mode === 'portrait' && !portraitFile) return
    setBusy(true)
    setFailed(false)
    setRawOutput('')
    try {
      let card: CharacterCardData
      let text: string
      if (mode === 'portrait') {
        const dataUrl = portraitPreview || (await fileToDataUrl(portraitFile!))
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
        const result = await draftCharacterFromPortrait(client, base64, { brief: brief.trim() || undefined, worldTone })
        card = result.card
        text = result.rawOutput
      } else {
        const prompt = `${SYSTEM_INSTRUCTION}\n\nBrief: ${brief.trim()}\n\nJSON:`
        text = await client.generate({
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
        card = normalizeCardJson(parseLenientJson(text))
      }
      setRawOutput(text)
      if (!card.name.trim()) card.name = brief.trim().slice(0, 40) || 'New Character'
      onGenerated(card)
    } catch (e) {
      setFailed(true)
      const hint =
        mode === 'portrait'
          ? "the model's output wasn't valid JSON, or it isn't a vision-capable model — a portrait draft needs one loaded (mmproj)."
          : "the model's output wasn't valid JSON. Try again, or try a lower-temperature/more instruction-following model."
      toastError(`${errorMessage(e)} — ${hint}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Generate a character with AI"
      description="Describe who you want, or start from a reference portrait; the connected model will draft a full card for you to review and edit."
      size="lg"
    >
      <div className="mb-3 flex gap-1.5">
        <Chip on={mode === 'brief'} onClick={() => setMode('brief')}>
          From a brief
        </Chip>
        <Chip on={mode === 'portrait'} onClick={() => setMode('portrait')}>
          From a portrait
        </Chip>
      </div>

      {mode === 'portrait' && (
        <div className="mb-3">
          <label className="portrait-frame relative flex h-32 w-32 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-bg-sunken">
            {portraitPreview ? (
              <img src={portraitPreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="px-2 text-center text-[11px] text-text-muted">Click to choose a reference image</span>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && pickPortrait(e.target.files[0])}
            />
          </label>
          <p className="mt-1.5 text-[11px] text-text-muted">
            Needs a vision-capable model loaded (mmproj) — the same requirement Settings → Appearance's
            "Vision scene detection" already has.
          </p>
        </div>
      )}

      <TextAreaField
        label={mode === 'portrait' ? 'Additional guidance (optional)' : 'Brief'}
        rows={mode === 'portrait' ? 2 : 3}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder={
          mode === 'portrait'
            ? 'e.g. make her a bit standoffish at first'
            : 'e.g. a grumpy dwarven blacksmith who secretly writes poetry, gruff but soft-hearted'
        }
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
        <Button variant="primary" onClick={generate} disabled={busy || (mode === 'brief' ? !brief.trim() : !portraitFile)}>
          {busy ? 'Generating…' : failed ? 'Retry' : 'Generate'}
        </Button>
      </div>
    </Modal>
  )
}
