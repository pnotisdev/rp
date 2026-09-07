import { useState } from 'react'
import { ConnectionSettings } from './ConnectionSettings'
import { ThemeEditor } from './ThemeEditor'
import { SamplingControls } from './SamplingControls'
import { VoiceSettings } from './VoiceSettings'
import { ImageGenSettings } from './ImageGenSettings'
import { DataSettings } from './DataSettings'

type Tab = 'connection' | 'appearance' | 'generation' | 'voice' | 'images' | 'data'

export function SettingsView() {
  const [tab, setTab] = useState<Tab>('connection')

  const TABS: [Tab, string][] = [
    ['connection', 'Connection'],
    ['appearance', 'Appearance'],
    ['generation', 'Generation'],
    ['voice', 'Voice'],
    ['images', 'Images'],
    ['data', 'Data'],
  ]

  return (
    // No top padding on the scroll container itself — `sticky top-0` sticks relative to the
    // container's padding edge, so any `pt` here would leave a gap above the pinned strip that
    // scrolled content shows through. The top gap lives on the (non-sticky) heading instead.
    <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 pb-10 sm:px-8">
      <h2 className="pb-4 pt-4 font-display text-lg text-text sm:pt-8">Settings</h2>
      {/* Only the tab strip sticks — the heading scrolls away. `bg-bg` + the `pb` shelf keep it
          opaque top-to-bottom so switching tabs from deep in a long tab (Generation is ~16
          sections) never means scrolling back up. */}
      <div className="sticky top-0 z-20 bg-bg pb-3 pt-1.5 sm:pb-4 sm:pt-2">
        {/* Mobile: a native select instead of a strip that scrolls tabs off-screen (Voice and Data
            were previously unreachable without this). Desktop keeps the visible strip. */}
        <select
          value={tab}
          onChange={(e) => setTab(e.target.value as Tab)}
          className="w-full cursor-pointer rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent focus:ring-accent/40 sm:hidden"
        >
          {TABS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <div className="hidden gap-1 overflow-x-auto border-b border-border sm:flex">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`shrink-0 border-b-2 px-3 py-2.5 text-sm transition-colors ${
                tab === id ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="pt-6">
        {tab === 'connection' && <ConnectionSettings />}
        {tab === 'appearance' && <ThemeEditor />}
        {tab === 'generation' && <SamplingControls />}
        {tab === 'voice' && <VoiceSettings />}
        {tab === 'images' && <ImageGenSettings />}
        {tab === 'data' && <DataSettings />}
      </div>
    </div>
  )
}
