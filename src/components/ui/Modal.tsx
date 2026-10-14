import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'
import { useVnChromeClass } from '@/lib/store/useVnChromeStore'

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
  /** Trims the shell's padding and the header's gap — for a dense, tabbed panel where the default roominess pushes the actual content off the bottom. */
  compact?: boolean
  /** Hides the header's own Close button — for a dialog whose footer already has a Cancel action, so there's only one way to dismiss it. */
  hideHeaderClose?: boolean
  /** Extra controls in the header, between the title and Close — rare; most panels don't need this. */
  headerExtra?: ReactNode
  children: ReactNode
}

/** The one modal shell every panel/dialog in the app builds on */
export function Modal({
  onClose,
  title,
  description,
  size = 'lg',
  scrollable,
  compact,
  hideHeaderClose,
  headerExtra,
  children,
}: ModalProps) {
  // Section 15's "discoverable keyboard shortcuts"
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Section 9's accessibility finding: focus trap + initial focus + restore-on-close, shared with `<ConfirmDialog>` via the same hook…
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef, true)

  // Over a VN stage, a panel wears the stage's glass instead of the app's own surface
  const vnChrome = useVnChromeClass()

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        data-rp-part="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`animate-panel-in flex w-full flex-col rounded-xl border border-border bg-bg-elevated ${
          compact ? 'p-4' : 'p-5 sm:p-6'
        } ${vnChrome} ${SIZE_CLASSES[size]} ${scrollable ? 'max-h-[90vh] sm:max-h-[85vh]' : ''}`}
      >
        <div className={`flex shrink-0 items-center justify-between gap-4 ${description ? 'mb-2' : compact ? 'mb-3' : 'mb-4'}`}>
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          <div className="flex items-center gap-2">
            {headerExtra}
            {!hideHeaderClose && (
              <IconButton icon={X} title="Close" boxSize={28} onClick={onClose} />
            )}
          </div>
        </div>
        {description && (
          <p className="mb-4 shrink-0 text-[13px] leading-relaxed text-text-muted">{description}</p>
        )}
        {children}
      </div>
    </div>
  )
}
