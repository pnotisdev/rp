// Builds the self-contained HTML documents that run inside sandboxed extension iframes.

import { BASE_CSS } from './baseCss'
import { mimeForPath, type BundleFile } from './manifest'
import { PANEL_BOOT, SCRIPT_RELAY_BOOT, SDK_CORE, WORKER_BOOT } from './sdkSource'

export interface ThemeSnapshot {
  tokens: Record<string, string>
  dark: boolean
}

export type PanelSurface = 'view' | 'chat' | 'hud' | 'preview'

export const THEME_TOKEN_NAMES = [
  '--c-bg',
  '--c-bg-elevated',
  '--c-bg-sunken',
  '--c-border',
  '--c-text',
  '--c-text-muted',
  '--c-accent',
  '--c-accent-text',
  '--c-msg-user',
  '--c-msg-char',
  '--c-danger',
  '--c-success',
  '--c-warning',
  '--c-romance',
  '--c-romance-text',
] as const

/** No network of any kind; inline script/style and blob workers only. */
export const PANEL_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:; child-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none'"

export const SCRIPT_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'"

export const IFRAME_SANDBOX = 'allow-scripts'

const TRIPLET_RE = /^\d{1,3}(?:\.\d+)?(?:\s+\d{1,3}(?:\.\d+)?){2}$/

function escapeScript(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
}

function escapeStyle(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1')
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function toDataUri(path: string, file: BundleFile): string {
  const mime = typeof file === 'string' ? mimeForPath(path) : (file.mime ?? mimeForPath(path))
  return `data:${mime};base64,${typeof file === 'string' ? utf8ToBase64(file) : file.base64}`
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/** Resolves `ref` against `baseDir`; undefined when it is external, absolute or climbs out of the bundle. */
export function resolveBundlePath(baseDir: string, ref: string): string | undefined {
  const clean = ref.trim().split(/[?#]/)[0]
  if (!clean || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(clean) || clean.startsWith('/')) return undefined
  const parts = baseDir ? baseDir.split('/') : []
  for (const seg of clean.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (!parts.length) return undefined
      parts.pop()
    } else parts.push(seg)
  }
  return parts.join('/')
}

function textOf(files: Record<string, BundleFile>, path: string): string | undefined {
  const f = files[path]
  return typeof f === 'string' ? f : undefined
}

/** Rewrites `url(...)` references to bundled files as data: URIs. */
export function inlineCssUrls(css: string, baseDir: string, files: Record<string, BundleFile>): string {
  return css.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi, (m, _q, ref: string) => {
    const target = resolveBundlePath(baseDir, ref)
    return target && files[target] !== undefined ? `url("${toDataUri(target, files[target])}")` : m
  })
}

/** Inlines bundled scripts, stylesheets and media so the document needs no network or origin to load. */
export function inlineAssets(html: string, entryDir: string, files: Record<string, BundleFile>): string {
  let out = html.replace(/<script\b([^>]*?)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi, (m, pre: string, _q, src: string, post: string) => {
    const target = resolveBundlePath(entryDir, src)
    const code = target ? textOf(files, target) : undefined
    if (code === undefined) return m
    const attrs = `${pre} ${post}`.replace(/\s+/g, ' ').trim()
    return `<script${attrs ? ` ${attrs}` : ''}>${escapeScript(code)}</script>`
  })
  out = out.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["']?stylesheet/i.test(tag)) return tag
    const href = /\bhref\s*=\s*(["'])([^"']+)\1/i.exec(tag)?.[2]
    const target = href ? resolveBundlePath(entryDir, href) : undefined
    const css = target ? textOf(files, target) : undefined
    return css === undefined || !target ? tag : `<style>${escapeStyle(inlineCssUrls(css, dirOf(target), files))}</style>`
  })
  out = out.replace(/\b(src|poster)\s*=\s*(["'])([^"']+)\2/gi, (m, attr: string, q: string, ref: string) => {
    const target = resolveBundlePath(entryDir, ref)
    return target && files[target] !== undefined ? `${attr}=${q}${toDataUri(target, files[target])}${q}` : m
  })
  out = out.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_m, attrs: string, css: string) => `<style${attrs}>${inlineCssUrls(css, entryDir, files)}</style>`)
  out = out.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi, (m, q: string, css: string) => (/url\(/i.test(css) ? `style=${q}${inlineCssUrls(css, entryDir, files)}${q}` : m))
  return out
}

function themeStyle(theme: ThemeSnapshot): string {
  const decls = Object.entries(theme.tokens)
    .filter(([k, v]) => k.startsWith('--c-') && TRIPLET_RE.test(v.trim()))
    .map(([k, v]) => `${k}:${v.trim()}`)
  return `:root{${decls.join(';')};color-scheme:${theme.dark ? 'dark' : 'light'}}`
}

function withHead(html: string, headInject: string, htmlAttrs: string): string {
  const src = /<!doctype/i.test(html) ? html : `<!doctype html>${html}`
  if (/<html[\s>]/i.test(src)) {
    const tagged = src.replace(/<html\b([^>]*)>/i, (_m, attrs: string) => `<html${attrs} ${htmlAttrs}>`)
    if (/<head[\s>]/i.test(tagged)) return tagged.replace(/<head\b[^>]*>/i, (m) => m + headInject)
    return tagged.replace(/<html\b[^>]*>/i, (m) => `${m}<head>${headInject}</head>`)
  }
  const body = src.replace(/^<!doctype html>/i, '')
  return `<!doctype html><html ${htmlAttrs}><head>${headInject}</head><body>${body}</body></html>`
}

export interface PanelDocOptions {
  files: Record<string, BundleFile>
  entry: string
  theme: ThemeSnapshot
  surface: PanelSurface
  autoHeight?: boolean
}

/** The full srcdoc for one panel: CSP first, then theme tokens, the base UI kit and the `rp` SDK, then the author's markup. */
export function buildPanelDoc(opts: PanelDocOptions): string {
  const raw = textOf(opts.files, opts.entry)
  if (raw === undefined) {
    return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${PANEL_CSP}"><body style="font:14px system-ui;padding:14px">Missing panel file: ${opts.entry.replace(/[<&]/g, '')}</body>`
  }
  const html = inlineAssets(raw, dirOf(opts.entry), opts.files)
  const sdk = escapeScript(`(function(){${SDK_CORE}\n${PANEL_BOOT}})();`)
  const head =
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PANEL_CSP}">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style id="rp-theme">${themeStyle(opts.theme)}</style><style id="rp-base">${BASE_CSS}</style><script>${sdk}</script>`
  const attrs = `data-rp-surface="${opts.surface}"${opts.autoHeight ? ' data-rp-autoheight="1"' : ''}${opts.theme.dark ? ' class="dark"' : ''}`
  return withHead(html, head, attrs)
}

/** The hidden document that hosts one extension's script Worker. */
export function buildScriptDoc(userScript: string): string {
  const worker = `${SDK_CORE}\n${WORKER_BOOT}\n;(async function(){\n${userScript}\n})().catch(function(e){core.log('error',[e])});`
  const relay = SCRIPT_RELAY_BOOT.replace('__WORKER_SOURCE__', () => JSON.stringify(worker))
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SCRIPT_CSP}"><script>${escapeScript(relay)}</script>`
}
