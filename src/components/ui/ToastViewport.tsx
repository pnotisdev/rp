import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useToastStore, type ToastItem, type ToastVariant } from '@/lib/store/useToastStore'

const DOT: Record<ToastVariant, string> = {
  error: 'bg-danger',
  success: 'bg-success',
  info: 'bg-text-muted',
}

// Error toasts stay until dismissed — they can carry information the user needs after looking away (e.g. a generation failure).
const AUTO_DISMISS_MS: Record<ToastVariant, number | null> = {
  error: null,
  success: 4000,
  info: 5000,
}

function Toast({ id, message, variant }: ToastItem) {
  const dismiss = useToastStore((s) => s.dismiss)

  useEffect(() => {
    const duration = AUTO_DISMISS_MS[variant]
    if (duration === null) return
    const t = setTimeout(() => dismiss(id), duration)
    return () => clearTimeout(t)
  }, [id, variant, dismiss])

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className="animate-toast-in pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-bg-elevated px-3.5 py-2.5 text-[13px] text-text"
    >
      <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${DOT[variant]}`} />
      <span className="flex-1 whitespace-pre-wrap leading-relaxed">{message}</span>
      <button
        onClick={() => dismiss(id)}
        aria-label="Dismiss notification"
        className="shrink-0 opacity-60 hover:opacity-100"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  )
}

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <Toast key={t.id} {...t} />
      ))}
    </div>
  )
}
