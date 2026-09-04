import { create } from 'zustand'
import type { SceneTag } from '@/lib/vn/sceneTag'

/**
 * The scene the active chat last landed on, published by `ChatWindow` for the app-level
 * `GlobalBgm` to read. Kept in a store rather than passed as a prop because the music player
 * lives above the view switch (so a track keeps playing while you dip into Settings), while the
 * scene is only known inside the chat view. Not persisted — it only describes the current moment.
 */
interface BgmSceneState {
  scene: SceneTag | undefined
  setScene: (scene: SceneTag | undefined) => void
}

export const useBgmSceneStore = create<BgmSceneState>((set) => ({
  scene: undefined,
  setScene: (scene) => set({ scene }),
}))
