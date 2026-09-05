import { useRef, useState } from 'react'
import { useChatBackendClient } from '@/lib/hooks/useChatBackendClient'
import type { CharacterCardData, Lorebook } from '@/lib/characters/cardSpec'
import type { Outfit } from '@/lib/vn/outfits'
import { draftCharacterFromBrief, draftCharacterFromPortrait, type DraftedBonds, type DraftedProfile } from '@/lib/characters/aiAssist'
import {
  OPTIONAL_STAGES,
  STAGE_LABELS,
  draftFullCharacter,
  isAbortError,
  type FullCharacterStage,
  type StageStatus,
} from '@/lib/characters/generateFullCharacter'
import { fileToDataUrl } from '@/lib/characters/importExport'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { errorMessage, toastError, toastInfo } from '@/lib/store/useToastStore'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Chip } from '@/components/ui/Chip'
import { TextAreaField } from '@/components/ui/Field'

/** What the dialog hands back — a card always, plus the extra `Character`-level fields when the user
 *  picked "Full character". `CharacterEditor` spreads these into its own field state for review. */
export interface GeneratedCharacter {
  card: CharacterCardData
  profile?: DraftedProfile | null
  bonds?: DraftedBonds | null
  outfits?: Outfit[] | null
  characterBook?: Lorebook | null
}

type StageState = Record<FullCharacterStage, StageStatus | 'pending'>

const ALL_STAGES: FullCharacterStage[] = ['card', ...OPTIONAL_STAGES]

const STATUS_GLYPH: Record<StageStatus | 'pending', string> = {
  pending: '·',
  start: '…',
  done: '✓',
  failed: '✕',
}

