// React hooks for installed extensions and the always-on runtime that serves them.

import { useEffect } from 'react'
import { extensionsApi } from '@/lib/api/client'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { startEventWatchers } from './eventWatcher'
import { stopAllExtensionRuntimes, syncExtensionRuntimes } from './runtime'
import { useExtensionThemes } from './themeExtensions'
import type { ExtensionRecord } from './manifest'

/** Installed extensions, newest data first; undefined while loading. */
export function useExtensions(): ExtensionRecord[] | undefined {
  return useApiQuery('extensions', () => extensionsApi.list(), [])
}

/** Mounted once at the app root: keeps script runtimes and event watchers in step with the installed set. */
export function useExtensionRuntime(): void {
  const records = useExtensions()
  useExtensionThemes(records)
  useEffect(() => {
    if (records) void syncExtensionRuntimes(records)
  }, [records])
  useEffect(() => {
    const stop = startEventWatchers()
    return () => {
      stop()
      stopAllExtensionRuntimes()
    }
  }, [])
}
