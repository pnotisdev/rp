import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { createImageBackend } from '@/lib/api/createImageBackend'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { Button } from '@/components/ui/Button'
import { TextAreaField } from '@/components/ui/Field'
import { IconButton } from '@/components/ui/IconButton'

export function GenerateImageButton({
  onGenerated,
  initialPrompt = '',
  label = 'Generate with AI',
  width = 832,
  height = 1216,
}: {
  onGenerated: (dataUrl: string) => void
  initialPrompt?: string
  label?: string
  /** Defaults to a portrait aspect (avatars/sprites) — pass a landscape shape (e.g. 768×512) for backgrounds. */
  width?: number
  height?: number
}) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState(initialPrompt)
  const [busy, setBusy] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  const openMayhemApiKey = useSettingsStore((s) => s.openMayhemApiKey)
  const imageBackend = useSettingsStore((s) => s.imageBackend)
  const imageBackendBaseUrl = useSettingsStore((s) => s.imageBackendBaseUrl)
  const imageBackendUsername = useSettingsStore((s) => s.imageBackendUsername)
  const imageBackendPassword = useSettingsStore((s) => s.imageBackendPassword)
  const imageBackendModel = useSettingsStore((s) => s.imageBackendModel)
  useEffect(() => () => controllerRef.current?.abort(), [imageBackend, imageBackendModel, imageBackendBaseUrl, openMayhemApiKey, imageBackendUsername, imageBackendPassword])

  const generate = async () => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const backend = createImageBackend({ openMayhemApiKey,
        imageBackend,
        imageBackendBaseUrl,
        imageBackendUsername,
        imageBackendPassword,
        imageBackendModel,
      })
      const result = await backend.generateImage({
        prompt: prompt.trim(),
        width,
        height,
        steps: 28,
        cfgScale: 7,
        model: imageBackendModel || undefined,
      }, controller.signal)
      controller.signal.throwIfAborted()
      if (!result.base64) throw new Error('The backend returned no image data.')
      onGenerated(`data:${result.mimeType || 'image/png'};base64,${result.base64}`)
      setOpen(false)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toastError(`Image generation failed: ${errorMessage(e)}`)
    } finally {
      controllerRef.current = null
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <IconButton icon={Sparkles} title={label} onClick={() => { setPrompt(initialPrompt); setOpen(true) }} size={13} boxSize={26} />
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
        hint={`Sends to ${imageBackend}. See Settings → Images.`}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => { controllerRef.current?.abort(); setOpen(false) }}>
          {busy ? 'Stop' : 'Cancel'}
        </Button>
        <Button variant="primary" onClick={generate} disabled={busy || !prompt.trim()}>
          {busy ? 'Generating…' : 'Generate'}
        </Button>
      </div>
    </div>
  )
}
