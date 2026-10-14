// Reads the app's live theme tokens so sandboxed panels can match it.

import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { THEME_TOKEN_NAMES, type ThemeSnapshot } from './frameDoc'

export function readThemeSnapshot(): ThemeSnapshot {
  const root = document.documentElement
  const computed = getComputedStyle(root)
  const tokens: Record<string, string> = {}
  for (const name of THEME_TOKEN_NAMES) {
    const value = computed.getPropertyValue(name).trim()
    if (value) tokens[name] = value
  }
  return { tokens, dark: root.classList.contains('dark') }
}

/** Re-reads after `useApplyTheme` has written the tokens (it runs in a parent effect, so wait a frame). */
export function useThemeSnapshot(): ThemeSnapshot {
  const colorMode = useSettingsStore((s) => s.colorMode)
  const light = useSettingsStore((s) => s.themeTokensLight)
  const dark = useSettingsStore((s) => s.themeTokensDark)
  const [snapshot, setSnapshot] = useState<ThemeSnapshot>(() => readThemeSnapshot())
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSnapshot(readThemeSnapshot()))
    return () => cancelAnimationFrame(frame)
  }, [colorMode, light, dark])
  return snapshot
}
