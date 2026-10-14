// Workspace tools for the Assistant: read, search, edit and write files inside one chosen folder, look at images, fetch pages, and (opt-in) run commands.

import fs from 'node:fs'
import { BRAND, BRAND_ID } from '../src/lib/brand.ts'
import path from 'node:path'
import dns from 'node:dns/promises'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import type { JsonSchema, ToolDef, ToolOutput } from './mcpProtocol.ts'

export interface WorkspaceConfig {
  root: string
  allowCommands: boolean
}

export interface WorkspaceCtx {
  config: WorkspaceConfig
  /** True when the caller was allowed to change things and (for risky tools) the user approved this call. */
  readOnly: boolean
  confirmed: boolean
  /** Folders that are never read or written, such as the app's own database. */
  protectedDirs: string[]
}

/** A tool result that may carry images for a vision model (data URLs). */
export interface WorkspaceOutput extends ToolOutput {
  images?: string[]
}

type Tool = ToolDef<WorkspaceCtx> & { needsApproval?: boolean }

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv', 'venv', '.cache'])
const MAX_READ_BYTES = 400_000
const MAX_WRITE_BYTES = 1_000_000
const MAX_IMAGE_BYTES = 6_000_000
const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
export const inside = (parent: string, child: string) => {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function realOf(p: string): string {
  return fs.realpathSync.native(p)
}

/** The nearest ancestor of `p` that exists, resolved through symlinks, with the not-yet-existing tail re-attached. */
function realWithTail(p: string): string {
  const tail: string[] = []
  let cur = p
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur)
    if (parent === cur) break
    tail.unshift(path.basename(cur))
    cur = parent
  }
  return path.join(realOf(cur), ...tail)
}

export class WorkspaceError extends Error {}

/** Resolves `rel` against the workspace root and refuses anything that escapes it (`..`, absolute paths elsewhere, symlinks). */
export function resolveInWorkspace(ctx: WorkspaceCtx, rel: unknown): string {
  const root = ctx.config.root
  if (!root) throw new WorkspaceError('No workspace folder is set. The user can choose one in Settings, Agents.')
  const input = typeof rel === 'string' && rel.trim() ? rel.trim() : '.'
  const realRoot = realOf(root)
  const abs = path.resolve(realRoot, input)
  if (!inside(realRoot, abs)) throw new WorkspaceError(`"${input}" is outside the workspace folder.`)
  const real = realWithTail(abs)
  if (!inside(realRoot, real)) throw new WorkspaceError(`"${input}" resolves outside the workspace folder.`)
  for (const dir of ctx.protectedDirs) {
    const protectedReal = fs.existsSync(dir) ? realOf(dir) : dir
    if (inside(protectedReal, real)) throw new WorkspaceError(`"${input}" is part of ${BRAND.name}'s own data and is off limits.`)
  }
  return real
}

const display = (ctx: WorkspaceCtx, abs: string) => path.relative(realOf(ctx.config.root), abs).split(path.sep).join('/') || '.'

function needWrite(ctx: WorkspaceCtx) {
  if (ctx.readOnly) throw new WorkspaceError('The Assistant is set to read-only. Switch Tools to "Look and change" to let it edit files.')
  if (!ctx.confirmed) throw new WorkspaceError('This change needs the user\'s approval first.')
}

function touchesGit(abs: string) {
  return abs.split(path.sep).includes('.git')
}

function looksBinary(buf: Buffer) {
  return buf.subarray(0, 4096).includes(0)
}

function readText(abs: string): { text: string; truncated: boolean } {
  const st = fs.statSync(abs)
  if (!st.isFile()) throw new WorkspaceError('That is not a file.')
  const fd = fs.openSync(abs, 'r')
  try {
    const size = Math.min(st.size, MAX_READ_BYTES)
    const buf = Buffer.alloc(size)
    fs.readSync(fd, buf, 0, size, 0)
    if (looksBinary(buf)) throw new WorkspaceError('That looks like a binary file. Use view_image for pictures.')
    return { text: buf.toString('utf8'), truncated: st.size > MAX_READ_BYTES }
  } finally {
    fs.closeSync(fd)
  }
}

// ---- Tools ----

const str = (description: string): JsonSchema => ({ type: 'string', description })
const shape = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', properties, required })

