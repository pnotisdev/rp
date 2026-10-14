// Applies the CSS of enabled, granted theme extensions to the whole app (sanitized).

import { useEffect } from 'react'
import { loadBundle } from './bundleCache'
import { sanitizeThemeCss } from './cssSanitize'
import { logExtension } from './logStore'
import type { ExtensionRecord } from './manifest'

const ATTR = 'data-rp-ext-theme'

function syncStyles(records: ExtensionRecord[], isCancelled: () => boolean): void {
  const wanted = records.filter((r) => r.enabled && r.manifest.theme && r.grants.includes('ui.theme'))
  const ids = new Set(wanted.map((r) => r.id))
  document.querySelectorAll(`style[${ATTR}]`).forEach((el) => {
    if (!ids.has(el.getAttribute(ATTR) ?? '')) el.remove()
  })
  for (const record of wanted) {
    loadBundle(record)
      .then((bundle) => {
        if (isCancelled()) return
        const css = bundle.files[record.manifest.theme!.css]
        if (typeof css !== 'string') return
        const { css: clean, removed } = sanitizeThemeCss(css)
        if (removed.length) logExtension(record.id, 'warn', `Removed ${removed.length} unsafe CSS rule(s) from the theme.`, 'theme')
        let el = document.querySelector<HTMLStyleElement>(`style[${ATTR}="${record.id}"]`)
        if (!el) {
          el = document.createElement('style')
          el.setAttribute(ATTR, record.id)
          document.head.appendChild(el)
        }
        el.textContent = clean
      })
      .catch(() => {})
  }
}

export function useExtensionThemes(records: ExtensionRecord[] | undefined): void {
  useEffect(() => {
    if (!records) return
    let cancelled = false
    syncStyles(records, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [records])
}
