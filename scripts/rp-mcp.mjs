#!/usr/bin/env node
// stdio bridge: lets MCP clients that only spawn local commands (Claude Desktop) talk to the app's /mcp endpoint.

import fs from 'node:fs'
import readline from 'node:readline'

const APP = JSON.parse(fs.readFileSync(new URL('../src/lib/brand.json', import.meta.url), 'utf8')).name

const args = process.argv.slice(2)
const flag = (name) => {
  const at = args.indexOf(`--${name}`)
  return at !== -1 ? args[at + 1] : undefined
}

const url = flag('url') || process.env.RP_MCP_URL || 'http://127.0.0.1:3001/mcp'
const token = flag('token') || process.env.RP_MCP_TOKEN || ''

const log = (...parts) => process.stderr.write(`[rp-mcp] ${parts.join(' ')}\n`)
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

if (!token) {
  log(`No token. Set RP_MCP_TOKEN (copy it from ${APP}: Settings, Agents).`)
  process.exit(1)
}

function failure(id, text) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code: -32000, message: text } }
}

async function forward(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    send(failure(null, 'Invalid JSON from client'))
    return
  }
  const ids = (Array.isArray(message) ? message : [message]).filter((m) => m && m.id !== undefined).map((m) => m.id)

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
      body: line,
      signal: AbortSignal.timeout(120_000),
    })
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    log(`Cannot reach ${url}: ${reason}`)
    for (const id of ids) send(failure(id, `${APP} is not reachable at ${url}. Is the app running?`))
    return
  }

  if (res.status === 202) return
  const text = await res.text()
  if (res.status === 401 || res.status === 404) {
    const why = res.status === 401 ? 'The token was rejected. Copy a fresh one from Settings, Agents.' : 'Agent access is switched off. Turn it on in Settings, Agents.'
    log(why)
    for (const id of ids) send(failure(id, why))
    return
  }
  try {
    send(JSON.parse(text))
  } catch {
    for (const id of ids) send(failure(id, `Unexpected reply from ${APP} (${res.status})`))
  }
}

const pending = new Set()
const rl = readline.createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  if (!line.trim()) return
  const job = forward(line).finally(() => pending.delete(job))
  pending.add(job)
})
// Let the event loop drain instead of calling process.exit(): exiting with a fetch still closing trips a libuv assertion on Windows.
rl.on('close', async () => {
  await Promise.all(pending)
  process.exitCode = 0
})
