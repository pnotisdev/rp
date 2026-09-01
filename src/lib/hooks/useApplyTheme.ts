import { useEffect } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

export function useApplyTheme() {
  const colorMode = useSettingsStore((s) => s.colorMode)
  const themeTokensLight = useSettingsStore((s) => s.themeTokensLight)
  const themeTokensDark = useSettingsStore((s) => s.themeTokensDark)
  const chatWidthRem = useSettingsStore((s) => s.chatWidthRem)
  const fontScale = useSettingsStore((s) => s.fontScale)
  const blurPx = useSettingsStore((s) => s.blurPx)
  const shadowStrength = useSettingsStore((s) => s.shadowStrength)
  const reducedMotion = useSettingsStore((s) => s.reducedMotion)
  const customCss = useSettingsStore((s) => s.customCss)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', colorMode === 'dark')
    const tokens = colorMode === 'dark' ? themeTokensDark : themeTokensLight
    for (const [key, value] of Object.entries(tokens)) {
      root.style.setProperty(key, value)
    }
  }, [colorMode, themeTokensLight, themeTokensDark])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--chat-width', `${chatWidthRem}rem`)
    root.style.setProperty('--font-scale', String(fontScale))
    root.style.setProperty('--chat-blur', `${blurPx}px`)
    root.style.setProperty('--shadow-strength', String(shadowStrength))
    root.classList.toggle('reduced-motion', reducedMotion)
    root.style.setProperty('--motion-duration', reducedMotion ? '0ms' : '150ms')
  }, [chatWidthRem, fontScale, blurPx, shadowStrength, reducedMotion])

  useEffect(() => {
    const styleEl = document.getElementById('rp-custom-css') as HTMLStyleElement | null
    const el = styleEl ?? document.createElement('style')
    el.id = 'rp-custom-css'
    el.textContent = customCss
    if (!styleEl) document.head.appendChild(el)
  }, [customCss])
}
