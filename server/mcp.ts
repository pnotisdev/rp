// MCP endpoint: token-gated JSON-RPC over HTTP, the Agents settings routes, and the tunnel-safe listener.

import crypto from 'node:crypto'
import { BRAND, BRAND_ID } from '../src/lib/brand.ts'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { appSettingsStore } from './db.ts'
import { ERR, MODERN_VERSION, SUPPORTED_VERSIONS, createMcpHandler, type RpcResponse } from './mcpProtocol.ts'
import { createMcpConfig, restClient, type McpContext } from './mcpTools.ts'
import { originGuard } from './originCheck.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

// ---- Settings ----

export interface McpSettings {
  enabled: boolean
  /** When true, tools that change anything are refused. */
  readOnly: boolean
  token: string
}

const SETTINGS_ID = 'mcp'
const newToken = () => crypto.randomBytes(32).toString('base64url')

export function mcpSettings(): McpSettings {
  const row = appSettingsStore.get(SETTINGS_ID)
  if (row && typeof row.token === 'string' && row.token) return { enabled: row.enabled === true, readOnly: row.readOnly === true, token: row.token }
  const fresh: McpSettings = { enabled: false, readOnly: false, token: newToken() }
  if (row) appSettingsStore.update(SETTINGS_ID, { ...fresh, updatedAt: Date.now() })
  else appSettingsStore.insert({ id: SETTINGS_ID, ...fresh, updatedAt: Date.now() })
  return fresh
}

export function saveMcpSettings(patch: Partial<McpSettings>): McpSettings {
  const next = { ...mcpSettings(), ...patch }
  appSettingsStore.update(SETTINGS_ID, { ...next, updatedAt: Date.now() })
  return next
}

export const apiPort = () => Number(process.env.API_PORT) || 3001
export const mcpPort = () => Number(process.env.MCP_PORT) || apiPort() + 1

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

// ---- Protocol endpoint ----

let version = '0.0.0'
try {
  version = (JSON.parse(fs.readFileSync(path.resolve(here, '..', 'package.json'), 'utf8')) as { version?: string }).version ?? version
} catch {
  // Version is informational only.
}

const handler = createMcpHandler<McpContext>(createMcpConfig(version))

