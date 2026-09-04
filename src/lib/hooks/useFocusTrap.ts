import { useEffect } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Section 9's `<Modal>` accessibility finding: every one of the dozen-plus panels built on the
 * shared `<Modal>`/`<ConfirmDialog>` shells had no focus trap and no initial-focus management —
 * background content stayed fully keyboard-reachable while a panel was "open," and focus landed
 * nowhere in particular on open or on close. One hook, shared by both shells, rather than a
 * per-panel fix, since every bigger panel in the app is built on one of these two.
 *
 * Deliberately a manual Tab-cycling trap rather than migrating to the native `<dialog>` element
 * (which handles this for free) — `<dialog>` brings its own default positioning/backdrop behavior
 * that would need resetting across every one of this app's existing modals, a much larger and
 * riskier change than this finding actually asked for. `active` lets a caller mount the hook
 * unconditionally and only engage it once something is actually showing (`ConfirmDialog`'s own
 * pattern, where the component itself doesn't exist until `pending` is set, doesn't need this).
 */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    // Focus something inside the dialog immediately — the first focusable element if there is
    // one, otherwise the container itself (given a tabindex below) so screen readers still land
    // inside it rather than leaving focus on whatever triggered the open.
    const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    const first = focusables()[0]
    ;(first ?? container).focus({ preventScroll: true })

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        // Nothing focusable inside (a purely informational panel, say) — keep focus pinned on
        // the container itself rather than letting Tab escape into the page behind it.
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
      // Restores focus to whatever opened the dialog (a toolbar icon, a "Delete" button, ...) —
      // without this, focus silently drops to <body> on close, disorienting for keyboard/screen-
      // reader use even though sighted mouse use never notices.
      previouslyFocused?.focus?.({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
