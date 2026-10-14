import { create } from 'zustand'
import type { SceneTag } from '@/lib/vn/sceneTag'

/** The scene the active chat last landed on, published by `ChatWindow` for the app-level `GlobalBgm` to read. */
interface BgmSceneState {
  scene: SceneTag | undefined
  setScene: (scene: SceneTag | undefined) => void
}

export const useBgmSceneStore = create<BgmSceneState>((set) => ({
  scene: undefined,
  setScene: (scene) => set({ scene }),
}))
