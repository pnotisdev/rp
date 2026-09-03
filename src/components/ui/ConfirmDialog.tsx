import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { useConfirmStore } from '@/lib/store/useConfirmStore'

/**
 * The single mount point for `confirmDialog(...)` — sits next to `<ToastViewport />` in `App.tsx`.
 * Renders nothing until something awaits a confirmation, then shows one styled dialog built on the
 * same surface/radius/shadow as `<Modal>`. Escape or a backdrop click resolves the promise `false`,
 * exactly like dismissing `window.confirm`.
 */
export function ConfirmDialog() {
  const pending = useConfirmStore((s) => s.pending)
  const settle = useConfirmStore((s) => s.settle)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!pending) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false)
      if (e.key === 'Enter') settle(true)
    }
    window.addEventListener('keydown', onKeyDown)
    // Focus the confirm button so Enter/Space works and the ring lands somewhere sensible.
    confirmRef.current?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pending, settle])

  if (!pending) return null

  const danger = pending.tone !== 'default'

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-[150] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={() => settle(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={pending.title}
        onClick={(e) => e.stopPropagation()}
        className="animate-panel-in flex w-full max-w-sm flex-col rounded-2xl border border-border bg-bg-elevated p-6 themed-shadow"
      >
        <h2 className="text-sm font-semibold text-text">{pending.title}</h2>
        {pending.body && <p className="mt-2 text-sm leading-relaxed text-text-muted">{pending.body}</p>}
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => settle(false)}>
            {pending.cancelLabel ?? 'Cancel'}
          </Button>
          <Button ref={confirmRef} variant={danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
            {pending.confirmLabel ?? (danger ? 'Delete' : 'Confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
