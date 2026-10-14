import { useEffect } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { FONT_STACKS, isFontId, type FontId } from '@/lib/store/fonts'

const stack = (id: FontId, fallback: FontId) => FONT_STACKS[isFontId(id) ? id : fallback]

export function useApplyTheme() {
  const colorMode = useSettingsStore((s) => s.colorMode)
  const themeTokensLight = useSettingsStore((s) => s.themeTokensLight)
  const themeTokensDark = useSettingsStore((s) => s.themeTokensDark)
  const chatWidthRem = useSettingsStore((s) => s.chatWidthRem)
  const fontScale = useSettingsStore((s) => s.fontScale)
  const blurPx = useSettingsStore((s) => s.blurPx)
  const reducedMotion = useSettingsStore((s) => s.reducedMotion)
  const customCss = useSettingsStore((s) => s.customCss)
  const uiFont = useSettingsStore((s) => s.uiFont)
  const readFont = useSettingsStore((s) => s.readFont)
  const displayFont = useSettingsStore((s) => s.displayFont)
  const radiusPx = useSettingsStore((s) => s.radiusPx)
  const readScale = useSettingsStore((s) => s.readScale)
  const backdrop = useSettingsStore((s) => s.backdrop)
  const glass = useSettingsStore((s) => s.glass)

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
    root.classList.toggle('reduced-motion', reducedMotion)
    root.style.setProperty('--motion-duration', reducedMotion ? '0ms' : '150ms')
  }, [chatWidthRem, fontScale, blurPx, reducedMotion])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--font-ui', stack(uiFont, 'inter'))
    root.style.setProperty('--font-read', stack(readFont, 'inter'))
    root.style.setProperty('--font-display', stack(displayFont, 'rounded'))
    root.style.setProperty('--radius', `${radiusPx}px`)
    root.style.setProperty('--read-scale', String(readScale))
    root.dataset.backdrop = backdrop
    root.dataset.glass = glass ? 'on' : 'off'
  }, [uiFont, readFont, displayFont, radiusPx, readScale, backdrop, glass])

  useEffect(() => {
    const styleEl = document.getElementById('rp-custom-css') as HTMLStyleElement | null
    const el = styleEl ?? document.createElement('style')
    el.id = 'rp-custom-css'
    el.textContent = customCss
    if (!styleEl) document.head.appendChild(el)
  }, [customCss])
}
