// Strips remote loads and legacy script vectors from extension-provided global CSS.

export const MAX_THEME_CSS_BYTES = 200_000

export interface SanitizedCss {
  css: string
  removed: string[]
}

/** Removes @import, remote url(), expression(), behavior and -moz-binding. data: URLs and local fragments are kept. */
export function sanitizeThemeCss(input: string): SanitizedCss {
  const removed: string[] = []
  let css = input.slice(0, MAX_THEME_CSS_BYTES)
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  css = css.replace(/@import\b[^;]*;?/gi, (m) => (removed.push(m.trim()), ''))
  css = css.replace(/@charset\b[^;]*;?/gi, '')
  css = css.replace(/url\(\s*(["']?)([^)"']*)\1\s*\)/gi, (m, _q, target: string) => {
    const t = target.trim().toLowerCase()
    if (t.startsWith('data:') || t.startsWith('#')) return m
    removed.push(m)
    return 'none'
  })
  css = css.replace(/expression\s*\([^)]*\)/gi, (m) => (removed.push(m), 'none'))
  css = css.replace(/(?:behavior|-moz-binding)\s*:[^;}]*;?/gi, (m) => (removed.push(m.trim()), ''))
  return { css, removed }
}
