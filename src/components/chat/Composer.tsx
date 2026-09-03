import { useRef, useState } from 'react'
import { ChevronsRight, FileText, Paperclip, Send, Square, Wand2, X } from 'lucide-react'
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
  /** Group-scene characters who can reply besides the primary — omitted/empty hides the "reply as" picker entirely. */
  replyAsOptions?: { id: string; name: string }[]
  replyAsId?: string | null
  onChangeReplyAs?: (id: string | null) => void
  /** 'vn' strips its own chrome (border/background/margin) to sit bare inside the glass dialogue box it's nested in, and switches text/icon colors for a photo backdrop instead of the app surface. */
  variant?: 'default' | 'vn'
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
  replyAsOptions = [],
  replyAsId,
  onChangeReplyAs,
  variant = 'default',
}: ComposerProps) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [composerError, setComposerError] = useState<string | null>(null)
  const [impersonating, setImpersonating] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const vn = variant === 'vn'

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

  const iconBtnClass = vn
    ? 'text-white/70 hover:bg-white/15 hover:text-white'
    : 'text-text-muted hover:bg-bg-elevated hover:text-text'
  const attachmentChipClass = vn ? 'bg-white/10 text-white' : 'bg-bg-elevated text-text'
  const attachmentRemoveClass = vn
    ? 'bg-black/50 text-white/70 hover:text-danger'
    : 'bg-bg-elevated text-text-muted hover:text-danger'

  return (
    <div className={vn ? 'w-full' : 'border-t border-border bg-bg-elevated p-3'}>
      <div
        className={
          vn
            ? 'w-full'
            : 'mx-auto max-w-chat rounded-2xl bg-bg-sunken p-2.5 ring-1 ring-transparent transition-shadow focus-within:ring-accent/30'
        }
      >
        {composerError && <p className="mb-2 px-1.5 text-xs text-danger">{composerError}</p>}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 px-1">
            {attachments.map((a, i) => (
              <div key={i} className="group relative">
                {a.kind === 'image' ? (
                  <img src={a.dataUrl} alt={a.name} className="h-14 w-14 rounded-lg object-cover" />
                ) : (
                  <div className={`flex h-14 max-w-[10rem] items-center gap-1.5 rounded-lg px-2.5 text-xs ${attachmentChipClass}`}>
                    <FileText size={14} strokeWidth={1.75} className="shrink-0 opacity-70" />
                    <span className="truncate">{a.name}</span>
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(i)}
                  title="Remove"
                  aria-label={`Remove attachment ${a.name}`}
                  className={`absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 ${attachmentRemoveClass}`}
                >
                  <X size={12} strokeWidth={2.5} />
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
          rows={1}
          className={`w-full resize-none bg-transparent px-1.5 py-1.5 text-sm outline-none ${
            vn ? 'text-white placeholder:text-white/45' : 'text-text placeholder:text-text-muted'
          }`}
        />

        <div className="flex items-center justify-between px-0.5 pt-0.5">
          <div className="flex items-center gap-1">
            {replyAsOptions.length > 1 && (
              <select
                value={replyAsId || replyAsOptions[0].id}
                onChange={(e) => onChangeReplyAs?.(e.target.value)}
                title="Reply as"
                aria-label="Reply as"
                className={`mr-1 rounded-full px-2.5 py-1.5 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 ${
                  vn ? 'bg-white/10 text-white/80' : 'bg-bg-elevated text-text-muted hover:text-text'
                }`}
              >
                {replyAsOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              title="Attach images or text files for the model to read"
              aria-label="Attach images or text files"
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${iconBtnClass}`}
            >
              <Paperclip size={16} strokeWidth={1.75} />
            </button>
            <button
              onClick={onContinue}
              disabled={disabled || isGenerating || !canContinue}
              title="Continue the last reply"
              aria-label="Continue the last reply"
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${iconBtnClass}`}
            >
              <ChevronsRight size={16} strokeWidth={1.75} />
            </button>
            <button
              onClick={handleImpersonate}
              disabled={disabled || isGenerating || impersonating}
              title="Suggest what you'd say next"
              aria-label="Suggest what you'd say next"
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${iconBtnClass}`}
            >
              <Wand2 size={16} strokeWidth={1.75} className={impersonating ? 'animate-pulse' : ''} />
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
            <Button variant="danger" onClick={onAbort} className="flex items-center gap-1.5 rounded-full">
              <Square size={13} strokeWidth={2} fill="currentColor" />
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={submit}
              disabled={disabled || (isEmpty && !canContinue)}
              className="flex items-center gap-1.5 rounded-full"
            >
              <Send size={13} strokeWidth={2} />
              {isEmpty && canContinue ? 'Continue' : 'Send'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
