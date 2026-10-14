import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

let tmp: string
let server: Server
let base: string
let mock: Server
let mockUrl: string
let mockSse = false

const json = async (method: string, route: string, body?: unknown) => {
  const res = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as any) }
}
const call = async (name: string, args: Record<string, unknown>, allowWrites: boolean) => (await json('POST', '/api/agent/call', { name, arguments: args, allowWrites })).body as { text: string; isError: boolean }

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-agent-test-'))
  process.env.RP_DATA_DIR = tmp
  const { app } = await import('./app.ts')
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  // A tiny MCP server to connect to: initialize, tools/list, tools/call; replies as JSON or an event stream.
  const express = (await import('express')).default
  const other = express()
  other.use(express.json())
  other.post('/mcp', (req, res) => {
    if (req.headers.authorization !== 'Bearer secret') return void res.status(401).json({ error: 'no' })
    const { id, method, params } = req.body
    if (id === undefined) return void res.status(202).end()
    const result =
      method === 'initialize'
        ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1' } }
        : method === 'tools/list'
          ? {
              tools: [
                { name: 'echo', description: 'Echoes text back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, annotations: { readOnlyHint: true } },
                { name: 'shout', description: 'Shouts text.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
              ],
            }
          : { content: [{ type: 'text', text: `${params.name}:${params.arguments.text}` }], isError: false }
    const reply = { jsonrpc: '2.0', id, result }
    if (mockSse) {
      res.set('content-type', 'text/event-stream').send(`event: message\ndata: ${JSON.stringify(reply)}\n\n`)
    } else res.json(reply)
  })
  mock = other.listen(0, '127.0.0.1')
  await once(mock, 'listening')
  mockUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}/mcp`
}, 60_000)

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await new Promise((resolve) => mock.close(resolve))
  const { db } = await import('./db.ts')
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('built-in agent tools', () => {
  it('lists the library tools with a write flag', async () => {
    const { body } = await json('GET', '/api/agent/tools')
    const byName = Object.fromEntries(body.map((t: any) => [t.name, t]))
    expect(byName.list_characters.write).toBe(false)
    expect(byName.create_world.write).toBe(true)
    expect(byName.create_world.inputSchema.required).toEqual(['name', 'description'])
    expect(body.length).toBeGreaterThanOrEqual(30)
  })

  it('refuses writes unless allowed, then performs them', async () => {
    const args = { name: 'Reach', description: 'A town.', lore_entries: [{ keys: ['town'], content: 'It is small.' }] }
    const blocked = await call('create_world', args, false)
    expect(blocked.isError).toBe(true)
    expect(blocked.text).toMatch(/read-only/)
    const made = await call('create_world', args, true)
    expect(made.isError).toBe(false)
    expect(JSON.parse(made.text)).toMatchObject({ created: true, name: 'Reach', lore_entries: 1 })
    expect(JSON.parse((await call('list_worlds', {}, false)).text)).toHaveLength(1)
  })

  it('reports bad arguments and unknown tools as tool errors', async () => {
    expect((await call('create_world', { name: 'x' }, true)).text).toMatch(/description is required/)
    expect((await call('no_such_tool', {}, true)).text).toMatch(/no tool called/)
  })
})

describe('connected MCP servers', () => {
  it('rejects a bad address, a wrong key and a missing name without saving anything', async () => {
    expect((await json('POST', '/api/mcp/servers', { name: 'Mock', url: 'not a url' })).body.error).toMatch(/valid address/)
    expect((await json('POST', '/api/mcp/servers', { name: 'Mock', url: 'file:///etc/passwd' })).body.error).toMatch(/http/)
    expect((await json('POST', '/api/mcp/servers', { name: 'Mock', url: mockUrl, token: 'wrong' })).body.error).toMatch(/rejected the key/)
    expect((await json('POST', '/api/mcp/servers', { url: mockUrl })).body.error).toMatch(/name/)
    expect((await json('GET', '/api/mcp/servers')).body).toEqual([])
  })

  it('connects, lists its tools next to the built-in ones, and never leaks the key', async () => {
    const added = await json('POST', '/api/mcp/servers', { name: 'Mock Tools', url: mockUrl, token: 'secret' })
    expect(added.status).toBe(201)
    expect(added.body).toMatchObject({ name: 'Mock Tools', hasKey: true, tools: 2 })
    expect(JSON.stringify((await json('GET', '/api/mcp/servers')).body)).not.toContain('secret')
    const tools = (await json('GET', '/api/agent/tools')).body
    const echo = tools.find((t: any) => t.name === 'mock_tools__echo')
    expect(echo).toMatchObject({ write: false, description: '[Mock Tools] Echoes text back.' })
    expect(tools.find((t: any) => t.name === 'mock_tools__shout').write).toBe(true)
  })

  it('calls external tools, blocking ones that may change things in read-only mode', async () => {
    expect(await call('mock_tools__echo', { text: 'hi' }, false)).toEqual({ text: 'echo:hi', isError: false })
    expect((await call('mock_tools__shout', { text: 'hi' }, false)).text).toMatch(/read-only/)
    expect(await call('mock_tools__shout', { text: 'hi' }, true)).toEqual({ text: 'shout:hi', isError: false })
  })

  it('understands event-stream replies', async () => {
    mockSse = true
    try {
      expect(await call('mock_tools__echo', { text: 'sse' }, false)).toEqual({ text: 'echo:sse', isError: false })
    } finally {
      mockSse = false
    }
  })

  it('refuses a duplicate name and forgets a removed server', async () => {
    expect((await json('POST', '/api/mcp/servers', { name: 'mock tools', url: mockUrl, token: 'secret' })).body.error).toMatch(/already connected/)
    const [server] = (await json('GET', '/api/mcp/servers')).body
    expect((await json('DELETE', `/api/mcp/servers/${server.id}`)).status).toBe(204)
    expect((await json('GET', '/api/mcp/servers')).body).toEqual([])
    expect((await json('GET', '/api/agent/tools')).body.some((t: any) => t.name.startsWith('mock_tools__'))).toBe(false)
    expect((await call('mock_tools__echo', { text: 'x' }, true)).text).toMatch(/no tool called/)
  })
})
