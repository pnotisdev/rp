import { useState } from 'react'
import { Sidebar, type ViewId } from '@/components/layout/Sidebar'
import { ChatsPanel } from '@/components/chat/ChatsPanel'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { WelcomeView } from '@/components/chat/WelcomeView'
import { CompanionView } from '@/components/companion/CompanionView'
import { CharactersView } from '@/components/characters/CharactersView'
import { WorldsView } from '@/components/worlds/WorldsView'
import { PersonasView } from '@/components/personas/PersonasView'
import { WorldInfoView } from '@/components/worldinfo/WorldInfoView'
import { GalleryView } from '@/components/gallery/GalleryView'
import { SettingsView } from '@/components/settings/SettingsView'
import { ToastViewport } from '@/components/ui/ToastViewport'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { chatsApi } from '@/lib/api/client'
import { useApplyTheme } from '@/lib/hooks/useApplyTheme'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

/** The chat tab: the full-screen Welcome screen on a fresh install, otherwise the panel + window. */
function ChatSurface({
  activeChatId,
  onSelect,
  onNavigate,
}: {
  activeChatId: string | null
  onSelect: (id: string | null) => void
  onNavigate: (view: ViewId) => void
}) {
  const chats = useApiQuery('chats', () => chatsApi.list(), [])

  if (chats === undefined) return <div className="flex-1" />
  if (chats.length === 0) {
    return <WelcomeView onStarted={onSelect} onNavigate={onNavigate} />
  }

  return (
    <>
      <ChatsPanel activeChatId={activeChatId} onSelect={onSelect} />
      <ChatWindow chatId={activeChatId} />
    </>
  )
}

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
          <ChatSurface activeChatId={activeChatId} onSelect={setActiveChatId} onNavigate={setView} />
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
