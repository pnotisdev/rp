// Extension manifest + bundle types, limits, and validation. A leaf module shared by the client and the server.

export const EXTENSION_API_VERSION = 1
export const BUNDLE_FORMAT = 'rp-extension'

export const LIMITS = {
  files: 200,
  fileBytes: 2_000_000,
  bundleBytes: 20_000_000,
  kvValueBytes: 262_144,
  kvKeys: 2000,
  kvKeyLength: 120,
}

export type PermissionRisk = 'low' | 'medium' | 'high'

export const PERMISSION_INFO = {
  'chat.read': { label: 'Read the open chat', detail: 'Messages, the character, your persona and the world.', risk: 'low' },
  'chat.write': { label: 'Write to the open chat', detail: 'Add messages and send replies as you.', risk: 'medium' },
  'state.read': { label: 'Read relationship state', detail: 'Stats, stage, flags, coins, inventory and the world clock.', risk: 'low' },
  'state.write': { label: 'Change relationship state', detail: 'Set flags, add coins and hand over items.', risk: 'medium' },
  'lore.read': { label: 'Read lorebooks and memories', detail: 'World Info books and remembered facts.', risk: 'low' },
  'lore.write': { label: 'Edit lorebooks and memories', detail: 'Add and remove lorebook entries and remembered facts.', risk: 'medium' },
  'characters.read': { label: 'Read your characters', detail: 'The names and tags in your character library.', risk: 'low' },
  generate: { label: 'Use your AI model', detail: 'Ask your connected model to write text. Uses your compute.', risk: 'medium' },
  hooks: { label: 'Rewrite messages and prompts', detail: 'Edit what you send, what the AI replies, and what is added to the prompt.', risk: 'high' },
  'tools.provide': { label: 'Give the AI tools', detail: 'Let the AI call functions this extension defines.', risk: 'high' },
  'ui.theme': { label: 'Restyle the whole app', detail: 'Apply CSS to every screen.', risk: 'medium' },
} as const satisfies Record<string, { label: string; detail: string; risk: PermissionRisk }>

export type Permission = keyof typeof PERMISSION_INFO
export const PERMISSIONS = Object.keys(PERMISSION_INFO) as Permission[]

export type PanelSlot = 'view' | 'chat' | 'hud'
export type HudAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type HookName = 'input' | 'context' | 'output'
export type SettingType = 'text' | 'number' | 'boolean' | 'select'
export type SettingValue = string | number | boolean

export interface PanelSpec {
  id: string
  title: string
  glyph: string
  entry: string
  slots: PanelSlot[]
  width?: number
  height?: number
  anchor?: HudAnchor
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface SettingSpec {
  key: string
  type: SettingType
  label: string
  hint?: string
  default?: SettingValue
  options?: string[]
}

export interface ExtensionManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  glyph: string
  api: number
  permissions: Permission[]
  panels: PanelSpec[]
  script?: string
  hooks: HookName[]
  tools: ToolSpec[]
  theme?: { css: string }
  settings: SettingSpec[]
}

export type BundleFile = string | { base64: string; mime?: string }

export interface ExtensionBundle {
  format: typeof BUNDLE_FORMAT
  version: 1
  manifest: ExtensionManifest
  files: Record<string, BundleFile>
}

export type ExtensionSource = 'local' | 'example' | 'import' | 'agent'

export interface ExtensionRecord {
  id: string
  manifest: ExtensionManifest
  enabled: boolean
  grants: Permission[]
  /** User-edited values for `manifest.settings`; read through `resolveSettings`. */
  settings: Record<string, SettingValue>
  source: ExtensionSource
  /** Bumped only when code or the manifest changes, so toggles and settings never restart a running extension. */
  rev: number
  fileCount: number
  totalBytes: number
  createdAt: number
  updatedAt: number
}

export interface ValidationReport<T> {
  ok: boolean
  value?: T
  errors: string[]
  warnings: string[]
}

const ID_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const PANEL_ID_RE = /^[a-z0-9][a-z0-9-]{0,29}$/
const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,39}$/
const SETTING_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/
const PATH_SEGMENT_RE = /^[A-Za-z0-9._-]+$/
const SLOTS: PanelSlot[] = ['view', 'chat', 'hud']
const ANCHORS: HudAnchor[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const HOOKS: HookName[] = ['input', 'context', 'output']
const SETTING_TYPES: SettingType[] = ['text', 'number', 'boolean', 'select']
const KNOWN_KEYS = new Set(['id', 'name', 'version', 'description', 'author', 'glyph', 'api', 'permissions', 'panels', 'script', 'hooks', 'tools', 'theme', 'settings'])
const TEXT_EXTENSIONS = new Set(['html', 'htm', 'js', 'mjs', 'css', 'json', 'svg', 'txt', 'md'])

export const MIME_BY_EXTENSION: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  md: 'text/markdown',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  woff2: 'font/woff2',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? '' : path.slice(dot + 1).toLowerCase()
}

