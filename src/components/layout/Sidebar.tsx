import { useSettingsStore } from '@/lib/store/useSettingsStore'

export type ViewId = 'chat' | 'companion' | 'characters' | 'worlds' | 'personas' | 'worldinfo' | 'gallery' | 'settings'

const NAV: { id: ViewId; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: '>_' },
  { id: 'companion', label: 'Companion', icon: '))' },
  { id: 'characters', label: 'Characters', icon: '#' },
  { id: 'worlds', label: 'Worlds', icon: '~' },
  { id: 'personas', label: 'Personas', icon: '@' },
  { id: 'worldinfo', label: 'World Info', icon: '¶' },
  { id: 'gallery', label: 'Gallery', icon: '[]' },
  { id: 'settings', label: 'Settings', icon: '{}' },
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
          <span className="font-mono text-[13px] leading-none">{item.icon}</span>
          {expanded && <span>{item.label}</span>}
        </button>
      ))}

      <button
        onClick={() => setExpanded(!expanded)}
        title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        className={`mt-auto flex items-center rounded-xl font-mono text-xs text-text-muted transition-colors hover:bg-bg-sunken hover:text-text ${
          expanded ? 'justify-start gap-3 px-3 py-2.5' : 'h-10 w-10 justify-center'
        }`}
      >
        <span className="leading-none">{expanded ? '«' : '»'}</span>
      </button>
    </nav>
  )
}
