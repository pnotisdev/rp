import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi, worldsApi } from '@/lib/api/client'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useBgmSceneStore } from '@/lib/store/useBgmSceneStore'
import { BgmPlayer } from './BgmPlayer'

/**
 * App-level background music. Sits above the view switch so a world's track keeps playing while
 * you step into Settings or the character list — it resolves the world straight from the active
 * chat id, and the current scene (for mood-reactive track selection) from `useBgmSceneStore`,
 * which the chat view publishes. Does nothing until the user raises the volume in Settings
 * (BgmPlayer handles that). Not mounted for Companion mode, which runs its own player against its
 * own separately-chosen chat.
 */
export function GlobalBgm() {
  const activeChatId = useSettingsStore((s) => s.activeChatId)
  const bgmVolume = useSettingsStore((s) => s.bgmVolume)
  const scene = useBgmSceneStore((s) => s.scene)

  // Only pay for the lookups once the feature is actually switched on.
  const enabled = bgmVolume > 0
  const chats = useApiQuery('chats', () => chatsApi.list(), [enabled]) ?? []
  const characters = useApiQuery('characters', () => charactersApi.list(), [enabled]) ?? []
  const worlds = useApiQuery('worlds', () => worldsApi.list(), [enabled]) ?? []

  if (!enabled) return <BgmPlayer />

  const chat = chats.find((c) => c.id === activeChatId)
  const character = characters.find((c) => c.id === chat?.characterId)
  const world = worlds.find((w) => w.id === character?.worldId)

  return <BgmPlayer world={world} scene={scene} />
}
