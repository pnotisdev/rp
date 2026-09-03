import type { ReactNode } from 'react'
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
export function Modal({ onClose, title, size = 'lg', scrollable, hideHeaderClose, headerExtra, children }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className={`flex w-full flex-col rounded-2xl border border-border bg-bg-elevated p-7 themed-shadow ${SIZE_CLASSES[size]} ${scrollable ? 'max-h-[85vh]' : ''}`}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
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
        {children}
      </div>
    </div>
  )
}
