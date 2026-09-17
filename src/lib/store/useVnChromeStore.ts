import { create } from 'zustand'

/**
 * Whether a Visual Novel stage is what's currently on screen. Set by `ChatWindow`, read by the
 * shared dialog shells (`Modal`, `ConfirmDialog`, `TuningPanel`, `CommandPalette`) so a panel
 * opened over the scene wears the same glass as the stage instead of dropping an app-chrome slab
 * (a white one, in the light theme) on top of it — see `.vn-chrome` in `globals.css`.
 *
 * A store rather than a prop or a context because these shells are used from a dozen call sites,
 * several of them outside `ChatWindow`'s own subtree. Not persisted — it describes this instant.
 */
interface VnChromeState {
  active: boolean
  setActive: (v: boolean) => void
}

export const useVnChromeStore = create<VnChromeState>((set) => ({
  active: false,
  setActive: (v) => set((s) => (s.active === v ? s : { active: v })),
}))

/** The class a dialog shell adds to its own panel while a VN stage is behind it. Empty otherwise. */
export function useVnChromeClass(): string {
  return useVnChromeStore((s) => s.active) ? 'vn-chrome' : ''
}