export function GenerateCharacterDialog({
  onGenerated,
  onClose,
  worldTone,
}: {
  onGenerated: (result: GeneratedCharacter) => void
  onClose: () => void
  /** The currently-selected world's own description, if any — fits the draft to its tone/setting instead of inventing one that might contradict it. */
  worldTone?: string
}) {
  const client = useChatBackendClient()
  const styleGuidance = useSettingsStore((s) => s.styleGuidance)
  const [mode, setMode] = useState<'brief' | 'portrait'>('brief')
  const [scope, setScope] = useState<'full' | 'card'>('full')
  const [brief, setBrief] = useState('')
  const [portraitFile, setPortraitFile] = useState<File | null>(null)
  const [portraitPreview, setPortraitPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [rawOutput, setRawOutput] = useState('')
  const [stages, setStages] = useState<StageState | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const pickPortrait = async (file: File) => {
    setPortraitFile(file)
    setPortraitPreview(await fileToDataUrl(file))
  }

  const portraitBase64 = async () => {
    const dataUrl = portraitPreview || (await fileToDataUrl(portraitFile!))
    return dataUrl.slice(dataUrl.indexOf(',') + 1)
  }

  const generate = async () => {
    if (mode === 'brief' && !brief.trim()) return
    if (mode === 'portrait' && !portraitFile) return
    setBusy(true)
    setFailed(false)
    setRawOutput('')
    setStages(scope === 'full' ? (Object.fromEntries(ALL_STAGES.map((s) => [s, 'pending'])) as StageState) : null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      if (scope === 'card') {
        const result =
          mode === 'portrait'
            ? await draftCharacterFromPortrait(client, await portraitBase64(), {
                brief: brief.trim() || undefined,
                worldTone,
                styleGuidance,
                signal: controller.signal,
              })
            : await draftCharacterFromBrief(client, brief.trim(), { worldTone, styleGuidance, signal: controller.signal })
        setRawOutput(result.rawOutput)
        if (!result.card.name.trim()) result.card.name = brief.trim().slice(0, 40) || 'New Character'
        onGenerated({ card: result.card })
        return
      }

      const draft = await draftFullCharacter(
        client,
        {
          brief: brief.trim() || undefined,
          portraitBase64: mode === 'portrait' ? await portraitBase64() : undefined,
          worldTone,
          styleGuidance,
        },
        {
          signal: controller.signal,
          onStage: (stage, status) => setStages((prev) => (prev ? { ...prev, [stage]: status } : prev)),
        },
      )
      setRawOutput(draft.cardRawOutput)
      if (draft.failed.length) {
        toastInfo(
          `Character drafted, but ${draft.failed.length} step${draft.failed.length > 1 ? 's' : ''} didn't produce usable output: ${draft.failed
            .map((f) => STAGE_LABELS[f.stage])
            .join(', ')}. You can fill those in or regenerate them in the editor.`,
        )
      }
      onGenerated({
        card: draft.card,
        profile: draft.profile,
        bonds: draft.bonds,
        outfits: draft.outfits,
        characterBook: draft.characterBook,
      })
    } catch (e) {
      if (isAbortError(e) || controller.signal.aborted) return
      setFailed(true)
      const hint =
        mode === 'portrait'
          ? "the model's output wasn't valid JSON, or it isn't a vision-capable model — a portrait draft needs one loaded (mmproj)."
          : "the model's output wasn't valid JSON. Try again, or try a lower-temperature/more instruction-following model."
      toastError(`${errorMessage(e)} — ${hint}`)
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  const stop = () => abortRef.current?.abort()

  const canGenerate = mode === 'brief' ? !!brief.trim() : !!portraitFile

  return (
    <Modal
      onClose={busy ? stop : onClose}
      title="Generate a character with AI"
      description="Describe who you want, or start from a reference portrait; the connected model drafts a full character for you to review and edit."
      size="lg"
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip on={scope === 'full'} onClick={() => setScope('full')} disabled={busy}>
          Full character
        </Chip>
        <Chip on={scope === 'card'} onClick={() => setScope('card')} disabled={busy}>
          Just the card
        </Chip>
      </div>
      <p className="mb-3 text-[11px] text-text-muted">
        {scope === 'full'
          ? 'Drafts the card, then life & background, gift and relationship starters, wardrobe, and a character lorebook — one step at a time.'
          : 'Drafts just the core card: identity, personality, scenario, first message.'}
        {styleGuidance.trim() && ' Your writing style from Settings is applied.'}
      </p>

      <div className="mb-3 flex gap-1.5">
        <Chip on={mode === 'brief'} onClick={() => setMode('brief')} disabled={busy}>
          From a brief
        </Chip>
        <Chip on={mode === 'portrait'} onClick={() => setMode('portrait')} disabled={busy}>
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
              disabled={busy}
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
        disabled={busy}
        placeholder={
          mode === 'portrait'
            ? 'e.g. make her a bit standoffish at first'
            : 'e.g. a demon girl in a dark-fantasy world where demons are at war with dragons'
        }
      />

      {stages && (
        <ul className="mb-3 space-y-1 rounded-xl bg-bg-sunken p-3 text-xs">
          {ALL_STAGES.map((s) => {
            const st = stages[s]
            return (
              <li
                key={s}
                className={
                  st === 'failed'
                    ? 'text-danger'
                    : st === 'done'
                      ? 'text-text'
                      : st === 'start'
                        ? 'text-accent'
                        : 'text-text-muted'
                }
              >
                <span className="inline-block w-4 tabular-nums">{STATUS_GLYPH[st]}</span>
                {STAGE_LABELS[s]}
                {st === 'start' && ' …'}
                {st === 'failed' && ' — skipped'}
              </li>
            )
          })}
        </ul>
      )}

      {failed && rawOutput && (
        <details className="mb-3 rounded-xl bg-bg-sunken p-3 text-xs text-text-muted">
          <summary className="cursor-pointer">Raw model output</summary>
          <pre className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-bg-elevated p-2 text-text">
            {rawOutput}
          </pre>
        </details>
      )}
      <div className="flex justify-end gap-2">
        {busy && scope === 'full' ? (
          <Button variant="ghost" onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button variant="primary" onClick={generate} disabled={busy || !canGenerate}>
          {busy ? 'Generating…' : failed ? 'Retry' : 'Generate'}
        </Button>
      </div>
    </Modal>
  )
}
