import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { readAttachment, type PendingAttachment } from '@/lib/attachments'

interface ComposerProps {
  value: string
  onChangeValue: (v: string) => void
  disabled: boolean
  isGenerating: boolean
  canContinue: boolean
  onSend: (text: string, attachments: PendingAttachment[]) => void
  onAbort: () => void
  onContinue: () => void
  onImpersonate: () => Promise<string>
}

export function Composer({
  value,
  onChangeValue,
  disabled,
  isGenerating,
  canContinue,
  onSend,
  onAbort,
  onContinue,
  onImpersonate,
}: ComposerProps) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [composerError, setComposerError] = useState<string | null>(null)
  const [impersonating, setImpersonating] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const isEmpty = !value.trim() && attachments.length === 0

  const submit = () => {
    if (disabled) return
    if (isEmpty) {
      if (canContinue) onContinue()
      return
    }
    onSend(value, attachments)
    onChangeValue('')
    setAttachments([])
    textRef.current?.focus()
  }

  const handleImpersonate = async () => {
    if (disabled || isGenerating || impersonating) return
    setImpersonating(true)
    setComposerError(null)
    try {
      const suggestion = await onImpersonate()
      if (suggestion) onChangeValue(suggestion)
    } catch (e) {
      setComposerError(e instanceof Error ? e.message : String(e))
    } finally {
      setImpersonating(false)
    }
  }

  const addFiles = async (files: FileList) => {
    setComposerError(null)
    for (const file of Array.from(files)) {
      try {
        const attachment = await readAttachment(file)
        setAttachments((prev) => [...prev, attachment])
      } catch (e) {
        setComposerError(e instanceof Error ? e.message : String(e))
      }
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="bg-bg-elevated p-4">
      <div className="mx-auto max-w-chat rounded-2xl bg-bg-sunken p-3">
        {composerError && <p className="mb-2 px-1 text-xs text-danger">{composerError}</p>}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 px-1">
            {attachments.map((a, i) => (
              <div key={i} className="group relative">
                {a.kind === 'image' ? (
                  <img src={a.dataUrl} alt={a.name} className="h-14 w-14 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-14 max-w-[10rem] items-center gap-1.5 rounded-lg bg-bg-elevated px-2.5 text-xs text-text">
                    <span className="font-mono text-text-muted">[f]</span>
                    <span className="truncate">{a.name}</span>
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(i)}
                  title="Remove"
                  aria-label={`Remove attachment ${a.name}`}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-bg-elevated text-[11px] text-text-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textRef}
          value={value}
          onChange={(e) => onChangeValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={
            disabled
              ? 'Select a character to begin…'
              : isEmpty && canContinue
                ? 'Write a message, or press Send to continue the last reply…'
                : 'Write a message… (Enter to send, Shift+Enter for newline)'
          }
          disabled={disabled}
          rows={2}
          className="w-full resize-none bg-transparent px-1 py-1 text-sm text-text outline-none placeholder:text-text-muted"
        />

        <div className="flex items-center justify-between px-1 pt-1">
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              title="Attach images or text files for the model to read"
              aria-label="Attach images or text files"
              className="flex h-8 w-8 items-center justify-center rounded-full font-mono text-base text-text-muted transition-colors hover:bg-bg-elevated hover:text-text disabled:opacity-40"
            >
              +
            </button>
            <button
              onClick={onContinue}
              disabled={disabled || isGenerating || !canContinue}
              title="Continue the last reply"
              aria-label="Continue the last reply"
              className="flex h-8 w-8 items-center justify-center rounded-full font-mono text-sm text-text-muted transition-colors hover:bg-bg-elevated hover:text-text disabled:opacity-40"
            >
              »
            </button>
            <button
              onClick={handleImpersonate}
              disabled={disabled || isGenerating || impersonating}
              title="Suggest what you'd say next"
              aria-label="Suggest what you'd say next"
              className="flex h-8 w-8 items-center justify-center rounded-full font-mono text-sm text-text-muted transition-colors hover:bg-bg-elevated hover:text-text disabled:opacity-40"
            >
              {impersonating ? '…' : '@'}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,.txt,.md,.markdown,.json,.csv,.tsv,.log,.js,.ts,.tsx,.jsx,.py,.html,.css,.yml,.yaml,.xml"
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />

          {isGenerating ? (
            <Button variant="danger" onClick={onAbort} className="rounded-full">
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={submit}
              disabled={disabled || (isEmpty && !canContinue)}
              className="rounded-full"
            >
              {isEmpty && canContinue ? 'Continue' : 'Send'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
