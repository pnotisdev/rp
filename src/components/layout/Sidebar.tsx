import {
  BookOpen,
  CircleUserRound,
  GalleryHorizontalEnd,
  Globe,
  MessageCircle,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Puzzle,
  Search,
  Settings as SettingsIcon,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { ChatList } from '@/components/chat/ChatList'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { BRAND } from '@/lib/brand'
import { BrandMark } from './BrandMark'

export type ViewId = 'chat' | 'assistant' | 'characters' | 'worlds' | 'personas' | 'worldinfo' | 'gallery' | 'extensions' | 'settings'

type NavGroup = 'main' | 'library' | 'tools'

export const NAV: { id: ViewId; label: string; icon: LucideIcon; group: NavGroup }[] = [
  { id: 'chat', label: 'Chat', icon: MessageCircle, group: 'main' },
  { id: 'assistant', label: 'Assistant', icon: MessagesSquare, group: 'main' },
  { id: 'characters', label: 'Characters', icon: Users, group: 'library' },
  { id: 'worlds', label: 'Worlds', icon: Globe, group: 'library' },
  { id: 'personas', label: 'Personas', icon: CircleUserRound, group: 'library' },
  { id: 'worldinfo', label: 'Lorebooks', icon: BookOpen, group: 'library' },
  { id: 'gallery', label: 'Gallery', icon: GalleryHorizontalEnd, group: 'library' },
  { id: 'extensions', label: 'Extensions', icon: Puzzle, group: 'tools' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, group: 'tools' },
]

const GROUP_LABEL: Partial<Record<NavGroup, string>> = { library: 'Library' }
const GROUPS: NavGroup[] = ['main', 'library', 'tools']

/** Desktop: one flat column (nav + chat history) that folds to an icon rail. Mobile: a bottom icon bar. */
export function Sidebar({
  view,
  onChange,
  onOpenPalette,
  onNewChat,
  activeChatId,
  onSelectChat,
}: {
  view: ViewId
  onChange: (v: ViewId) => void
  onOpenPalette: () => void
  onNewChat: () => void
  activeChatId: string | null
  onSelectChat: (id: string | null) => void
}) {
  const collapsed = useSettingsStore((s) => s.sidebarCollapsed)
  const setCollapsed = useSettingsStore((s) => s.setSidebarCollapsed)

  return (
    <nav
      data-rp-part="sidebar"
      className={`fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-border bg-bg px-1 py-1
        md:static md:inset-auto md:z-auto md:flex-col md:items-stretch md:justify-start md:border-r md:border-t-0 md:px-0 md:py-0 ${
        collapsed ? 'md:w-12' : 'md:w-60'
      }`}
    >
      <div className={`mb-1 hidden h-11 shrink-0 items-center md:flex ${collapsed ? 'justify-center' : 'justify-between pl-4 pr-2'}`}>
        {!collapsed && (
          <span className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-text">
            <BrandMark size={15} />
            {BRAND.name}
            <span className="font-display text-[11px] font-normal text-text-muted">{BRAND.kanji}</span>
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-sunken hover:text-text"
        >
          {collapsed ? <PanelLeftOpen size={15} strokeWidth={1.6} /> : <PanelLeftClose size={15} strokeWidth={1.6} />}
        </button>
      </div>

      <div className={`hidden shrink-0 gap-1 md:flex ${collapsed ? 'flex-col items-center px-1.5' : 'flex-col px-2'}`}>
        <button
          onClick={onNewChat}
          title="New chat"
          aria-label="New chat"
          className={`flex h-8 items-center rounded-md border border-border text-[13px] text-text transition-colors hover:bg-bg-sunken ${
            collapsed ? 'w-8 justify-center' : 'gap-2 px-2.5'
          }`}
        >
          <Plus size={14} strokeWidth={1.8} className="shrink-0" />
          {!collapsed && 'New chat'}
        </button>
        <button
          onClick={onOpenPalette}
          title="Search everywhere (Ctrl/Cmd-K)"
          aria-label="Search everywhere"
          className={`flex h-8 items-center rounded-md text-[13px] text-text-muted transition-colors hover:bg-bg-sunken hover:text-text ${
            collapsed ? 'w-8 justify-center' : 'justify-between px-2.5'
          }`}
        >
          <span className="flex items-center gap-2">
            <Search size={14} strokeWidth={1.6} className="shrink-0" />
            {!collapsed && 'Search'}
          </span>
          {!collapsed && <kbd className="font-mono text-[10px] text-text-muted/70">Ctrl K</kbd>}
        </button>
      </div>

      {GROUPS.map((group) => (
        <div
          key={group}
          className={`contents md:flex md:flex-col md:gap-px ${collapsed ? 'md:items-center md:px-1.5' : 'md:px-2'} ${group === 'tools' ? 'md:order-last md:mb-2 md:mt-auto' : 'md:mt-3'}`}
        >
          {!collapsed && GROUP_LABEL[group] && (
            <div className="mb-0.5 hidden px-2.5 font-mono text-[10px] uppercase tracking-wider text-text-muted/70 md:block">{GROUP_LABEL[group]}</div>
          )}
          {NAV.filter((n) => n.group === group).map((item) => {
            const active = view === item.id
            return (
              <button
                key={item.id}
                onClick={() => onChange(item.id)}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={`flex h-11 w-11 flex-1 items-center justify-center rounded-md text-[13px] transition-colors md:h-7 md:flex-initial ${
                  collapsed ? 'md:w-8' : 'md:w-full md:justify-start md:gap-2.5 md:px-2.5'
                } ${active ? 'bg-bg-sunken text-text' : 'text-text-muted hover:bg-bg-sunken/60 hover:text-text'}`}
              >
                <item.icon size={15} strokeWidth={1.6} className={`shrink-0 ${active ? 'text-accent' : ''}`} />
                {!collapsed && <span className="hidden md:inline">{item.label}</span>}
              </button>
            )
          })}
        </div>
      ))}

      {!collapsed && (
        <div className="mt-3 hidden min-h-0 flex-1 flex-col md:flex">
          <div className="mb-0.5 pl-[18px] font-mono text-[10px] uppercase tracking-wider text-text-muted/70">Chats</div>
          <ChatList activeChatId={activeChatId} onSelect={onSelectChat} />
        </div>
      )}
    </nav>
  )
}
