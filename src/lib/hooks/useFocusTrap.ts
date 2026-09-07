import { useEffect } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Traps Tab-cycling focus inside `containerRef` while `active`, and restores focus to the trigger on close. Shared by the `<Modal>`/`<ConfirmDialog>` shells. */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    // Focus the first focusable element, or the container itself if there is none.
    const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    const first = focusables()[0]
    ;(first ?? container).focus({ preventScroll: true })

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        // Nothing focusable inside — keep Tab from escaping to the page behind it.
        e.preventDefault()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const activeEl = document.activeElement
      if (e.shiftKey && (activeEl === firstItem || !container.contains(activeEl))) {
        e.preventDefault()
        lastItem.focus()
      } else if (!e.shiftKey && (activeEl === lastItem || !container.contains(activeEl))) {
        e.preventDefault()
        firstItem.focus()
      }
    }
    container.addEventListener('keydown', onKeyDown)

    return () => {
      container.removeEventListener('keydown', onKeyDown)
      // Restore focus to whatever opened the dialog.
      previouslyFocused?.focus?.({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
