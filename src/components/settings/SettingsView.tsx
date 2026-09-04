import { useState } from 'react'
import { ConnectionSettings } from './ConnectionSettings'
import { ThemeEditor } from './ThemeEditor'
import { SamplingControls } from './SamplingControls'
import { VoiceSettings } from './VoiceSettings'
import { DataSettings } from './DataSettings'

type Tab = 'connection' | 'appearance' | 'generation' | 'voice' | 'data'

export function SettingsView() {
  const [tab, setTab] = useState<Tab>('connection')

  const TABS: [Tab, string][] = [
    ['connection', 'Connection'],
    ['appearance', 'Appearance'],
    ['generation', 'Generation'],
    ['voice', 'Voice'],
    ['data', 'Data'],
  ]

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto p-4 sm:p-8">
      <h2 className="mb-5 font-display text-lg text-text">Settings</h2>
      {/* Mobile: a native select instead of a strip that scrolls tabs off-screen (Voice and Data
          were previously unreachable without this). Desktop keeps the visible strip. */}
      <select
        value={tab}
        onChange={(e) => setTab(e.target.value as Tab)}
        className="mb-6 w-full cursor-pointer rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent focus:ring-accent/40 sm:hidden"
      >
        {TABS.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <div className="mb-10 hidden gap-1 overflow-x-auto border-b border-border sm:flex">
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
      {tab === 'connection' && <ConnectionSettings />}
      {tab === 'appearance' && <ThemeEditor />}
      {tab === 'generation' && <SamplingControls />}
      {tab === 'voice' && <VoiceSettings />}
      {tab === 'data' && <DataSettings />}
    </div>
  )
}
