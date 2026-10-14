import { useEffect, useState } from 'react'
import { Sidebar, type ViewId } from '@/components/layout/Sidebar'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { KeyboardShortcutsSheet } from '@/components/layout/KeyboardShortcutsSheet'
import { ChatList } from '@/components/chat/ChatList'
import { NewChatDialog } from '@/components/chat/NewChatDialog'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { GlobalBgm } from '@/components/chat/GlobalBgm'
import { WelcomeView } from '@/components/chat/WelcomeView'
import { AssistantView } from '@/components/assistant/AssistantView'
import { CharactersView } from '@/components/characters/CharactersView'
import { WorldsView } from '@/components/worlds/WorldsView'
import { PersonasView } from '@/components/personas/PersonasView'
import { WorldInfoView } from '@/components/worldinfo/WorldInfoView'
import { GalleryView } from '@/components/gallery/GalleryView'
import { ExtensionsView } from '@/components/extensions/ExtensionsView'
import { SettingsView } from '@/components/settings/SettingsView'
import { ToastViewport } from '@/components/ui/ToastViewport'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { chatsApi } from '@/lib/api/client'
import { useApplyTheme } from '@/lib/hooks/useApplyTheme'
import { useOutreachTick } from '@/lib/hooks/useOutreachTick'
import { useAutoContextLength } from '@/lib/hooks/useAutoContextLength'
import { useAutoInstructTemplate } from '@/lib/hooks/useAutoInstructTemplate'
import { useExtensionRuntime } from '@/lib/extensions/useExtensions'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

/** The chat tab: the full-screen Welcome screen on a fresh install, otherwise the panel + window. */
function ChatSurface({
  activeChatId,
  onSelect,
  onNavigate,
  onNavigateToWorld,
  onNewChat,
}: {
  activeChatId: string | null
  onSelect: (id: string | null) => void
  onNavigate: (view: ViewId) => void
  onNewChat: () => void
  onNavigateToWorld: (worldId: string, tab?: string) => void
}) {
  const chats = useApiQuery('chats', () => chatsApi.list(), [])
  // Below `md` only one of the chat list / the active chat fits; at `md` and up the list lives in the sidebar.
  const [mobileListOpen, setMobileListOpen] = useState(!activeChatId)

  if (chats === undefined) return <div className="flex-1" />
  if (chats.length === 0) {
    return <WelcomeView onStarted={onSelect} onNavigate={onNavigate} />
  }

  return (
    <>
      <div className={`${mobileListOpen ? 'flex' : 'hidden'} w-full flex-col pt-2 md:hidden`}>
        <div className="flex items-center justify-between px-4 pb-2">
          <h2 className="text-sm font-semibold text-text">Chats</h2>
          <Button variant="primary" onClick={onNewChat}>
            New chat
          </Button>
        </div>
        <ChatList
          activeChatId={activeChatId}
          onSelect={(id) => {
            onSelect(id)
            setMobileListOpen(false)
          }}
        />
      </div>
      <div className={`${mobileListOpen ? 'hidden' : 'flex'} w-full min-w-0 flex-1 md:flex`}>
        <ChatWindow
          chatId={activeChatId}
          onBack={() => setMobileListOpen(true)}
          onOpenSettings={() => onNavigate('settings')}
          onOpenExtensions={() => onNavigate('extensions')}
          onNavigateToWorld={onNavigateToWorld}
        />
      </div>
    </>
  )
}

export default function App() {
  useApplyTheme()
  useOutreachTick()
  useAutoContextLength()
  useAutoInstructTemplate()
  useExtensionRuntime()
  const [view, setView] = useState<ViewId>('chat')
  const activeChatId = useSettingsStore((s) => s.activeChatId)
  const setActiveChatId = useSettingsStore((s) => s.setActiveChatId)
  const [showPalette, setShowPalette] = useState(false)
  const [showNewChat, setShowNewChat] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  // Deep-link targets for the command palette's "jump to a character/world"
  const [pendingCharacterId, setPendingCharacterId] = useState<string | null>(null)
  const [pendingWorldId, setPendingWorldId] = useState<string | null>(null)
  const [pendingWorldTab, setPendingWorldTab] = useState<string | null>(null)
  // The Relationship panel's "Customize in World editor" link
  const navigateToWorld = (worldId: string, tab?: string) => {
    setPendingWorldId(worldId)
    setPendingWorldTab(tab ?? null)
    setView('worlds')
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowPalette((v) => !v)
        return
      }
      // `?` is a real character people type constantly
      const target = e.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (e.key === '?' && !typing) {
        e.preventDefault()
        setShowShortcuts((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="flex h-full w-full flex-col md:flex-row">
      <Sidebar
        view={view}
        onChange={setView}
        onOpenPalette={() => setShowPalette(true)}
        onNewChat={() => setShowNewChat(true)}
        activeChatId={activeChatId}
        onSelectChat={(id) => {
          setActiveChatId(id)
          if (id) setView('chat')
        }}
      />
      {/* pb-14 clears the fixed mobile bottom nav; min-h-0 lets a tall VN scene shrink instead of pushing the composer off-screen. */}
      <div className="flex min-h-0 flex-1 min-w-0 pb-14 md:pb-0">
        {view === 'chat' && (
          <ChatSurface activeChatId={activeChatId} onSelect={setActiveChatId} onNavigate={setView} onNavigateToWorld={navigateToWorld} onNewChat={() => setShowNewChat(true)} />
        )}
        {view === 'assistant' && <AssistantView />}
        {view === 'characters' && (
          <CharactersView initialCharacterId={pendingCharacterId} onConsumedInitial={() => setPendingCharacterId(null)} />
        )}
        {view === 'worlds' && (
          <WorldsView
            initialWorldId={pendingWorldId}
            initialTab={pendingWorldTab}
            onConsumedInitial={() => {
              setPendingWorldId(null)
              setPendingWorldTab(null)
            }}
          />
        )}
        {view === 'personas' && <PersonasView />}
        {view === 'worldinfo' && <WorldInfoView />}
        {view === 'gallery' && <GalleryView />}
        {view === 'extensions' && <ExtensionsView />}
        {view === 'settings' && <SettingsView />}
      </div>
      {/* App-level so a world's music keeps playing across view switches. Mounted in every view:
          the one exclusion that used to exist was for a competing player in a view since removed. */}
      <GlobalBgm />
      <ToastViewport />
      <ConfirmDialog />
      {showPalette && (
        <CommandPalette
          onClose={() => setShowPalette(false)}
          onNavigateView={setView}
          onSelectChat={(id) => {
            setActiveChatId(id)
            setView('chat')
          }}
          onSelectCharacter={(id) => {
            setPendingCharacterId(id)
            setView('characters')
          }}
          onSelectWorld={(id) => {
            setPendingWorldId(id)
            setView('worlds')
          }}
        />
      )}
      {showNewChat && (
        <NewChatDialog
          onClose={() => setShowNewChat(false)}
          onCreated={(id) => {
            setShowNewChat(false)
            setActiveChatId(id)
            setView('chat')
          }}
        />
      )}
      {showShortcuts && <KeyboardShortcutsSheet onClose={() => setShowShortcuts(false)} />}
    </div>
  )
}