export function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(path))
}

export function mimeForPath(path: string): string {
  return MIME_BY_EXTENSION[extensionOf(path)] ?? 'application/octet-stream'
}

const RESERVED_SEGMENTS = new Set(['.', '..', '__proto__', 'constructor', 'prototype'])

export function isPermission(v: unknown): v is Permission {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PERMISSION_INFO, v)
}

/** A relative POSIX path: no leading slash, no `..`, short segments of safe characters. */
export function isSafePath(path: unknown): path is string {
  if (typeof path !== 'string' || !path || path.length > 120 || path.startsWith('/')) return false
  const segments = path.split('/')
  if (segments.length > 6) return false
  return segments.every((s) => !RESERVED_SEGMENTS.has(s) && PATH_SEGMENT_RE.test(s))
}

export function fileByteLength(file: BundleFile): number {
  if (typeof file === 'string') return new TextEncoder().encode(file).length
  return Math.floor((file.base64.length * 3) / 4)
}

function boundedString(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null
}

function sanitizeSchema(v: unknown): Record<string, unknown> | null {
  if (!isRecord(v) || v.type !== 'object') return null
  try {
    const json = JSON.stringify(v)
    return json.length <= 8000 ? (JSON.parse(json) as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function checkPanel(raw: unknown, i: number, errors: string[], seen: Set<string>): PanelSpec | null {
  const at = `panels[${i}]`
  if (!isRecord(raw)) {
    errors.push(`${at}: must be an object`)
    return null
  }
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!PANEL_ID_RE.test(id)) errors.push(`${at}.id: use lowercase letters, digits and dashes (max 30)`)
  else if (seen.has(id)) errors.push(`${at}.id: "${id}" is used twice`)
  seen.add(id)
  const title = boundedString(raw.title, 40)
  if (!title) errors.push(`${at}.title: required, max 40 characters`)
  if (!isSafePath(raw.entry)) errors.push(`${at}.entry: must be a relative file path like "panel.html"`)
  const slots = Array.isArray(raw.slots) ? raw.slots.filter((s): s is PanelSlot => SLOTS.includes(s as PanelSlot)) : []
  if (slots.length === 0) errors.push(`${at}.slots: pick at least one of ${SLOTS.join(', ')}`)
  const glyph = typeof raw.glyph === 'string' && raw.glyph.trim() && raw.glyph.length <= 4 ? raw.glyph.trim() : '◇'
  const size = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(80, Math.min(1200, Math.round(v))) : undefined)
  const anchor = ANCHORS.includes(raw.anchor as HudAnchor) ? (raw.anchor as HudAnchor) : undefined
  if (errors.some((e) => e.startsWith(at))) return null
  return {
    id,
    title: title!,
    glyph,
    entry: raw.entry as string,
    slots: [...new Set(slots)],
    ...(size(raw.width) ? { width: size(raw.width) } : {}),
    ...(size(raw.height) ? { height: size(raw.height) } : {}),
    ...(anchor ? { anchor } : {}),
  }
}

function checkSetting(raw: unknown, i: number, errors: string[], seen: Set<string>): SettingSpec | null {
  const at = `settings[${i}]`
  if (!isRecord(raw)) {
    errors.push(`${at}: must be an object`)
    return null
  }
  const key = typeof raw.key === 'string' ? raw.key : ''
  if (!SETTING_KEY_RE.test(key)) errors.push(`${at}.key: letters, digits and underscores, starting with a letter`)
  else if (seen.has(key)) errors.push(`${at}.key: "${key}" is used twice`)
  seen.add(key)
  const type = raw.type as SettingType
  if (!SETTING_TYPES.includes(type)) errors.push(`${at}.type: one of ${SETTING_TYPES.join(', ')}`)
  const label = boundedString(raw.label, 60)
  if (!label) errors.push(`${at}.label: required, max 60 characters`)
  const options = Array.isArray(raw.options) ? raw.options.filter((o): o is string => typeof o === 'string' && !!o).slice(0, 40) : undefined
  if (type === 'select' && (!options || options.length === 0)) errors.push(`${at}.options: a select needs at least one option`)
  let def: SettingValue | undefined
  if (raw.default !== undefined) {
    const d = raw.default
    const matches = (type === 'number' && typeof d === 'number') || (type === 'boolean' && typeof d === 'boolean') || ((type === 'text' || type === 'select') && typeof d === 'string')
    if (matches) def = d as SettingValue
    else errors.push(`${at}.default: does not match type "${String(type)}"`)
  }
  if (errors.some((e) => e.startsWith(at))) return null
  const hint = boundedString(raw.hint, 200)
  return { key, type, label: label!, ...(hint ? { hint } : {}), ...(def !== undefined ? { default: def } : {}), ...(type === 'select' ? { options } : {}) }
}

function checkTool(raw: unknown, i: number, errors: string[], seen: Set<string>): ToolSpec | null {
  const at = `tools[${i}]`
  if (!isRecord(raw)) {
    errors.push(`${at}: must be an object`)
    return null
  }
  const name = typeof raw.name === 'string' ? raw.name : ''
  if (!TOOL_NAME_RE.test(name)) errors.push(`${at}.name: lowercase letters, digits and underscores (2-40)`)
  else if (seen.has(name)) errors.push(`${at}.name: "${name}" is used twice`)
  seen.add(name)
  const description = boundedString(raw.description, 400)
  if (!description) errors.push(`${at}.description: required, max 400 characters`)
  const parameters = raw.parameters === undefined ? { type: 'object', properties: {} } : sanitizeSchema(raw.parameters)
  if (!parameters) errors.push(`${at}.parameters: must be a JSON Schema object with "type": "object" (max 8 KB)`)
  if (errors.some((e) => e.startsWith(at))) return null
  return { name, description: description!, parameters: parameters! }
}

/** Validates and normalizes a manifest; errors are phrased so an agent can fix them from the message alone. */
export function validateManifest(raw: unknown): ValidationReport<ExtensionManifest> {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isRecord(raw)) return { ok: false, errors: ['manifest: must be a JSON object'], warnings }
  for (const key of Object.keys(raw)) if (!KNOWN_KEYS.has(key)) warnings.push(`manifest.${key}: unknown field, ignored`)

  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!ID_RE.test(id)) errors.push('id: 3-40 characters, lowercase letters, digits and dashes, not starting or ending with a dash')
  const name = boundedString(raw.name, 60)
  if (!name) errors.push('name: required, max 60 characters')
  const version = typeof raw.version === 'string' ? raw.version : ''
  if (!VERSION_RE.test(version)) errors.push('version: use semantic versioning like "1.0.0"')
  const description = typeof raw.description === 'string' ? raw.description.trim().slice(0, 400) : ''
  const author = typeof raw.author === 'string' ? raw.author.trim().slice(0, 80) : ''
  const glyph = typeof raw.glyph === 'string' && raw.glyph.trim() && raw.glyph.length <= 4 ? raw.glyph.trim() : '◇'
  const api = raw.api === undefined ? EXTENSION_API_VERSION : raw.api
  if (typeof api !== 'number' || !Number.isInteger(api) || api < 1) errors.push('api: must be a positive integer')
  else if (api > EXTENSION_API_VERSION) errors.push(`api: this extension needs API ${api}, but this app speaks API ${EXTENSION_API_VERSION}`)

  const permissions: Permission[] = []
  if (raw.permissions !== undefined && !Array.isArray(raw.permissions)) errors.push('permissions: must be an array')
  for (const p of Array.isArray(raw.permissions) ? raw.permissions : []) {
    if (isPermission(p)) {
      if (!permissions.includes(p)) permissions.push(p)
    } else errors.push(`permissions: unknown permission ${JSON.stringify(p)}. Known: ${PERMISSIONS.join(', ')}`)
  }

  const panels: PanelSpec[] = []
  const panelIds = new Set<string>()
  if (raw.panels !== undefined && !Array.isArray(raw.panels)) errors.push('panels: must be an array')
  ;(Array.isArray(raw.panels) ? raw.panels : []).slice(0, 12).forEach((p, i) => {
    const panel = checkPanel(p, i, errors, panelIds)
    if (panel) panels.push(panel)
  })

  let script: string | undefined
  if (raw.script !== undefined) {
    if (isSafePath(raw.script)) script = raw.script
    else errors.push('script: must be a relative file path like "main.js"')
  }

  const hooks: HookName[] = []
  if (raw.hooks !== undefined && !Array.isArray(raw.hooks)) errors.push('hooks: must be an array')
  for (const h of Array.isArray(raw.hooks) ? raw.hooks : []) {
    if (HOOKS.includes(h as HookName)) {
      if (!hooks.includes(h as HookName)) hooks.push(h as HookName)
    } else errors.push(`hooks: unknown hook ${JSON.stringify(h)}. Known: ${HOOKS.join(', ')}`)
  }
  if (hooks.length && !script) errors.push('hooks: hooks run inside the script, so set "script" too')
  if (hooks.length && !permissions.includes('hooks')) errors.push('hooks: declare the "hooks" permission to use hooks')

  const tools: ToolSpec[] = []
  const toolNames = new Set<string>()
  if (raw.tools !== undefined && !Array.isArray(raw.tools)) errors.push('tools: must be an array')
  ;(Array.isArray(raw.tools) ? raw.tools : []).slice(0, 24).forEach((t, i) => {
    const tool = checkTool(t, i, errors, toolNames)
    if (tool) tools.push(tool)
  })
  if (tools.length && !script) errors.push('tools: tools run inside the script, so set "script" too')
  if (tools.length && !permissions.includes('tools.provide')) errors.push('tools: declare the "tools.provide" permission to expose tools')

  let theme: { css: string } | undefined
  if (raw.theme !== undefined) {
    if (isRecord(raw.theme) && isSafePath(raw.theme.css)) theme = { css: raw.theme.css }
    else errors.push('theme: must be { "css": "relative/path.css" }')
    if (theme && !permissions.includes('ui.theme')) errors.push('theme: declare the "ui.theme" permission to restyle the app')
  }

  const settings: SettingSpec[] = []
  const settingKeys = new Set<string>()
  if (raw.settings !== undefined && !Array.isArray(raw.settings)) errors.push('settings: must be an array')
  ;(Array.isArray(raw.settings) ? raw.settings : []).slice(0, 30).forEach((s, i) => {
    const setting = checkSetting(s, i, errors, settingKeys)
    if (setting) settings.push(setting)
  })

  if (!panels.length && !script && !theme) warnings.push('manifest: contributes nothing yet (add a panel, a script or a theme)')
  if (errors.length) return { ok: false, errors, warnings }
  return {
    ok: true,
    errors,
    warnings,
    value: {
      id,
      name: name!,
      version,
      description,
      author,
      glyph,
      api: api as number,
      permissions,
      panels,
      ...(script ? { script } : {}),
      hooks,
      tools,
      ...(theme ? { theme } : {}),
      settings,
    },
  }
}

