// MCP client: connect to other MCP servers over HTTP and expose their tools to the in-app Assistant.

import express from 'express'
import { BRAND, BRAND_ID } from '../src/lib/brand.ts'
import { appSettingsStore, newId } from './db.ts'
import { SUPPORTED_VERSIONS } from './mcpProtocol.ts'

const SETTINGS_ID = 'mcp-servers'
const LISTING_TTL_MS = 60_000
const REQUEST_TIMEOUT_MS = 30_000

export interface ExternalServer {
  id: string
  name: string
  url: string
  token?: string
}

export interface ExternalTool {
  /** Unique across servers: `<server slug>__<tool>`. */
  name: string
  title: string
  description: string
  inputSchema: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] }
  write: boolean
}

type Row = Record<string, unknown>

export function listServers(): ExternalServer[] {
  const row = appSettingsStore.get(SETTINGS_ID)
  return Array.isArray(row?.servers) ? (row.servers as ExternalServer[]) : []
}

function saveServers(servers: ExternalServer[]): void {
  if (appSettingsStore.get(SETTINGS_ID)) appSettingsStore.update(SETTINGS_ID, { servers, updatedAt: Date.now() })
  else appSettingsStore.insert({ id: SETTINGS_ID, servers, updatedAt: Date.now() })
}

export const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'server'

/** Reads a JSON-RPC reply that may arrive as plain JSON or as a server-sent event stream. */
export function parseReply(contentType: string, text: string, id: number): Row {
  if (contentType.includes('text/event-stream')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n')
      if (!data) continue
      try {
        const msg = JSON.parse(data) as Row
        if (msg.id === id) return msg
      } catch {
        // Skip non-JSON events.
      }
    }
    throw new Error('The server answered with an event stream that had no matching reply.')
  }
  try {
    return JSON.parse(text) as Row
  } catch {
    throw new Error(`The server did not answer with JSON (${text.slice(0, 80).replace(/\s+/g, ' ')})`)
  }
}

interface Session {
  server: ExternalServer
  sessionId?: string
  version: string
}

let rpcId = 0

async function post(session: Session, body: Row, wantReply: boolean): Promise<Row | null> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  if (session.server.token) headers.authorization = `Bearer ${session.server.token}`
  if (session.sessionId) headers['mcp-session-id'] = session.sessionId
  if (session.version) headers['mcp-protocol-version'] = session.version
  const res = await fetch(session.server.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  const sid = res.headers.get('mcp-session-id')
  if (sid) session.sessionId = sid
  if (!wantReply) return null
  const text = await res.text()
  if (!res.ok && !text) throw new Error(`The server answered ${res.status}.`)
  if (res.status === 401 || res.status === 403) throw new Error('The server rejected the key.')
  return parseReply(res.headers.get('content-type') ?? '', text, body.id as number)
}

async function call(session: Session, method: string, params: Row = {}): Promise<Row> {
  const id = ++rpcId
  const reply = await post(session, { jsonrpc: '2.0', id, method, params }, true)
  if (!reply) throw new Error('No reply')
  if (reply.error) throw new Error(String((reply.error as Row).message ?? 'The server returned an error'))
  return (reply.result ?? {}) as Row
}

async function open(server: ExternalServer): Promise<Session> {
  const session: Session = { server, version: '' }
  const init = await call(session, 'initialize', { protocolVersion: SUPPORTED_VERSIONS[1], capabilities: {}, clientInfo: { name: BRAND_ID, version: '1' } })
  session.version = typeof init.protocolVersion === 'string' ? init.protocolVersion : SUPPORTED_VERSIONS[1]
  await post(session, { jsonrpc: '2.0', method: 'notifications/initialized' }, false).catch(() => null)
  return session
}

const cache = new Map<string, { at: number; tools: ExternalTool[] }>()