function walk(dir: string, depth: number, out: string[], base: string, limit: number) {
  if (out.length >= limit) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
  for (const e of entries) {
    if (out.length >= limit) return
    if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue
    const abs = path.join(dir, e.name)
    const rel = path.relative(base, abs).split(path.sep).join('/')
    if (e.isDirectory()) {
      out.push(`${rel}/`)
      if (depth > 1) walk(abs, depth - 1, out, base, limit)
    } else {
      let size = 0
      try {
        size = fs.statSync(abs).size
      } catch {
        // unreadable entry; list it without a size
      }
      out.push(`${rel}  (${size} bytes)`)
    }
  }
}

function globToRegExp(glob: string): RegExp {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '@@ANY@@')
    .replace(/\*/g, '[^/]*')
    .replace(/@@ANY@@/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`(^|/)${body}$`, 'i')
}

function eol(text: string) {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

export const WORKSPACE_TOOLS: Tool[] = [
  {
    name: 'list_files',
    title: 'List files',
    description: 'List files and folders in the workspace. Start here to see what exists. Shows sizes; skips node_modules and .git.',
    inputSchema: shape({ path: str('Folder to list, relative to the workspace. Default: the workspace root.'), depth: { type: 'number', description: 'How many levels to show (1-5). Default 2.' } }),
    annotations: { readOnlyHint: true },
    async run(a, ctx) {
      const abs = resolveInWorkspace(ctx, a.path)
      if (!fs.statSync(abs).isDirectory()) throw new WorkspaceError('That is a file, not a folder.')
      const out: string[] = []
      walk(abs, Math.max(1, Math.min(5, Math.floor(Number(a.depth) || 2))), out, abs, 300)
      return { text: `${display(ctx, abs)}/\n${out.join('\n') || '(empty)'}${out.length >= 300 ? '\n[list truncated at 300 entries]' : ''}` }
    },
  },
  {
    name: 'read_file',
    title: 'Read a file',
    description: 'Read a text file with line numbers. Long files come in pages: pass offset (first line, 1-based) and limit (lines, default 400).',
    inputSchema: shape({ path: str('File to read'), offset: { type: 'number', description: 'First line to show, 1-based' }, limit: { type: 'number', description: 'How many lines (default 400, max 1000)' } }, ['path']),
    annotations: { readOnlyHint: true },
    async run(a, ctx) {
      const abs = resolveInWorkspace(ctx, a.path)
      const { text, truncated } = readText(abs)
      const lines = text.split(/\r?\n/)
      const start = Math.max(1, Math.floor(Number(a.offset) || 1))
      const limit = Math.max(1, Math.min(1000, Math.floor(Number(a.limit) || 400)))
      const slice = lines.slice(start - 1, start - 1 + limit)
      const numbered = slice.map((l, i) => `${String(start + i).padStart(5)}  ${l}`).join('\n')
      const last = start - 1 + slice.length
      return { text: `${display(ctx, abs)} (lines ${start}-${last} of ${lines.length}${truncated ? ', file cut at 400 KB' : ''})\n${numbered}${last < lines.length ? `\n[more: call again with offset ${last + 1}]` : ''}` }
    },
  },
  {
    name: 'search_files',
    title: 'Search files',
    description: 'Search file contents for a regular expression or plain text. Returns file:line matches (max 60). Use it to find where something is before reading.',
    inputSchema: shape({ pattern: str('Regular expression, or plain text if it is not valid regex'), path: str('Folder to search. Default: the workspace root.'), glob: str('Only files matching this pattern, for example *.ts or src/**/*.tsx') }, ['pattern']),
    annotations: { readOnlyHint: true },
    async run(a, ctx) {
      const base = resolveInWorkspace(ctx, a.path)
      const pattern = typeof a.pattern === 'string' ? a.pattern : ''
      if (!pattern) throw new WorkspaceError('Give a pattern to search for.')
      let re: RegExp
      try {
        re = new RegExp(pattern, 'i')
      } catch {
        re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      }
      const glob = typeof a.glob === 'string' && a.glob.trim() ? globToRegExp(a.glob.trim()) : null
      const hits: string[] = []
      const stack = [base]
      let scanned = 0
      while (stack.length && hits.length < 60 && scanned < 4000) {
        const dir = stack.pop()!
        let entries: fs.Dirent[]
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
          continue
        }
        for (const e of entries) {
          const abs = path.join(dir, e.name)
          if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name) && !ctx.protectedDirs.some((p) => same(p, abs))) stack.push(abs)
            continue
          }
          const rel = path.relative(base, abs).split(path.sep).join('/')
          if (glob && !glob.test(rel)) continue
          scanned++
          let st: fs.Stats
          try {
            st = fs.statSync(abs)
          } catch {
            continue
          }
          if (st.size > 1_000_000) continue
          const buf = fs.readFileSync(abs)
          if (looksBinary(buf)) continue
          buf.toString('utf8').split(/\r?\n/).forEach((line, i) => {
            if (hits.length < 60 && re.test(line)) hits.push(`${display(ctx, abs)}:${i + 1}: ${line.trim().slice(0, 200)}`)
          })
        }
      }
      return { text: hits.length ? `${hits.join('\n')}${hits.length >= 60 ? '\n[stopped at 60 matches]' : ''}` : 'No matches.' }
    },
  },
  {
    name: 'edit_file',
    title: 'Edit a file',
    description: 'Change a file by replacing exact text. old_text must appear exactly once (or set replace_all). Read the file first so old_text matches character for character.',
    inputSchema: shape({ path: str('File to edit'), old_text: str('Exact text to replace'), new_text: str('Replacement text'), replace_all: { type: 'boolean', description: 'Replace every occurrence' } }, ['path', 'old_text', 'new_text']),
    annotations: { readOnlyHint: false, destructiveHint: true },
    needsApproval: true,
    async run(a, ctx) {
      needWrite(ctx)
      const abs = resolveInWorkspace(ctx, a.path)
      if (touchesGit(abs)) throw new WorkspaceError('Files inside .git are off limits.')
      const oldText = typeof a.old_text === 'string' ? a.old_text : ''
      const newText = typeof a.new_text === 'string' ? a.new_text : ''
      if (!oldText) throw new WorkspaceError('old_text is empty. To create a file use write_file.')
      const { text, truncated } = readText(abs)
      if (truncated) throw new WorkspaceError('The file is too large to edit safely.')
      const nl = eol(text)
      const needle = nl === '\r\n' ? oldText.replace(/\r?\n/g, '\r\n') : oldText
      const replacement = nl === '\r\n' ? newText.replace(/\r?\n/g, '\r\n') : newText
      const count = text.split(needle).length - 1
      if (count === 0) throw new WorkspaceError('old_text was not found. Re-read the file and copy the text exactly, including indentation.')
      if (count > 1 && a.replace_all !== true) throw new WorkspaceError(`old_text appears ${count} times. Add surrounding lines to make it unique, or set replace_all.`)
      const next = a.replace_all === true ? text.split(needle).join(replacement) : text.replace(needle, () => replacement)
      if (Buffer.byteLength(next) > MAX_WRITE_BYTES) throw new WorkspaceError('The result would be too large.')
      fs.writeFileSync(abs, next, 'utf8')
      return { text: `Edited ${display(ctx, abs)} (${a.replace_all === true ? count : 1} replacement${count === 1 ? '' : 's'}).` }
    },
  },
  {
    name: 'write_file',
    title: 'Write a file',
    description: 'Create a file, or replace one when overwrite is true. Missing folders are created. For small changes to an existing file prefer edit_file.',
    inputSchema: shape({ path: str('File to create'), content: str('Full file contents'), overwrite: { type: 'boolean', description: 'Allow replacing an existing file' } }, ['path', 'content']),
    annotations: { readOnlyHint: false, destructiveHint: true },
    needsApproval: true,
    async run(a, ctx) {
      needWrite(ctx)
      const abs = resolveInWorkspace(ctx, a.path)
      if (touchesGit(abs)) throw new WorkspaceError('Files inside .git are off limits.')
      const content = typeof a.content === 'string' ? a.content : ''
      if (Buffer.byteLength(content) > MAX_WRITE_BYTES) throw new WorkspaceError('That is more than 1 MB. Split it into several files.')
      const existed = fs.existsSync(abs)
      if (existed && a.overwrite !== true) throw new WorkspaceError(`${display(ctx, abs)} already exists. Use edit_file, or set overwrite to replace it.`)
      if (existed && fs.statSync(abs).isDirectory()) throw new WorkspaceError('That path is a folder.')
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, content, 'utf8')
      return { text: `${existed ? 'Replaced' : 'Created'} ${display(ctx, abs)} (${Buffer.byteLength(content)} bytes).` }
    },
  },
  {
    name: 'make_folder',
    title: 'Create a folder',
    description: 'Create a folder (and any missing parents).',
    inputSchema: shape({ path: str('Folder to create') }, ['path']),
    annotations: { readOnlyHint: false },
    needsApproval: true,
    async run(a, ctx) {
      needWrite(ctx)
      const abs = resolveInWorkspace(ctx, a.path)
      if (touchesGit(abs)) throw new WorkspaceError('.git is off limits.')
      fs.mkdirSync(abs, { recursive: true })
      return { text: `Created ${display(ctx, abs)}/` }
    },
  },
  {
    name: 'move_file',
    title: 'Move or rename',
    description: 'Move or rename a file or folder inside the workspace. It will not overwrite anything.',
    inputSchema: shape({ from: str('Current path'), to: str('New path') }, ['from', 'to']),
    annotations: { readOnlyHint: false },
    needsApproval: true,
    async run(a, ctx) {
      needWrite(ctx)
      const from = resolveInWorkspace(ctx, a.from)
      const to = resolveInWorkspace(ctx, a.to)
      if (touchesGit(from) || touchesGit(to)) throw new WorkspaceError('.git is off limits.')
      if (!fs.existsSync(from)) throw new WorkspaceError('The source does not exist.')
      if (fs.existsSync(to)) throw new WorkspaceError('The destination already exists.')
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.renameSync(from, to)
      return { text: `Moved ${display(ctx, from)} to ${display(ctx, to)}.` }
    },
  },
  {
    name: 'view_image',
    title: 'Look at an image',
    description: 'Load a picture from the workspace (png, jpg, webp, gif) so you can see it. Only useful if the model has vision.',
    inputSchema: shape({ path: str('Image file') }, ['path']),
    annotations: { readOnlyHint: true },
    async run(a, ctx): Promise<WorkspaceOutput> {
      const abs = resolveInWorkspace(ctx, a.path)
      const mime = IMAGE_MIME[path.extname(abs).toLowerCase()]
      if (!mime) throw new WorkspaceError('That is not a png, jpg, webp or gif image.')
      const st = fs.statSync(abs)
      if (!st.isFile()) throw new WorkspaceError('That is not a file.')
      if (st.size > MAX_IMAGE_BYTES) throw new WorkspaceError('The image is larger than 6 MB.')
      return { text: `Loaded ${display(ctx, abs)} (${st.size} bytes). It is attached to the next message for you to look at.`, images: [`data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`] }
    },
  },
]