/** Validates a whole bundle: manifest, file paths and sizes, and that every referenced file exists. */
export function validateBundle(raw: unknown): ValidationReport<ExtensionBundle> {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isRecord(raw)) return { ok: false, errors: ['bundle: must be a JSON object'], warnings }
  if (raw.format !== BUNDLE_FORMAT) errors.push(`format: must be "${BUNDLE_FORMAT}"`)
  if (raw.version !== 1) errors.push('version: must be 1')
  const manifest = validateManifest(raw.manifest)
  errors.push(...manifest.errors.map((e) => `manifest.${e}`))
  warnings.push(...manifest.warnings)

  const files: Record<string, BundleFile> = Object.create(null)
  if (!isRecord(raw.files)) errors.push('files: must be an object mapping paths to file contents')
  else {
    const entries = Object.entries(raw.files)
    if (entries.length > LIMITS.files) errors.push(`files: at most ${LIMITS.files} files`)
    let total = 0
    for (const [path, content] of entries.slice(0, LIMITS.files)) {
      if (!isSafePath(path)) {
        errors.push(`files["${path}"]: not a safe relative path`)
        continue
      }
      if (path === 'manifest.json') {
        warnings.push('files["manifest.json"]: ignored (the manifest field is the source of truth)')
        continue
      }
      const text = isTextPath(path)
      const okShape = typeof content === 'string' || (isRecord(content) && typeof content.base64 === 'string')
      if (!okShape) {
        errors.push(`files["${path}"]: must be a string, or { "base64": "..." } for binary files`)
        continue
      }
      if (text && typeof content !== 'string') {
        errors.push(`files["${path}"]: text files must be plain strings`)
        continue
      }
      const file = typeof content === 'string' ? content : { base64: (content as { base64: string }).base64, mime: typeof (content as { mime?: unknown }).mime === 'string' ? ((content as { mime: string }).mime) : undefined }
      const size = fileByteLength(file)
      if (size > LIMITS.fileBytes) {
        errors.push(`files["${path}"]: ${size} bytes is over the ${LIMITS.fileBytes} byte limit`)
        continue
      }
      total += size
      files[path] = file
    }
    if (total > LIMITS.bundleBytes) errors.push(`files: ${total} bytes in total is over the ${LIMITS.bundleBytes} byte limit`)
  }

  if (manifest.ok && manifest.value) {
    const m = manifest.value
    for (const p of m.panels) if (!(p.entry in files)) errors.push(`panels: entry "${p.entry}" (panel "${p.id}") is not in files`)
    if (m.script && !(m.script in files)) errors.push(`script: "${m.script}" is not in files`)
    if (m.theme && !(m.theme.css in files)) errors.push(`theme.css: "${m.theme.css}" is not in files`)
  }

  if (errors.length || !manifest.ok || !manifest.value) return { ok: false, errors, warnings }
  return { ok: true, errors, warnings, value: { format: BUNDLE_FORMAT, version: 1, manifest: manifest.value, files } }
}

