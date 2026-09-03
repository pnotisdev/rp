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
  // Below `md` there's only room for one of the chat list / the active chat at a time — this is
  // purely which one a phone-width viewport is currently showing, never touched at `md` and up,
  // where both render side by side regardless of it (see the responsive classes below).
  const [mobileListOpen, setMobileListOpen] = useState(!activeChatId)

  if (chats === undefined) return <div className="flex-1" />
  if (chats.length === 0) {
    return <WelcomeView onStarted={onSelect} onNavigate={onNavigate} />
  }

  return (
    <>
      <div className={`${mobileListOpen ? 'flex' : 'hidden'} w-full md:flex md:w-auto`}>
        <ChatsPanel
          activeChatId={activeChatId}
          onSelect={(id) => {
            onSelect(id)
            setMobileListOpen(false)
          }}
        />
      </div>
      <div className={`${mobileListOpen ? 'hidden' : 'flex'} w-full min-w-0 flex-1 md:flex`}>
        <ChatWindow chatId={activeChatId} onBack={() => setMobileListOpen(true)} />
      </div>
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
      {/* The mobile bottom nav is `fixed`, out of normal flow — this padding keeps it from
          covering the last bit of content. No-op at `md` and up, where the rail is a sibling
          taking its own column width instead. */}
      <div className="flex flex-1 min-w-0 pb-14 md:pb-0">
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
