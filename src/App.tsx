import { useEffect, useState } from 'react'
import { Sidebar, type ViewId } from '@/components/layout/Sidebar'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { KeyboardShortcutsSheet } from '@/components/layout/KeyboardShortcutsSheet'
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
  const [showPalette, setShowPalette] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  // Deep-link targets for the command palette's "jump to a character/world" — consumed (cleared)
  // by the view itself once it's actually opened that item's editor, not re-armed on every render.
  const [pendingCharacterId, setPendingCharacterId] = useState<string | null>(null)
  const [pendingWorldId, setPendingWorldId] = useState<string | null>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowPalette((v) => !v)
        return
      }
      // `?` is a real character people type constantly — only treat it as the shortcuts-sheet
      // shortcut when focus isn't in a text field, the same guard section 15's other new
      // shortcut (arrow-key swipe, in ChatWindow) uses.
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
      <Sidebar view={view} onChange={setView} onOpenPalette={() => setShowPalette(true)} />
      {/* The mobile bottom nav is `fixed`, out of normal flow — this padding keeps it from
          covering the last bit of content. No-op at `md` and up, where the rail is a sibling
          taking its own column width instead.
          `min-h-0` matters here: a flex item's default `min-height: auto` refuses to shrink
          below its content's natural height, so on a short mobile viewport a tall VN scene (a
          long reply plus a wrapped choice row) was measured growing this wrapper to 951px inside
          an 812px-tall parent — pushing the composer below the actual screen, unreachable, not
          just visually cramped. The same flexbox bug class already fixed once for the VN sprite
          itself; this is the wrapper one level up that the earlier mobile pass didn't happen to
          stress with tall-enough content to catch. */}
      <div className="flex min-h-0 flex-1 min-w-0 pb-14 md:pb-0">
        {view === 'chat' && (
          <ChatSurface activeChatId={activeChatId} onSelect={setActiveChatId} onNavigate={setView} />
        )}
        {view === 'companion' && <CompanionView />}
        {view === 'characters' && (
          <CharactersView initialCharacterId={pendingCharacterId} onConsumedInitial={() => setPendingCharacterId(null)} />
        )}
        {view === 'worlds' && (
          <WorldsView initialWorldId={pendingWorldId} onConsumedInitial={() => setPendingWorldId(null)} />
        )}
        {view === 'personas' && <PersonasView />}
        {view === 'worldinfo' && <WorldInfoView />}
        {view === 'gallery' && <GalleryView />}
        {view === 'settings' && <SettingsView />}
      </div>
      <ToastViewport />
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
      {showShortcuts && <KeyboardShortcutsSheet onClose={() => setShowShortcuts(false)} />}
    </div>
  )
}