export function bundleByteSize(files: Record<string, BundleFile>): number {
  return Object.values(files).reduce((sum, f) => sum + fileByteLength(f), 0)
}

/** The permission each SDK method needs; `null` means any extension may call it. */
export const METHOD_PERMISSIONS: Record<string, Permission | null> = {
  'info': null,
  'log': null,
  'notify': null,
  'resize': null,
  'close': null,
  'settings.all': null,
  'storage.get': null,
  'storage.set': null,
  'storage.remove': null,
  'storage.keys': null,
  'chat.info': 'chat.read',
  'chat.messages': 'chat.read',
  'chat.append': 'chat.write',
  'chat.send': 'chat.write',
  'state.get': 'state.read',
  'state.setFlag': 'state.write',
  'state.addCoins': 'state.write',
  'state.giveItem': 'state.write',
  'lore.books': 'lore.read',
  'lore.entries': 'lore.read',
  'lore.add': 'lore.write',
  'lore.remove': 'lore.write',
  'facts.list': 'lore.read',
  'facts.add': 'lore.write',
  'characters.list': 'characters.read',
  'generate': 'generate',
}

/** The permission needed to subscribe to each host event. */
export const EVENT_PERMISSIONS: Record<string, Permission | null> = {
  message: 'chat.read',
  chat: null,
  turn: 'chat.read',
  state: 'state.read',
  theme: null,
  settings: null,
}

