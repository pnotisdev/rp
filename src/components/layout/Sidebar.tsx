import {
  BookOpen,
  CircleUserRound,
  GalleryHorizontalEnd,
  Globe,
  MessageCircle,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

export type ViewId = 'chat' | 'companion' | 'characters' | 'worlds' | 'personas' | 'worldinfo' | 'gallery' | 'settings'

const NAV: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'companion', label: 'Companion', icon: Mic },
  { id: 'characters', label: 'Characters', icon: Users },
  { id: 'worlds', label: 'Worlds', icon: Globe },
  { id: 'personas', label: 'Personas', icon: CircleUserRound },
  { id: 'worldinfo', label: 'World Info', icon: BookOpen },
  { id: 'gallery', label: 'Gallery', icon: GalleryHorizontalEnd },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]

export function Sidebar({ view, onChange }: { view: ViewId; onChange: (v: ViewId) => void }) {
  const expanded = useSettingsStore((s) => s.sidebarExpanded)
  const setExpanded = useSettingsStore((s) => s.setSidebarExpanded)

  return (
    <nav
      // Below `md` there's no room for a vertical rail (expanded or not) alongside any of this
      // app's views, so it becomes a fixed bottom bar instead — icon-only, "expanded" is a
      // desktop-only concept there. At `md` and up this is the original vertical rail, unchanged.
      className={`fixed inset-x-0 bottom-0 z-30 flex items-center justify-around gap-0.5 border-t border-border bg-bg-elevated px-1 py-1.5
        md:static md:inset-auto md:z-auto md:flex-col md:justify-start md:gap-1 md:border-t-0 md:bg-gradient-to-b md:from-bg-elevated md:to-bg md:py-4 md:transition-[width] md:duration-200 ${
        expanded ? 'md:w-40 md:px-2' : 'md:w-14 md:items-center md:px-1.5'
      }`}
    >
      {NAV.map((item) => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          title={item.label}
          aria-label={item.label}
          className={`flex flex-1 items-center justify-center rounded-xl text-xs transition-colors md:flex-initial ${
            expanded ? 'md:justify-start md:gap-3 md:px-3 md:py-2.5' : 'md:h-10 md:w-10'
          } h-11 w-11 md:w-auto ${
            view === item.id
              ? 'bg-accent/10 text-accent font-medium'
              : 'text-text-muted hover:bg-bg-sunken hover:text-text'
          }`}
        >
          <item.icon size={18} strokeWidth={1.75} className="shrink-0" />
          {expanded && <span className="hidden md:inline">{item.label}</span>}
        </button>
      ))}

      <button
        onClick={() => setExpanded(!expanded)}
        title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        className={`hidden items-center rounded-xl text-text-muted transition-colors hover:bg-bg-sunken hover:text-text md:mt-auto md:flex ${
          expanded ? 'md:justify-start md:gap-3 md:px-3 md:py-2.5' : 'md:h-10 md:w-10 md:justify-center'
        }`}
      >
        {expanded ? <PanelLeftClose size={18} strokeWidth={1.75} /> : <PanelLeftOpen size={18} strokeWidth={1.75} />}
      </button>
    </nav>
  )
}