const header = (req: express.Request, name: string): string | undefined => {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

function rpcError(id: unknown, code: number, message: string, data?: unknown): RpcResponse {
  return { jsonrpc: '2.0', id: typeof id === 'string' || typeof id === 'number' ? id : null, error: { code, message, ...(data !== undefined ? { data } : {}) } }
}

// Too many wrong tokens in a minute locks the endpoint briefly; the real token is far too long to guess.
const failures: number[] = []
const FAIL_WINDOW_MS = 60_000
const FAIL_LIMIT = 30

function throttled(): boolean {
  const cutoff = Date.now() - FAIL_WINDOW_MS
  while (failures.length && failures[0] < cutoff) failures.shift()
  return failures.length >= FAIL_LIMIT
}

/** The request's method/name pair that the modern transport mirrors into headers. */
function mirrored(body: unknown): { method?: string; name?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  const b = body as { method?: unknown; params?: { name?: unknown; uri?: unknown } }
  const method = typeof b.method === 'string' ? b.method : undefined
  const name = method === 'resources/read' ? b.params?.uri : method === 'tools/call' || method === 'prompts/get' ? b.params?.name : undefined
  return { method, name: typeof name === 'string' ? name : undefined }
}

const statusFor = (response: RpcResponse, modern: boolean): number => {
  if (!('error' in response)) return 200
  if (response.error.code === ERR.parse || response.error.code === ERR.invalidRequest) return 400
  if (response.error.code === ERR.methodNotFound && modern) return 404
  return 200
}

/** The POST /mcp (and /mcp/:token) route set. `apiBase` says where the app's REST API is reachable. */
export function mcpRouter(opts: { apiBase: (req: express.Request) => string }): express.Router {
  const router = express.Router()

  const gate: express.RequestHandler = (req, res, next) => {
    const settings = mcpSettings()
    if (!settings.enabled) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    if (throttled()) {
      res.status(429).set('Retry-After', '60').json({ error: 'Too many failed attempts' })
      return
    }
    const auth = header(req, 'authorization')
    const bearer = auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : undefined
    const supplied = (typeof req.params.token === 'string' ? req.params.token : undefined) ?? bearer
    if (!supplied || !safeEqual(supplied, settings.token)) {
      failures.push(Date.now())
      res.status(401).set('WWW-Authenticate', `Bearer realm="${BRAND_ID}"`).json({ error: 'Unauthorized' })
      return
    }
    next()
  }

  const parse = express.json({ limit: '4mb' })
  const body: express.RequestHandler = (req, res, next) =>
    parse(req, res, (err?: unknown) => {
      if (err) res.status(400).json(rpcError(null, ERR.parse, 'Parse error: the body is not valid JSON'))
      else next()
    })

  const post: express.RequestHandler = async (req, res) => {
    const settings = mcpSettings()
    const sent = header(req, 'mcp-protocol-version')
    let modern = false
    if (sent) {
      if (!SUPPORTED_VERSIONS.includes(sent)) {
        res.status(400).json(rpcError(null, ERR.unsupportedVersion, `Unsupported protocol version: ${sent}`, { supported: SUPPORTED_VERSIONS }))
        return
      }
      modern = sent === MODERN_VERSION
    }

    const payload: unknown = req.body
    if (payload === undefined || payload === null || typeof payload !== 'object') {
      res.status(400).json(rpcError(null, ERR.invalidRequest, 'Send a JSON-RPC request as an application/json body'))
      return
    }

    if (modern && !Array.isArray(payload)) {
      const want = mirrored(payload)
      const methodHeader = header(req, 'mcp-method')
      const nameHeader = header(req, 'mcp-name')
      if ((methodHeader !== undefined && methodHeader !== want.method) || (nameHeader !== undefined && want.name !== undefined && nameHeader !== want.name)) {
        res.status(400).json(rpcError((payload as { id?: unknown }).id, ERR.headerMismatch, 'Mcp-Method / Mcp-Name headers do not match the request body'))
        return
      }
    }

    const ctx: McpContext = { rest: restClient(opts.apiBase(req)), readOnly: settings.readOnly }
    try {
      if (Array.isArray(payload)) {
        const out = (await Promise.all(payload.map((m) => handler.handle(m, { modern }, ctx)))).filter((r): r is RpcResponse => r !== null)
        if (out.length === 0) res.status(202).end()
        else res.json(out)
        return
      }
      const response = await handler.handle(payload, { modern }, ctx)
      if (response === null) {
        res.status(202).end()
        return
      }
      res.status(statusFor(response, modern)).json(response)
    } catch (e) {
      res.status(500).json(rpcError((payload as { id?: unknown }).id, ERR.internal, e instanceof Error ? e.message : 'Internal error'))
    }
  }

  const notAllowed: express.RequestHandler = (_req, res) => {
    res.status(405).set('Allow', 'POST').json({ error: 'This MCP server only accepts POST' })
  }

  // Both the Authorization header and the path-token form work, for clients that can only set a URL.
  for (const route of ['/mcp', '/mcp/:token']) {
    router.post(route, gate, body, post)
    router.all(route, gate, notAllowed)
  }
  return router
}

// ---- Settings routes (the Agents tab) ----

export function mcpSettingsRouter(): express.Router {
  const router = express.Router()

  const view = (req: express.Request) => {
    const s = mcpSettings()
    const apiHere = req.socket.localPort ?? apiPort()
    return { enabled: s.enabled, readOnly: s.readOnly, token: s.token, apiPort: apiHere, mcpPort: mcpPort(), scriptPath: path.resolve(here, '..', 'scripts', 'rp-mcp.mjs') }
  }

  router.get('/api/mcp/settings', (req, res) => res.json(view(req)))

  router.put('/api/mcp/settings', (req, res) => {
    const patch: Partial<McpSettings> = {}
    if (typeof req.body?.enabled === 'boolean') patch.enabled = req.body.enabled
    if (typeof req.body?.readOnly === 'boolean') patch.readOnly = req.body.readOnly
    saveMcpSettings(patch)
    res.json(view(req))
  })

  router.post('/api/mcp/token', (req, res) => {
    saveMcpSettings({ token: newToken() })
    res.json(view(req))
  })

  return router
}

// ---- Dedicated listener ----

/** A second port that serves nothing but /mcp */
export function startMcpListener(opts: { host: string; port: number; apiBase: string }) {
  const app = express()
  app.disable('x-powered-by')
  app.use(originGuard)
  app.use(mcpRouter({ apiBase: () => opts.apiBase }))
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })
  const server = app.listen(opts.port, opts.host, () => {
    const bound = server.address()
    console.log(`[rp-server] MCP-only listener on http://${opts.host}:${typeof bound === 'object' && bound ? bound.port : opts.port}/mcp`)
  })
  server.on('error', (e: NodeJS.ErrnoException) => {
    console.warn(`[rp-server] MCP listener could not start on port ${opts.port} (${e.code ?? e.message}). The main port still serves /mcp.`)
  })
  return server
}
