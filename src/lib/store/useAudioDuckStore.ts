import { create } from 'zustand'

/** A one-flag cross-component signal: something with priority over background music is playing right now (a character's line being read aloud). */
interface AudioDuckState {
  ducked: boolean
  setDucked: (v: boolean) => void
}

export const useAudioDuckStore = create<AudioDuckState>((set) => ({
  ducked: false,
  setDucked: (v) => set({ ducked: v }),
}))
