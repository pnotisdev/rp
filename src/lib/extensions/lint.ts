// Static checks for extension code: sandbox-incompatible APIs, undeclared permissions, hook/tool wiring.

import { EVENT_PERMISSIONS, METHOD_PERMISSIONS, extensionOf, type ExtensionBundle, type Permission } from './manifest.ts'

export interface LintFinding {
  level: 'error' | 'warning'
  file?: string
  message: string
}

const SANDBOX_RULES: { re: RegExp; message: string }[] = [
  { re: /\b(localStorage|sessionStorage|indexedDB)\b/, message: 'Browser storage is blocked in the sandbox. Use rp.storage.get/set instead.' },
  { re: /document\.cookie/, message: 'Cookies are not available in the sandbox. Use rp.storage instead.' },
  { re: /\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon)/, message: 'Network access is blocked. For AI text use rp.generate(); there is no direct internet access.' },
  { re: /\b(window\.parent|window\.top|parent\.postMessage|top\.postMessage)/, message: 'Do not talk to the host window directly. Everything goes through the rp.* API.' },
  { re: /\b(alert|confirm|prompt)\s*\(/, message: 'alert/confirm/prompt are blocked in the sandbox. Build the dialog in the page.' },
  { re: /\b(src|href)\s*=\s*["']https?:\/\//i, message: 'External resources are blocked by the content security policy. Bundle the file or inline it as a data: URL.' },
  { re: /@import\s+url\(\s*["']?https?:/i, message: 'External stylesheets are blocked. Inline the CSS.' },
]

const CALL_RE = /\brp\.(?:(chat|state|lore|facts|characters|storage|settings)\.([a-zA-Z]+)|(generate|notify|resize|close))\s*\(/g
const ON_RE = /\brp\.on\(\s*["'](\w+)["']/g
const HOOK_RE = /\brp\.hook\(\s*["'](\w+)["']/g
const TOOL_RE = /\brp\.tool\(\s*["'](\w+)["']/g

function codeOf(bundle: ExtensionBundle, path: string): string {
  const f = bundle.files[path]
  return typeof f === 'string' ? f : ''
}

function scanPermissions(file: string, code: string, granted: Set<Permission>, out: LintFinding[]): void {
  const needed = new Map<Permission, string>()
  for (const m of code.matchAll(CALL_RE)) {
    const method = m[3] ?? `${m[1]}.${m[2]}`
    const perm = METHOD_PERMISSIONS[method]
    if (perm && !granted.has(perm) && !needed.has(perm)) needed.set(perm, `rp.${method}()`)
  }
  for (const m of code.matchAll(ON_RE)) {
    const perm = EVENT_PERMISSIONS[m[1]]
    if (perm && !granted.has(perm) && !needed.has(perm)) needed.set(perm, `rp.on("${m[1]}")`)
  }
  for (const [perm, via] of needed) out.push({ level: 'error', file, message: `${via} needs the "${perm}" permission, which the manifest does not declare.` })
}

/** Lints every code file in a bundle against its manifest. Errors will break at runtime; warnings are likely mistakes. */
export function lintBundle(bundle: ExtensionBundle): LintFinding[] {
  const out: LintFinding[] = []
  const { manifest } = bundle
  const granted = new Set(manifest.permissions)
  const panelEntries = new Set(manifest.panels.map((p) => p.entry))

  for (const path of Object.keys(bundle.files)) {
    const ext = extensionOf(path)
    if (!['js', 'mjs', 'html', 'htm', 'css'].includes(ext)) continue
    const code = codeOf(bundle, path)
    if (path !== manifest.theme?.css) {
      for (const rule of SANDBOX_RULES) if (rule.re.test(code)) out.push({ level: 'warning', file: path, message: rule.message })
    } else if (/@import|url\(\s*["']?https?:/i.test(code)) {
      out.push({ level: 'error', file: path, message: 'Theme CSS may not @import or load remote url(); the app strips them.' })
    }
    if (ext !== 'css') scanPermissions(path, code, granted, out)
  }

  for (const entry of panelEntries) {
    const html = codeOf(bundle, entry)
    if (html && !/<script|<\/body>|<[a-z]/i.test(html)) out.push({ level: 'warning', file: entry, message: 'Panel entry has no markup.' })
  }

  if (manifest.script) {
    const code = codeOf(bundle, manifest.script)
    if (/\b(document|window)\./.test(code)) out.push({ level: 'warning', file: manifest.script, message: 'Scripts run in a Worker with no DOM. Put UI in a panel and use rp.* here.' })
    const hooked = new Set([...code.matchAll(HOOK_RE)].map((m) => m[1]))
    for (const h of hooked) {
      if (!manifest.hooks.includes(h as 'input')) out.push({ level: 'error', file: manifest.script, message: `rp.hook("${h}") is used but "${h}" is not listed in manifest.hooks, so the app will never call it.` })
    }
    for (const h of manifest.hooks) {
      if (!hooked.has(h)) out.push({ level: 'warning', file: manifest.script, message: `manifest.hooks lists "${h}" but the script never calls rp.hook("${h}", ...).` })
    }
    const tooled = new Set([...code.matchAll(TOOL_RE)].map((m) => m[1]))
    for (const t of manifest.tools) {
      if (!tooled.has(t.name)) out.push({ level: 'warning', file: manifest.script, message: `Tool "${t.name}" is declared but the script never calls rp.tool("${t.name}", ...).` })
    }
    for (const t of tooled) {
      if (!manifest.tools.some((x) => x.name === t)) out.push({ level: 'error', file: manifest.script, message: `rp.tool("${t}") is used but "${t}" is not declared in manifest.tools.` })
    }
  } else if (manifest.hooks.length || manifest.tools.length) {
    out.push({ level: 'error', message: 'Hooks and tools need a script.' })
  }
  return out
}
