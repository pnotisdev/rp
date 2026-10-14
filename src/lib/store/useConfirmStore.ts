import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  /** Optional supporting line under the title — the "this can't be undone" explanation. */
  body?: string
  /** Preformatted detail shown in a scrollable block (a command, a diff, the text about to be written). */
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' (default for a destructive action) paints the confirm button red. */
  tone?: 'default' | 'danger'
}

interface PendingConfirm extends ConfirmOptions {
  id: number
  resolve: (ok: boolean) => void
}

interface ConfirmState {
  pending: PendingConfirm | null
  request: (opts: ConfirmOptions) => Promise<boolean>
  settle: (ok: boolean) => void
}

let counter = 0

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  request: (opts) =>
    new Promise<boolean>((resolve) => {
      // If a confirm is somehow already open, treat the older one as cancelled rather than stacking two dialogs
      const existing = get().pending
      if (existing) existing.resolve(false)
      set({ pending: { ...opts, id: ++counter, resolve } })
    }),
  settle: (ok) => {
    const p = get().pending
    if (p) p.resolve(ok)
    set({ pending: null })
  },
}))

/** Promise-based, theme-aware replacement for `window.confirm` */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().request(opts)
}