// ---- Web and commands ----

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  }
  const v6 = ip.toLowerCase()
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:')
}

/** Refuses URLs that point at this machine or the local network: a fetched page must not be able to steer the Assistant at private services. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new WorkspaceError('That is not a valid URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new WorkspaceError('Only http and https links can be fetched.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((r) => r.address)
  if (!addresses.length) throw new WorkspaceError(`Could not look up ${host}.`)
  if (addresses.some(isPrivateAddress)) throw new WorkspaceError('That address is on this machine or the local network, which the Assistant may not fetch.')
  return url
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

const fetchUrl: Tool = {
  name: 'fetch_url',
  title: 'Fetch a web page',
  description: 'Download a web page or file from the internet and read it as text (pictures are attached so you can see them). Public addresses only.',
  inputSchema: shape({ url: str('http or https link') }, ['url']),
  annotations: { readOnlyHint: true, openWorldHint: true },
  async run(a): Promise<WorkspaceOutput> {
    let url = await assertPublicUrl(typeof a.url === 'string' ? a.url : '')
    let res: Response | undefined
    for (let hop = 0; hop < 4; hop++) {
      res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': `${BRAND.name}-Assistant/1.0` } })
      const next = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && next) {
        url = await assertPublicUrl(new URL(next, url).toString())
        continue
      }
      break
    }
    if (!res || (res.status >= 300 && res.status < 400)) throw new WorkspaceError('Too many redirects.')
    if (!res.ok) throw new WorkspaceError(`The server answered ${res.status}.`)
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const buf = Buffer.from(await res.arrayBuffer())
    if (type.startsWith('image/')) {
      if (buf.length > MAX_IMAGE_BYTES) throw new WorkspaceError('The image is larger than 6 MB.')
      return { text: `Fetched an image (${buf.length} bytes). It is attached for you to look at.`, images: [`data:${type};base64,${buf.toString('base64')}`] }
    }
    if (buf.length > 2_000_000 || looksBinary(buf)) throw new WorkspaceError(`That is not a readable page (${type || 'unknown type'}, ${buf.length} bytes).`)
    const raw = buf.toString('utf8')
    const text = type.includes('html') ? htmlToText(raw) : raw
    return { text: `${url.toString()}\n${text.length > 12_000 ? `${text.slice(0, 12_000)}\n[cut at 12000 characters]` : text}` }
  },
}

const runCommand: Tool = {
  name: 'run_command',
  title: 'Run a command',
  description: 'Run a shell command with the workspace as its working folder (for example tests or a build). Output is cut at 12000 characters; it stops after the timeout.',
  inputSchema: shape({ command: str('The command line'), timeout_seconds: { type: 'number', description: 'Default 30, max 120' } }, ['command']),
  annotations: { readOnlyHint: false, destructiveHint: true },
  needsApproval: true,
  async run(a, ctx) {
    if (!ctx.config.allowCommands) throw new WorkspaceError('Running commands is turned off. The user can allow it in Settings, Agents.')
    needWrite(ctx)
    const command = typeof a.command === 'string' ? a.command.trim() : ''
    if (!command) throw new WorkspaceError('Give a command to run.')
    const cwd = realOf(ctx.config.root)
    const seconds = Math.max(1, Math.min(120, Math.floor(Number(a.timeout_seconds) || 30)))
    return new Promise<ToolOutput>((resolve) => {
      const child = spawn(command, { cwd, shell: true, windowsHide: true, detached: process.platform !== 'win32' })
      let out = ''
      let done = false
      const finish = (head: string, isError: boolean) => {
        if (done) return
        done = true
        clearTimeout(timer)
        const body = out.length > 12_000 ? `${out.slice(0, 6_000)}\n[... cut ...]\n${out.slice(-6_000)}` : out
        resolve({ text: `${head}\n${body.trim() || '(no output)'}`, isError })
      }
      const add = (chunk: Buffer) => {
        if (out.length < 40_000) out += chunk.toString('utf8')
      }
      child.stdout.on('data', add)
      child.stderr.on('data', add)
      const timer = setTimeout(() => {
        killTree(child)
        finish(`Stopped after ${seconds}s.`, true)
      }, seconds * 1000)
      child.on('error', (e) => finish(`Could not start the command: ${e.message}`, true))
      child.on('close', (code) => finish(`Exit code ${code}.`, code !== 0))
    })
  },
}

/** Ends a shell command and whatever it started (a plain kill only stops the shell). */
function killTree(child: ReturnType<typeof spawn>) {
  if (!child.pid) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

/** Writes a picture (data URL) into the workspace; used when the Assistant generates an image and is asked to keep it. */
export function saveImage(ctx: WorkspaceCtx, rel: unknown, dataUrl: unknown): string {
  needWrite(ctx)
  const abs = resolveInWorkspace(ctx, rel)
  if (touchesGit(abs)) throw new WorkspaceError('Files inside .git are off limits.')
  if (!IMAGE_MIME[path.extname(abs).toLowerCase()]) throw new WorkspaceError('Name the file with .png, .jpg, .webp or .gif.')
  const m = /^data:image\/[\w+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '')
  if (!m) throw new WorkspaceError('That is not an image.')
  const bytes = Buffer.from(m[1], 'base64')
  if (bytes.length > 8_000_000) throw new WorkspaceError('The image is larger than 8 MB.')
  if (fs.existsSync(abs)) throw new WorkspaceError(`${display(ctx, abs)} already exists. Pick another name.`)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, bytes)
  return `Saved ${display(ctx, abs)} (${bytes.length} bytes).`
}

/** Tools that need no workspace folder. */
export const WEB_TOOLS: Tool[] = [fetchUrl]

/** Tools that act on the workspace folder (and the opt-in command runner). */
export function workspaceTools(config: WorkspaceConfig): Tool[] {
  return [...(config.root ? WORKSPACE_TOOLS : []), ...(config.root && config.allowCommands ? [runCommand] : [])]
}
