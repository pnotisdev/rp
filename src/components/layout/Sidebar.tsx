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
      className={`flex shrink-0 flex-col gap-1 bg-gradient-to-b from-bg-elevated to-bg py-4 transition-[width] duration-200 ${
        expanded ? 'w-40 px-2' : 'w-14 items-center px-1.5'
      }`}
    >
      {NAV.map((item) => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          title={item.label}
          aria-label={item.label}
          className={`flex items-center rounded-xl text-xs transition-colors ${
            expanded ? 'gap-3 px-3 py-2.5' : 'h-10 w-10 justify-center'
          } ${
            view === item.id
              ? 'bg-accent/10 text-accent font-medium'
              : 'text-text-muted hover:bg-bg-sunken hover:text-text'
          }`}
        >
          <item.icon size={18} strokeWidth={1.75} className="shrink-0" />
          {expanded && <span>{item.label}</span>}
        </button>
      ))}

      <button
        onClick={() => setExpanded(!expanded)}
        title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        className={`mt-auto flex items-center rounded-xl text-text-muted transition-colors hover:bg-bg-sunken hover:text-text ${
          expanded ? 'justify-start gap-3 px-3 py-2.5' : 'h-10 w-10 justify-center'
        }`}
      >
        {expanded ? <PanelLeftClose size={18} strokeWidth={1.75} /> : <PanelLeftOpen size={18} strokeWidth={1.75} />}
      </button>
    </nav>
  )
}
