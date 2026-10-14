import { create } from 'zustand'

/** Whether a Visual Novel stage is what's currently on screen. */
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
