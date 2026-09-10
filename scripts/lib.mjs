// Shared helpers for the install/update scripts. No dependencies — these run before `npm install`.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// The server runs its own .ts files through Node (no build step) and stores data in node:sqlite.
// Type stripping only became unflagged in 22.18, so that — not node:sqlite's 22.5 — is the floor.
export const MIN_NODE = [22, 18, 0]

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined
const ESC = ''
const wrap = (code) => (s) => (useColor ? `${ESC}[${code}m${s}${ESC}[0m` : String(s))
export const bold = wrap('1')
export const dim = wrap('2')
export const red = wrap('31')
export const green = wrap('32')
export const yellow = wrap('33')

/** Print an actionable error and exit non-zero. */
export function fail(message, hints = []) {
  console.error(`\n${red(bold('x ' + message))}`)
  for (const hint of hints) console.error(`  ${hint}`)
  console.error('')
  process.exit(1)
}

/** True when the running Node is new enough to start the server. */
export function nodeIsSupported() {
  const [maj, min, pat] = process.versions.node.split('.').map(Number)
  const [rMaj, rMin, rPat] = MIN_NODE
  if (maj !== rMaj) return maj > rMaj
  if (min !== rMin) return min > rMin
  return pat >= rPat
}

/** Abort with an actionable message if this Node can't run the app. */
export function requireNode() {
  if (nodeIsSupported()) return
  fail(`RP Suite needs Node ${MIN_NODE.join('.')} or newer — you have ${process.versions.node}.`, [
    "The server runs TypeScript directly and stores data in Node's built-in SQLite,",
    'both of which need a recent Node. Node 24 LTS is what this is developed against.',
    '',
    `Download: ${bold('https://nodejs.org/')}`,
    dim('(or `nvm install 24 && nvm use 24` if you use nvm / nvm-windows)'),
  ])
}

/** Run a command with inherited stdio. */
export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: repoRoot, stdio: 'inherit', shell: false, ...opts })
  if (res.error) return { ok: false, code: 1, error: res.error }
  return { ok: res.status === 0, code: res.status ?? 1 }
}

// Invoke the same npm that launched this script rather than a PATH lookup — that keeps Windows out
// of the npm/npm.cmd shell-quoting mess and guarantees the npm version the user actually ran.
export function npmRun(args) {
  const execpath = process.env.npm_execpath
  if (execpath && execpath.endsWith('.js')) return run(process.execPath, [execpath, ...args])
  const win = process.platform === 'win32'
  return run(win ? 'npm.cmd' : 'npm', args, { shell: win })
}

/** Run git and capture stdout. `ok` is false for any non-zero exit. */
export function git(args) {
  const res = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  return {
    ok: !res.error && res.status === 0,
    out: (res.stdout ?? '').trim(),
    err: (res.stderr ?? '').trim(),
    missing: res.error?.code === 'ENOENT',
  }
}
