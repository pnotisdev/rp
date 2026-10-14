import { useState } from 'react'
import { ConnectionSettings } from './ConnectionSettings'
import { ThemeEditor } from './ThemeEditor'
import { SamplingControls } from './SamplingControls'
import { VoiceSettings } from './VoiceSettings'
import { ImageGenSettings } from './ImageGenSettings'
import { DataSettings } from './DataSettings'
import { AgentSettings } from './AgentSettings'

type Tab = 'connection' | 'appearance' | 'generation' | 'voice' | 'images' | 'agents' | 'data'

const TABS: [Tab, string][] = [
  ['connection', 'Connection'],
  ['appearance', 'Appearance'],
  ['generation', 'Generation'],
  ['voice', 'Voice'],
  ['images', 'Images'],
  ['agents', 'Agents'],
  ['data', 'Data'],
]

/** Settings: a vertical sub-nav beside the active tab (a select on phones). */
export function SettingsView() {
  const [tab, setTab] = useState<Tab>('connection')

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col sm:flex-row">
      <aside className="shrink-0 px-4 pt-5 sm:w-48 sm:border-r sm:border-border sm:px-3 sm:pt-10">
        <h2 className="mb-3 px-2.5 text-lg font-semibold tracking-tight text-text">Settings</h2>
        <select
          value={tab}
          onChange={(e) => setTab(e.target.value as Tab)}
          className="w-full cursor-pointer rounded-md border border-border bg-bg-elevated px-3 py-2.5 text-base text-text outline-none focus:border-accent/70 sm:hidden"
        >
          {TABS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <div className="hidden flex-col gap-px sm:flex">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                tab === id ? 'bg-bg-sunken font-medium text-text' : 'text-text-muted hover:bg-bg-sunken/60 hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </aside>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-8 sm:py-10">
          {tab === 'connection' && <ConnectionSettings />}
          {tab === 'appearance' && <ThemeEditor />}
          {tab === 'generation' && <SamplingControls />}
          {tab === 'voice' && <VoiceSettings />}
          {tab === 'images' && <ImageGenSettings />}
          {tab === 'agents' && <AgentSettings />}
          {tab === 'data' && <DataSettings />}
        </div>
      </div>
    </div>
  )
}
