import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi, worldsApi } from '@/lib/api/client'
import { NAV, type ViewId } from './Sidebar'
import { useVnChromeClass } from '@/lib/store/useVnChromeStore'
import { LOOKS } from '@/lib/store/looks'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

interface PaletteResult {
  key: string
  label: string
  sublabel?: string
  group: 'View' | 'Chat' | 'Character' | 'World' | 'Look'
  onSelect: () => void
}

const MAX_PER_GROUP = 6

/** Global "jump to anything" search (Ctrl/Cmd-K) */
export function CommandPalette({
  onClose,
  onNavigateView,
  onSelectChat,
  onSelectCharacter,
  onSelectWorld,
}: {
  onClose: () => void
  onNavigateView: (view: ViewId) => void
  onSelectChat: (chatId: string) => void
  onSelectCharacter: (characterId: string) => void
  onSelectWorld: (worldId: string) => void
}) {
  const [query, setQuery] = useState('')
  // Matches the stage when this opens over a VN scene — see `Modal`'s own note and `.vn-chrome`.
  const vnChrome = useVnChromeClass()
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const applyLook = useSettingsStore((s) => s.applyLook)
  const colorMode = useSettingsStore((s) => s.colorMode)
  const setColorMode = useSettingsStore((s) => s.setColorMode)

  const chats = useApiQuery('chats', () => chatsApi.list(), []) ?? []
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const charName = (id: string) => characters.find((c) => c.id === id)?.card.name

  const results = useMemo((): PaletteResult[] => {
    const q = query.trim().toLowerCase()

    const views: PaletteResult[] = NAV.filter((v) => !q || v.label.toLowerCase().includes(q)).map((v) => ({
      key: `view-${v.id}`,
      label: v.label,
      group: 'View',
      onSelect: () => onNavigateView(v.id),
    }))

    // An empty query is a quick "jump to a section" default — searching the whole library on top
    // of that would be a wall of everything, not a shortcut.
    if (!q) return views.slice(0, MAX_PER_GROUP)

    const chatResults: PaletteResult[] = chats
      .filter((c) => c.title.toLowerCase().includes(q) || (charName(c.characterId) ?? '').toLowerCase().includes(q))
      .slice(0, MAX_PER_GROUP)
      .map((c) => ({
        key: `chat-${c.id}`,
        label: c.title,
        sublabel: charName(c.characterId),
        group: 'Chat',
        onSelect: () => onSelectChat(c.id),
      }))

    const characterResults: PaletteResult[] = characters
      .filter((c) => c.card.name.toLowerCase().includes(q))
      .slice(0, MAX_PER_GROUP)
      .map((c) => ({
        key: `character-${c.id}`,
        label: c.card.name,
        group: 'Character',
        onSelect: () => onSelectCharacter(c.id),
      }))

    const worldResults: PaletteResult[] = worlds
      .filter((w) => w.name.toLowerCase().includes(q))
      .slice(0, MAX_PER_GROUP)
      .map((w) => ({
        key: `world-${w.id}`,
        label: w.name,
        group: 'World',
        onSelect: () => onSelectWorld(w.id),
      }))

    // Looks and the light/dark switch, found by name or by typing "look", "theme" or "dark".
    const wants = (words: string[]) => q.length >= 2 && words.some((w) => w.startsWith(q))
    const lookResults: PaletteResult[] = LOOKS.filter((l) => l.name.toLowerCase().includes(q) || wants(['looks', 'themes', 'appearance'])).map((l) => ({
      key: `look-${l.id}`,
      label: l.name,
      sublabel: l.blurb,
      group: 'Look',
      onSelect: () => applyLook(l),
    }))
    if (wants(['dark', 'light', 'mode', 'themes'])) {
      lookResults.push({ key: 'look-mode', label: colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', group: 'Look', onSelect: () => setColorMode(colorMode === 'dark' ? 'light' : 'dark') })
    }

    // Order must match the render groups below (View, Character, Chat, World, Look)
    return [...views.slice(0, MAX_PER_GROUP), ...characterResults, ...chatResults, ...worldResults, ...lookResults]
  }, [query, chats, characters, worlds, applyLook, colorMode, setColorMode])

  // The active index can point past the end once a keystroke shrinks the result list.
  const clampedIndex = results.length ? Math.min(activeIndex, results.length - 1) : 0

  const activate = (result: PaletteResult | undefined) => {
    if (!result) return
    result.onSelect()
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate(results[clampedIndex])
    }
  }

  let runningIndex = -1

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className={`animate-panel-in w-full max-w-lg overflow-hidden rounded-xl border border-border bg-bg-elevated ${vnChrome}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search size={16} strokeWidth={2} className="shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Jump to a character, chat, world, or section…"
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-muted/60"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <p className="px-3 py-6 text-center text-xs text-text-muted">No matches.</p>}
          {/* Groups are derived from `results` itself (first-appearance order), not a separately hardcoded list */}
          {[...new Set(results.map((r) => r.group))].map((group) => {
            const groupResults = results.filter((r) => r.group === group)
            if (groupResults.length === 0) return null
            return (
              <div key={group} className="mb-1">
                <div className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wider text-text-muted/80">
                  {group === 'View' ? 'Sections' : `${group}s`}
                </div>
                {groupResults.map((r) => {
                  runningIndex++
                  const isActive = runningIndex === clampedIndex
                  return (
                    <button
                      key={r.key}
                      onMouseEnter={() => setActiveIndex(runningIndex)}
                      onClick={() => activate(r)}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-[13px] transition-colors ${
                        isActive ? 'bg-bg-sunken text-text' : 'text-text-muted hover:bg-bg-sunken/60'
                      }`}
                    >
                      <span className="truncate">{r.label}</span>
                      {r.sublabel && <span className="ml-2 shrink-0 truncate text-xs text-text-muted">{r.sublabel}</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
