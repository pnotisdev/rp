import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { createImageBackend } from '@/lib/api/createImageBackend'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { Button } from '@/components/ui/Button'
import { TextAreaField } from '@/components/ui/Field'
import { IconButton } from '@/components/ui/IconButton'

/**
 * Section 11's first (deliberately minimal) "generate an image into a slot" integration — proves
 * the `ImageBackend` wiring end to end from a real UI, rather than shipping four backends nobody
 * can actually reach. A full authoring flow (generating straight into a specific expression slot
 * with scene context, a whole expression set in one pass) is real, separate follow-up work — see
 * ROADMAP.md section 11's own remaining item — not attempted here. None of the four backends this
 * calls into have been run against a real server; a failure here is at least as likely to be a
 * wrong assumption in this app's own client as a problem with the server it's pointed at.
 */
export function GenerateImageButton({
  onGenerated,
  initialPrompt = '',
  label = 'Generate with AI',
}: {
  onGenerated: (dataUrl: string) => void
  initialPrompt?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState(initialPrompt)
  const [busy, setBusy] = useState(false)

  const imageBackend = useSettingsStore((s) => s.imageBackend)
  const imageBackendBaseUrl = useSettingsStore((s) => s.imageBackendBaseUrl)
  const imageBackendUsername = useSettingsStore((s) => s.imageBackendUsername)
  const imageBackendPassword = useSettingsStore((s) => s.imageBackendPassword)
  const imageBackendModel = useSettingsStore((s) => s.imageBackendModel)

  const generate = async () => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    try {
      const backend = createImageBackend({
        imageBackend,
        imageBackendBaseUrl,
        imageBackendUsername,
        imageBackendPassword,
        imageBackendModel,
      })
      const result = await backend.generateImage({
        prompt: prompt.trim(),
        width: 512,
        height: 768,
        steps: 28,
        cfgScale: 7,
        model: imageBackendModel || undefined,
      })
      if (!result.base64) throw new Error('The backend returned no image data.')
      onGenerated(`data:image/png;base64,${result.base64}`)
      setOpen(false)
    } catch (e) {
      toastError(`Image generation failed: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <IconButton icon={Sparkles} title={label} onClick={() => setOpen(true)} size={13} boxSize={26} />
    )
  }

  return (
    <div className="absolute inset-x-0 top-full z-10 mt-1.5 w-64 rounded-xl border border-border bg-bg-elevated p-3 shadow-xl">
      <TextAreaField
        label="Prompt"
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. portrait of a young woman, dark purple twintails, library background"
        hint={`Sends to ${imageBackend} — see Settings → Images.`}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={generate} disabled={busy || !prompt.trim()}>
          {busy ? 'Generating…' : 'Generate'}
        </Button>
      </div>
    </div>
  )
}