function toTool(server: ExternalServer, raw: Row): ExternalTool | null {
  if (typeof raw.name !== 'string' || !raw.name) return null
  const schema = (raw.inputSchema && typeof raw.inputSchema === 'object' ? raw.inputSchema : {}) as ExternalTool['inputSchema']
  const annotations = (raw.annotations ?? {}) as Row
  return {
    name: `${slugOf(server.name)}__${raw.name}`,
    title: typeof raw.title === 'string' ? raw.title : raw.name,
    description: `[${server.name}] ${typeof raw.description === 'string' ? raw.description : raw.name}`,
    inputSchema: { properties: schema.properties ?? {}, required: schema.required ?? [] },
    write: annotations.readOnlyHint !== true,
  }
}

/** Connects once and lists the server's tools. Throws a readable reason when it cannot. */
export async function discover(server: ExternalServer): Promise<ExternalTool[]> {
  const session = await open(server)
  const out: ExternalTool[] = []
  let cursor: string | undefined
  for (let page = 0; page < 5; page++) {
    const result = await call(session, 'tools/list', cursor ? { cursor } : {})
    for (const raw of (result.tools as Row[] | undefined) ?? []) {
      const tool = toTool(server, raw)
      if (tool) out.push(tool)
    }
    cursor = typeof result.nextCursor === 'string' ? result.nextCursor : undefined
    if (!cursor) break
  }
  cache.set(server.id, { at: Date.now(), tools: out })
  return out
}

/** Tools from every connected server; a server that is down contributes nothing rather than breaking the list. */
export async function externalTools(): Promise<ExternalTool[]> {
  const all = await Promise.all(
    listServers().map(async (server) => {
      const hit = cache.get(server.id)
      if (hit && Date.now() - hit.at < LISTING_TTL_MS) return hit.tools
      try {
        return await discover(server)
      } catch {
        return hit?.tools ?? []
      }
    }),
  )
  return all.flat()
}

export function isExternalTool(name: string): boolean {
  return name.includes('__') && listServers().some((s) => name.startsWith(`${slugOf(s.name)}__`))
}

export async function callExternalTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const server = listServers().find((s) => name.startsWith(`${slugOf(s.name)}__`))
  if (!server) throw new Error(`No connected server for tool "${name}".`)
  const session = await open(server)
  const result = await call(session, 'tools/call', { name: name.slice(slugOf(server.name).length + 2), arguments: args })
  const text = ((result.content as Row[] | undefined) ?? [])
    .map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : `[${String(c.type ?? 'content')} not shown]`))
    .join('\n')
  return { text: text || JSON.stringify(result.structuredContent ?? {}), isError: result.isError === true }
}

function cleanUrl(raw: unknown): string {
  let url: URL
  try {
    url = new URL(String(raw ?? '').trim())
  } catch {
    throw new Error('That is not a valid address.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https addresses work. Programs that need to be launched are not supported.')
  return url.toString()
}

const view = (s: ExternalServer) => ({ id: s.id, name: s.name, url: s.url, hasKey: Boolean(s.token), tools: cache.get(s.id)?.tools.length ?? null })

/** Settings routes for the Agents tab: list, connect (tested before saving) and remove. */
export function mcpServersRouter(): express.Router {
  const router = express.Router()

  router.get('/api/mcp/servers', (_req, res) => res.json(listServers().map(view)))

  router.post('/api/mcp/servers', async (req, res) => {
    try {
      const name = String(req.body?.name ?? '').trim().slice(0, 40)
      if (!name) throw new Error('Give the server a name.')
      const server: ExternalServer = { id: newId(), name, url: cleanUrl(req.body?.url), ...(req.body?.token ? { token: String(req.body.token).trim() } : {}) }
      if (listServers().some((s) => slugOf(s.name) === slugOf(name))) throw new Error('A server with that name is already connected.')
      const tools = await discover(server)
      saveServers([...listServers(), server])
      res.status(201).json({ ...view(server), tools: tools.length })
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Could not connect' })
    }
  })

  router.delete('/api/mcp/servers/:id', (req, res) => {
    saveServers(listServers().filter((s) => s.id !== req.params.id))
    cache.delete(req.params.id)
    res.status(204).end()
  })

  return router
}

