import { useState } from 'react'
import { ConnectionSettings } from './ConnectionSettings'
import { ThemeEditor } from './ThemeEditor'
import { SamplingControls } from './SamplingControls'
import { VoiceSettings } from './VoiceSettings'
import { DataSettings } from './DataSettings'

type Tab = 'connection' | 'appearance' | 'generation' | 'voice' | 'data'

export function SettingsView() {
  const [tab, setTab] = useState<Tab>('connection')

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto p-6 sm:p-8">
      <h2 className="mb-5 font-display text-lg text-text">Settings</h2>
      {/* overflow-x-auto: on a narrow viewport all five tabs don't fit — without this, Voice and
          Data are simply unreachable rather than just visually tight. */}
      <div className="mb-10 flex gap-1 overflow-x-auto border-b border-border">
        {(
          [
            ['connection', 'Connection'],
            ['appearance', 'Appearance'],
            ['generation', 'Generation'],
            ['voice', 'Voice'],
            ['data', 'Data'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
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
