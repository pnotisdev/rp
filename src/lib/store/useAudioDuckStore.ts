import { create } from 'zustand'

/**
 * A one-flag cross-component signal: something with priority over background music is playing
 * right now (Companion mode's TTS). The BGM player reads it and drops its volume while true, so
 * spoken lines aren't fighting the music. Not persisted — it only ever describes the current
 * instant.
 */
interface AudioDuckState {
  ducked: boolean
  setDucked: (v: boolean) => void
}

export const useAudioDuckStore = create<AudioDuckState>((set) => ({
  ducked: false,
  setDucked: (v) => set({ ducked: v }),
}))
