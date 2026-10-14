// Ring buffer of extension console output, shown in the Studio and on extension cards.

import { create } from 'zustand'

export type LogLevel = 'log' | 'warn' | 'error'

export interface ExtensionLogEntry {
  id: number
  extId: string
  level: LogLevel
  text: string
  surface: string
  time: number
}

const MAX_ENTRIES = 600
let counter = 0

interface LogState {
  entries: ExtensionLogEntry[]
  push: (extId: string, level: string, text: string, surface: string) => void
  clear: (extId?: string) => void
}

export const useExtensionLogs = create<LogState>((set) => ({
  entries: [],
  push: (extId, level, text, surface) =>
    set((s) => {
      const entry: ExtensionLogEntry = {
        id: ++counter,
        extId,
        level: level === 'warn' || level === 'error' ? level : 'log',
        text: String(text).slice(0, 2000),
        surface,
        time: Date.now(),
      }
      const next = [...s.entries, entry]
      return { entries: next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next }
    }),
  clear: (extId) => set((s) => ({ entries: extId ? s.entries.filter((e) => e.extId !== extId) : [] })),
}))

export function logExtension(extId: string, level: string, text: string, surface = 'host'): void {
  useExtensionLogs.getState().push(extId, level, text, surface)
}
