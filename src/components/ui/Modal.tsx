import { useEffect, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
}

interface ModalProps {
  onClose: () => void
  title: string
  /** One short paragraph under the title — what this panel is for. Stays pinned above the body (doesn't scroll away with it), rendered at `text-sm` so multi-line help copy is actually comfortable to read. */
  description?: ReactNode
  size?: ModalSize
  /** Caps the panel at one consistent height so tall content scrolls internally instead of ever overflowing the viewport — leave off for a short, static-height form. Scroll regions within stay up to the content (a single body, or several independent ones, e.g. a fixed summary above a scrolling list). */
  scrollable?: boolean
  /** Hides the header's own Close button — for a dialog whose footer already has a Cancel action, so there's only one way to dismiss it. */
  hideHeaderClose?: boolean
  /** Extra controls in the header, between the title and Close — rare; most panels don't need this. */
  headerExtra?: ReactNode
  children: ReactNode
}

/**
 * The one modal shell every panel/dialog in the app builds on — backdrop, centering, panel
 * surface, and the title/Close header row, all in one place instead of copy-pasted per file
 * (it used to be, near-identically, in a dozen places, with small unintentional drift between
 * them — mb-3 vs mb-4 on the header, 80/85/88vh caps, p-6 vs p-4 inner cards).
 */
export function Modal({
  onClose,
  title,
  description,
  size = 'lg',
  scrollable,
  hideHeaderClose,
  headerExtra,
  children,
}: ModalProps) {
  // Section 15's "discoverable keyboard shortcuts" — Escape-to-close, added once here rather than
  // per-panel, so every modal built on this shell (there are over a dozen) gets it for free.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm sm:p-4">
      <div
        className={`animate-panel-in flex w-full flex-col rounded-2xl border border-border bg-bg-elevated p-5 themed-shadow sm:p-7 ${SIZE_CLASSES[size]} ${scrollable ? 'max-h-[90vh] sm:max-h-[85vh]' : ''}`}
      >
        <div className={`flex shrink-0 items-center justify-between gap-4 ${description ? 'mb-2' : 'mb-4'}`}>
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          <div className="flex items-center gap-2">
            {headerExtra}
            {!hideHeaderClose && (
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </div>
        {description && (
          <p className="mb-4 shrink-0 text-sm leading-relaxed text-text-muted">{description}</p>
        )}
        {children}
      </div>
    </div>
  )
}