function coerceSetting(spec: SettingSpec, v: unknown): SettingValue | undefined {
  if (spec.type === 'number') return typeof v === 'number' && Number.isFinite(v) ? v : undefined
  if (spec.type === 'boolean') return typeof v === 'boolean' ? v : undefined
  if (spec.type === 'select') return typeof v === 'string' && spec.options?.includes(v) ? v : undefined
  return typeof v === 'string' ? v.slice(0, 2000) : undefined
}

function settingFallback(spec: SettingSpec): SettingValue {
  if (spec.default !== undefined) return spec.default
  if (spec.type === 'number') return 0
  if (spec.type === 'boolean') return false
  if (spec.type === 'select') return spec.options?.[0] ?? ''
  return ''
}

/** Every declared setting with its stored value, or its default when missing or invalid. */
export function resolveSettings(manifest: ExtensionManifest, stored: Record<string, unknown> | undefined): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {}
  for (const spec of manifest.settings) out[spec.key] = coerceSetting(spec, stored?.[spec.key]) ?? settingFallback(spec)
  return out
}

/** Keeps only declared keys whose values fit their type; used to validate a settings update. */
export function cleanSettings(manifest: ExtensionManifest, patch: unknown): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {}
  if (!isRecord(patch)) return out
  for (const spec of manifest.settings) {
    if (!Object.prototype.hasOwnProperty.call(patch, spec.key)) continue
    const v = coerceSetting(spec, patch[spec.key])
    if (v !== undefined) out[spec.key] = v
  }
  return out
}

/** Keeps only grants the manifest actually requests, in manifest order. */
export function normalizeGrants(requested: readonly Permission[], granted: readonly unknown[]): Permission[] {
  return requested.filter((p) => granted.includes(p))
}

/** Permissions a manifest asks for that the record has not been granted yet. */
export function ungrantedPermissions(manifest: ExtensionManifest, grants: readonly Permission[]): Permission[] {
  return manifest.permissions.filter((p) => !grants.includes(p))
}

export function highestRisk(permissions: readonly Permission[]): PermissionRisk {
  if (permissions.some((p) => PERMISSION_INFO[p].risk === 'high')) return 'high'
  if (permissions.some((p) => PERMISSION_INFO[p].risk === 'medium')) return 'medium'
  return 'low'
}

/** Lowercase, dash-separated id candidate from a display name. */
export function suggestId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug.length >= 3 ? slug : `${slug || 'ext'}-app`.slice(0, 40)
}
