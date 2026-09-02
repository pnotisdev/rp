import { useEffect } from 'react'
import { useToastStore, type ToastItem, type ToastVariant } from '@/lib/store/useToastStore'

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  error: 'border-danger/30 bg-danger/10 text-danger',
  success: 'border-accent/30 bg-accent/10 text-accent',
  info: 'border-border bg-bg-elevated text-text',
}

// Error toasts stay until dismissed — they can carry information the user needs after
// looking away (e.g. a generation failure). Success/info are transient nudges.
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
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-xs shadow-lg themed-shadow ${VARIANT_CLASSES[variant]}`}
    >
      <span className="flex-1 whitespace-pre-wrap">{message}</span>
      <button
        onClick={() => dismiss(id)}
        aria-label="Dismiss notification"
        className="shrink-0 leading-none opacity-60 hover:opacity-100"
      >
        ✕
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
