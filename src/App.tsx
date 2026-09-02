import { useState } from 'react'
import { Sidebar, type ViewId } from '@/components/layout/Sidebar'
import { ChatsPanel } from '@/components/chat/ChatsPanel'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { CompanionView } from '@/components/companion/CompanionView'
import { CharactersView } from '@/components/characters/CharactersView'
import { WorldsView } from '@/components/worlds/WorldsView'
import { PersonasView } from '@/components/personas/PersonasView'
import { WorldInfoView } from '@/components/worldinfo/WorldInfoView'
import { GalleryView } from '@/components/gallery/GalleryView'
import { SettingsView } from '@/components/settings/SettingsView'
import { ToastViewport } from '@/components/ui/ToastViewport'
import { useApplyTheme } from '@/lib/hooks/useApplyTheme'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

export default function App() {
  useApplyTheme()
  const [view, setView] = useState<ViewId>('chat')
  const activeChatId = useSettingsStore((s) => s.activeChatId)
  const setActiveChatId = useSettingsStore((s) => s.setActiveChatId)

  return (
    <div className="flex h-full w-full flex-col md:flex-row">
      <Sidebar view={view} onChange={setView} />
      <div className="flex flex-1 min-w-0">
        {view === 'chat' && (
          <>
            <ChatsPanel activeChatId={activeChatId} onSelect={setActiveChatId} />
            <ChatWindow chatId={activeChatId} />
          </>
        )}
        {view === 'companion' && <CompanionView />}
        {view === 'characters' && <CharactersView />}
        {view === 'worlds' && <WorldsView />}
        {view === 'personas' && <PersonasView />}
        {view === 'worldinfo' && <WorldInfoView />}
        {view === 'gallery' && <GalleryView />}
        {view === 'settings' && <SettingsView />}
      </div>
      <ToastViewport />
    </div>
  )
}
