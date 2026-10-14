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
let token: string
let mcp: typeof import('./mcp.ts')
let ext: typeof import('./extensions.ts')

interface Reply {
  status: number
  body: any
  headers: Headers
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers }
}

let id = 0
const rpc = (method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}, at = `${base}/mcp`) =>
  post(at, { jsonrpc: '2.0', id: ++id, method, params }, { authorization: `Bearer ${token}`, ...headers })

async function tool(name: string, args: Record<string, unknown> = {}) {
  const r = await rpc('tools/call', { name, arguments: args })
  expect(r.status).toBe(200)
  const text: string = r.body.result.content[0].text
  return { isError: r.body.result.isError as boolean, text, data: () => JSON.parse(text) }
}

const api = async (method: string, route: string, body?: unknown): Promise<any> => {
  const res = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return res.status === 204 ? null : res.json()
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-mcp-test-'))
  process.env.RP_DATA_DIR = tmp
  const { app } = await import('./app.ts')
  mcp = await import('./mcp.ts')
  ext = await import('./extensions.ts')
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  token = (await api('GET', '/api/mcp/settings')).token
}, 60_000)

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  const { db } = await import('./db.ts')
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('access control', () => {
  it('is invisible until the user turns it on', async () => {
    const r = await rpc('ping')
    expect(r.status).toBe(404)
  })

  it('requires the token once enabled, as a bearer header or in the path', async () => {
    const on = await api('PUT', '/api/mcp/settings', { enabled: true })
    expect(on).toMatchObject({ enabled: true, readOnly: false })
    expect(on.token.length).toBeGreaterThan(30)

    const none = await post(`${base}/mcp`, { jsonrpc: '2.0', id: 1, method: 'ping' })
    expect(none.status).toBe(401)
    expect(none.headers.get('www-authenticate')).toMatch(/Bearer/)

    const wrong = await post(`${base}/mcp`, { jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'Bearer wrong' })
    expect(wrong.status).toBe(401)

    expect((await rpc('ping')).status).toBe(200)
    expect((await post(`${base}/mcp/${token}`, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200)
    expect((await post(`${base}/mcp/not-the-token`, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
  })

  it('refuses GET and DELETE with 405', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(`${base}/mcp`, { method, headers: { authorization: `Bearer ${token}` } })
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('POST')
    }
  })

  it('rejects a request from another website', async () => {
    const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, origin: 'https://evil.example' }, body: '{}' })
    expect(res.status).toBe(403)
  })

  it('reports malformed JSON as a parse error', async () => {
    const r = await post(`${base}/mcp`, '{not json', { authorization: `Bearer ${token}` })
    expect(r.status).toBe(400)
    expect(r.body.error.code).toBe(-32700)
  })

  it('rotates the token, locking out the old one', async () => {
    const old = token
    const rotated = await api('POST', '/api/mcp/token')
    token = rotated.token
    expect(token).not.toBe(old)
    expect((await post(`${base}/mcp`, { jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: `Bearer ${old}` })).status).toBe(401)
    expect((await rpc('ping')).status).toBe(200)
  })
})

describe('protocol over HTTP', () => {
  it('completes a legacy handshake', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    expect(init.body.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'hakoniwa' } })
    const note = await post(`${base}/mcp`, { jsonrpc: '2.0', method: 'notifications/initialized' }, { authorization: `Bearer ${token}`, 'mcp-protocol-version': '2025-06-18' })
    expect(note.status).toBe(202)
  })

  it('serves the stateless 2026-07-28 revision', async () => {
    const r = await rpc('server/discover', {}, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'server/discover' })
    expect(r.status).toBe(200)
    expect(r.body.result).toMatchObject({ resultType: 'complete' })
    const list = await rpc('tools/list', {}, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' })
    expect(list.body.result.resultType).toBe('complete')
    const unknown = await rpc('made/up', {}, { 'mcp-protocol-version': '2026-07-28' })
    expect(unknown.status).toBe(404)
    expect(unknown.body.error.code).toBe(-32601)
  })

  it('rejects unsupported versions and mismatched mirror headers', async () => {
    const bad = await rpc('ping', {}, { 'mcp-protocol-version': '2099-01-01' })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe(-32022)
    const mismatch = await rpc('tools/list', {}, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call' })
    expect(mismatch.status).toBe(400)
    expect(mismatch.body.error.code).toBe(-32020)
    const name = await rpc('tools/call', { name: 'get_overview', arguments: {} }, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'other_tool' })
    expect(name.body.error.code).toBe(-32020)
  })

  it('answers a JSON-RPC batch', async () => {
    const r = await post(`${base}/mcp`, [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'ping' }], { authorization: `Bearer ${token}` })
    expect(r.body).toHaveLength(2)
  })

  it('lists a complete, well-formed tool set', async () => {
    const r = await rpc('tools/list')
    const tools = r.body.result.tools as { name: string; description: string; inputSchema: { type: string } }[]
    expect(tools.length).toBeGreaterThanOrEqual(30)
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-z_]+$/)
      expect(t.description.length).toBeGreaterThan(10)
      expect(t.inputSchema.type).toBe('object')
    }
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['create_character', 'create_world', 'add_lore_entries', 'create_extension', 'lint_extension', 'read_chat', 'remember_fact']))
  })

  it('serves docs, templates and prompts', async () => {
    const guide = await rpc('resources/read', { uri: 'rp://docs/extension-guide' })
    expect(guide.body.result.contents[0].text).toMatch(/Building extensions/)
    const model = await rpc('resources/read', { uri: 'rp://docs/data-model' })
    expect(model.body.result.contents[0].text).toMatch(/Lorebooks/)
    const prompts = await rpc('prompts/list')
    expect(prompts.body.result.prompts.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(['create_character', 'build_extension']))
    const got = await rpc('prompts/get', { name: 'create_character', arguments: { concept: 'a retired lighthouse keeper' } })
    expect(got.body.result.messages[0].content.text).toMatch(/lighthouse keeper/)
  })
})

describe('library tools', () => {
  let worldId: string
  let characterId: string
  let chatId: string

  it('starts empty', async () => {
    const r = await tool('get_overview')
    expect(r.data()).toMatchObject({ characters: [], worlds: [], chats: 0 })
  })

  it('creates a world with lore in one call', async () => {
    const r = await tool('create_world', {
      name: 'Saltmarsh',
      description: 'A fog-bound fishing town on a drowned coast.',
      rules: 'No magic. Technology is early industrial.',
      template: 'freeform',
      lore_entries: [
        { keys: ['lighthouse', 'beacon'], content: 'The Gannet Point lighthouse has been dark since the wreck of the Marigold.', comment: 'Lighthouse' },
        { keys: [], constant: true, content: 'It rains on four days out of five in Saltmarsh.' },
      ],
    })
    expect(r.isError).toBe(false)
    worldId = r.data().id
    expect(r.data()).toMatchObject({ created: true, name: 'Saltmarsh', template: 'freeform', lore_entries: 2 })
  })

  it('rejects lore that could never fire', async () => {
    const r = await tool('add_lore_entries', { owner: 'world', id: worldId, entries: [{ content: 'orphaned fact' }] })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/needs "keys".*constant/)
  })

  it('creates a character living in that world, with embedded lore', async () => {
    const r = await tool('create_character', {
      name: 'Maren Voss',
      description: 'Lighthouse keeper in her fifties, weathered, quick to laugh.',
      personality: 'Dry humour, stubborn, fiercely protective of the town.',
      scenario: 'The beacon has failed again and she is hauling oil up the stairs.',
      first_mes: '*Maren wipes soot from her hands.* "You picked a bad night to visit."',
      tags: ['historical', 'slice-of-life'],
      world_id: worldId,
      occupation: 'Lighthouse keeper',
      likes: ['strong tea', 'storms'],
      lore_entries: [{ keys: ['marigold'], content: 'Maren lost her brother when the Marigold went down.' }],
    })
    expect(r.isError).toBe(false)
    characterId = r.data().id
    expect(r.data()).toMatchObject({ name: 'Maren Voss', world_id: worldId, lore_entries: 1, occupation: 'Lighthouse keeper', likes: ['strong tea', 'storms'] })
  })

  it('requires the essentials and a real world', async () => {
    const missing = await tool('create_character', { name: 'Nobody', description: 'x' })
    expect(missing.isError).toBe(true)
    expect(missing.text).toMatch(/first_mes/)
    const badWorld = await tool('create_character', { name: 'Nobody', description: 'x', first_mes: 'hi', world_id: 'nope' })
    expect(badWorld.isError).toBe(true)
    expect(badWorld.text).toMatch(/No world/)
  })

  it('reads back and edits only what was passed', async () => {
    const got = await tool('get_character', { id: characterId })
    expect(got.data().first_mes).toMatch(/bad night/)
    const edit = await tool('update_character', { id: characterId, personality: 'Dry humour, secretly sentimental.', tags: ['historical'], reply_format: 'texting' })
    expect(edit.data()).toMatchObject({ updated: true, personality: 'Dry humour, secretly sentimental.', tags: ['historical'], reply_format: 'texting', occupation: 'Lighthouse keeper' })
    expect(edit.data().description).toMatch(/Lighthouse keeper in her fifties/)
    const back = await tool('update_character', { id: characterId, reply_format: 'roleplay' })
    expect(back.data().reply_format).toBeUndefined()
  })

  it('lists and filters characters and worlds', async () => {
    expect((await tool('list_characters', { query: 'maren' })).data()).toHaveLength(1)
    expect((await tool('list_characters', { tag: 'nonexistent' })).data()).toHaveLength(0)
    expect((await tool('list_characters', { world_id: worldId })).data()).toHaveLength(1)
    const w = await tool('get_world', { id: worldId })
    expect(w.data().characters).toEqual([{ id: characterId, name: 'Maren Voss' }])
  })

  it('manages lorebook entries on a world', async () => {
    const added = await tool('add_lore_entries', {
      owner: 'world',
      id: worldId,
      entries: [{ keys: ['fog horn'], content: 'The fog horn sounds twice an hour while the fog is thick.', position: 'after_char', probability: 80 }],
    })
    expect(added.data()).toMatchObject({ added: 1, total: 3 })
    const newId = added.data().entry_ids[0]
    expect(newId).toBe(2)

    const read = await tool('get_lorebook', { owner: 'world', id: worldId, query: 'horn' })
    expect(read.data().entries).toHaveLength(1)
    expect(read.data().entries[0]).toMatchObject({ id: newId, position: 'after_char', probability: 80 })

    const edited = await tool('update_lore_entry', { owner: 'world', id: worldId, entry_id: newId, changes: { content: 'The fog horn sounds every ten minutes.', keys: ['fog horn', 'horn'] } })
    expect(edited.data().entry).toMatchObject({ content: 'The fog horn sounds every ten minutes.', keys: ['fog horn', 'horn'] })

    const makeConstant = await tool('update_lore_entry', { owner: 'world', id: worldId, entry_id: newId, changes: { constant: true } })
    expect(makeConstant.data().entry.constant).toBe(true)

    const bad = await tool('update_lore_entry', { owner: 'world', id: worldId, entry_id: 99, changes: { content: 'x' } })
    expect(bad.isError).toBe(true)

    const removed = await tool('remove_lore_entries', { owner: 'world', id: worldId, entry_ids: [newId] })
    expect(removed.data()).toEqual({ removed: 1, remaining: 2 })
    expect((await tool('remove_lore_entries', { owner: 'world', id: worldId, entry_ids: [999] })).isError).toBe(true)
  })

  it('manages a character\'s own lorebook and standalone books', async () => {
    const own = await tool('get_lorebook', { owner: 'character', id: characterId })
    expect(own.data().entries).toHaveLength(1)
    await tool('add_lore_entries', { owner: 'character', id: characterId, entries: [{ keys: ['tea'], content: 'She drinks tea black, never sweetened.' }] })
    expect((await tool('get_lorebook', { owner: 'character', id: characterId })).data().total).toBe(2)

    const book = await tool('create_lorebook', { name: 'Marsh wildlife', entries: [{ keys: ['gannet'], content: 'Gannets nest on the point in spring.' }], world_ids: [worldId] })
    expect(book.data()).toMatchObject({ created: true, entries: 1 })
    const listed = (await tool('list_lorebooks')).data()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ name: 'Marsh wildlife', entries: 1, bound_world_ids: [worldId] })
    await tool('add_lore_entries', { owner: 'book', id: book.data().id, entries: [{ keys: ['eel'], content: 'Eels are smoked in the autumn.' }] })
    expect((await tool('get_lorebook', { owner: 'book', id: book.data().id })).data().total).toBe(2)
    expect((await tool('get_lorebook', { owner: 'shelf', id: 'x' })).isError).toBe(true)
  })

  it('searches across characters, worlds and lore', async () => {
    const r = await tool('search_library', { query: 'marigold' })
    const kinds = r.data().results.map((x: { kind: string; id: string }) => `${x.kind}`)
    expect(kinds).toContain('lore_entry')
    expect(r.data().count).toBeGreaterThanOrEqual(2)
    expect((await tool('search_library', { query: 'zzz-not-here' })).data().count).toBe(0)
    expect((await tool('search_library', { query: 'lighthouse keeper' })).data().results.some((x: { kind: string }) => x.kind === 'character')).toBe(true)
  })

  it('manages personas', async () => {
    const made = await tool('create_persona', { name: 'Wren', description: 'A travelling surveyor.' })
    expect(made.isError).toBe(false)
    await tool('update_persona', { id: made.data().id, description: 'A travelling cartographer.' })
    expect((await tool('list_personas')).data()).toEqual([{ id: made.data().id, name: 'Wren', description: 'A travelling cartographer.' }])
  })

  it('reads and writes chats', async () => {
    const persona = (await tool('list_personas')).data()[0]
    const chat = await api('POST', '/api/chats', { characterId, personaId: persona.id, title: 'Night at the lighthouse' })
    chatId = chat.id
    await tool('append_message', { chat_id: chatId, text: '*A knock at the door.*', as: 'user' })
    await tool('append_message', { chat_id: chatId, text: 'Come in, then, before the wind takes the door.' })

    const read = (await tool('read_chat', { chat_id: chatId })).data()
    expect(read.total_messages).toBe(2)
    expect(read.messages.map((m: { role: string; name: string }) => `${m.role}:${m.name}`)).toEqual(['user:Wren', 'character:Maren Voss'])

    const page = (await tool('read_chat', { chat_id: chatId, limit: 1 })).data()
    expect(page.messages).toHaveLength(1)
    expect(page.messages[0].text).toMatch(/Come in/)
    const older = (await tool('read_chat', { chat_id: chatId, limit: 1, skip_recent: 1 })).data()
    expect(older.messages[0].text).toMatch(/knock/)

    expect((await tool('list_chats', { character_id: characterId })).data()[0]).toMatchObject({ id: chatId, character: 'Maren Voss' })
    expect((await tool('search_messages', { query: 'wind takes' })).data()[0]).toMatchObject({ chat_id: chatId })
  })

  it('remembers facts and reports relationship state', async () => {
    const fact = await tool('remember_fact', { chat_id: chatId, text: 'Wren is mapping the coast for the Admiralty.', importance: 0.9 })
    expect(fact.data().remembered).toBe(true)
    const facts = (await tool('list_facts', { chat_id: chatId })).data()
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ active: true, importance: 0.9 })
    expect((await tool('get_relationship', { chat_id: chatId })).data()).toMatchObject({ affection: 0, stage: 'near_strangers', commitment: 'none' })
    expect((await tool('read_chat', { chat_id: 'missing' })).isError).toBe(true)
  })

  it('exposes entities as resources', async () => {
    const c = await rpc('resources/read', { uri: `rp://character/${characterId}` })
    expect(JSON.parse(c.body.result.contents[0].text).name).toBe('Maren Voss')
    const w = await rpc('resources/read', { uri: `rp://world/${worldId}` })
    expect(JSON.parse(w.body.result.contents[0].text).lorebook).toHaveLength(2)
    expect((await rpc('resources/read', { uri: 'rp://character/missing' })).body.error.code).toBe(-32602)
  })

  it('never offers deletion of characters, worlds or chats', async () => {
    const names = (await rpc('tools/list')).body.result.tools.map((t: { name: string }) => t.name)
    expect(names.filter((n: string) => /^(delete|remove)_(character|world|chat|persona|lorebook)$/.test(n))).toEqual([])
  })
})

describe('extension tools', () => {
  it('scaffolds, installs switched off, and lints', async () => {
    const scaffold = await tool('scaffold_extension', { kind: 'panel', id: 'agent-panel', name: 'Agent Panel' })
    const bundle = scaffold.data()
    expect(bundle.manifest.id).toBe('agent-panel')

    const made = await tool('create_extension', { manifest: bundle.manifest, files: bundle.files })
    expect(made.isError).toBe(false)
    expect(made.data()).toMatchObject({ installed: true, created: true, id: 'agent-panel' })
    expect(made.data().note).toMatch(/switched off/i)
    const rec = ext.getExtension('agent-panel')!
    expect(rec).toMatchObject({ enabled: false, grants: [], source: 'agent' })
    expect((await tool('lint_extension', { id: 'agent-panel' })).data().ok).toBe(true)
    expect((await tool('list_extensions')).data()[0]).toMatchObject({ id: 'agent-panel', enabled: false, source: 'agent' })
  })

  it('reports validation problems with details', async () => {
    const r = await tool('create_extension', { manifest: { id: 'x', name: 'Bad' }, files: {} })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/Invalid extension bundle/)
    expect(r.text.split('\n').length).toBeGreaterThan(2)
  })

  it('catches mistakes the sandbox would reject', async () => {
    const w = await tool('write_extension_file', { id: 'agent-panel', path: 'panel.html', content: '<script>localStorage.setItem("a", 1); rp.chat.messages()</script>' })
    expect(w.isError).toBe(false)
    const lint = (await tool('lint_extension', { id: 'agent-panel' })).data()
    expect(lint.ok).toBe(false)
    expect(JSON.stringify(lint.findings)).toMatch(/Browser storage is blocked/)
    expect(JSON.stringify(lint.findings)).toMatch(/chat\.read/)
  })

  it('switches an enabled extension off and resets its grants when an agent changes it', async () => {
    ext.updateExtension('agent-panel', { enabled: true, grants: [] })
    expect(ext.getExtension('agent-panel')!.enabled).toBe(true)
    const w = await tool('write_extension_file', { id: 'agent-panel', path: 'extra.js', content: '// hello' })
    expect(w.data().note).toMatch(/switched off/i)
    expect(ext.getExtension('agent-panel')).toMatchObject({ enabled: false, grants: [] })
  })

  it('reads files, refuses unsafe paths, and protects referenced files', async () => {
    expect((await tool('read_extension_file', { id: 'agent-panel', path: 'extra.js' })).text).toBe('// hello')
    expect((await tool('write_extension_file', { id: 'agent-panel', path: '../escape.js', content: 'x' })).isError).toBe(true)
    expect((await tool('delete_extension_file', { id: 'agent-panel', path: 'panel.html' })).text).toMatch(/referenced by the manifest/)
    expect((await tool('delete_extension_file', { id: 'agent-panel', path: 'extra.js' })).data().deleted).toBe('extra.js')
  })

  it('updates the manifest only when every referenced file exists', async () => {
    const info = (await tool('get_extension', { id: 'agent-panel' })).data()
    const broken = { ...info.manifest, panels: [{ ...info.manifest.panels[0], entry: 'missing.html' }] }
    const bad = await tool('update_extension_manifest', { id: 'agent-panel', manifest: broken })
    expect(bad.isError).toBe(true)
    expect(bad.text).toMatch(/missing file: missing\.html/)
    const ok = await tool('update_extension_manifest', { id: 'agent-panel', manifest: { ...info.manifest, description: 'Updated by an agent' } })
    expect(ok.data().updated).toBe(true)
  })

  it('serves the developer guide as a tool', async () => {
    expect((await tool('get_extension_guide')).text).toMatch(/^# Building extensions for /)
  })
})

describe('read-only mode', () => {
  it('blocks every write tool but keeps reads working', async () => {
    await api('PUT', '/api/mcp/settings', { readOnly: true })
    try {
      const attempts: [string, Record<string, unknown>][] = [
        ['create_character', { name: 'X', description: 'x', first_mes: 'x' }],
        ['create_world', { name: 'X', description: 'x' }],
        ['create_persona', { name: 'X' }],
        ['create_extension', { manifest: {}, files: {} }],
        ['write_extension_file', { id: 'agent-panel', path: 'a.js', content: 'x' }],
        ['remember_fact', { chat_id: 'x', text: 'x' }],
      ]
      for (const [name, args] of attempts) {
        const r = await tool(name, args)
        expect(r.isError, name).toBe(true)
        expect(r.text, name).toMatch(/read-only/)
      }
      expect((await tool('list_characters')).isError).toBe(false)
      expect((await tool('get_overview')).isError).toBe(false)
    } finally {
      await api('PUT', '/api/mcp/settings', { readOnly: false })
    }
    expect((await tool('create_persona', { name: 'Allowed again' })).isError).toBe(false)
  })
})

describe('dedicated listener', () => {
  it('serves only /mcp, so a tunnel never exposes the API', async () => {
    const listener = mcp.startMcpListener({ host: '127.0.0.1', port: 0, apiBase: base })
    await once(listener, 'listening')
    const origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`
    try {
      const ok = await rpc('tools/call', { name: 'list_characters', arguments: {} }, {}, `${origin}/mcp`)
      expect(ok.status).toBe(200)
      expect(JSON.parse(ok.body.result.content[0].text)).toHaveLength(1)
      expect((await fetch(`${origin}/api/characters`)).status).toBe(404)
      expect((await fetch(`${origin}/api/mcp/settings`)).status).toBe(404)
      expect((await post(`${origin}/mcp`, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
      const viaPath = await post(`${origin}/mcp/${token}`, { jsonrpc: '2.0', id: 1, method: 'ping' })
      expect(viaPath.status).toBe(200)
    } finally {
      await new Promise((resolve) => listener.close(resolve))
    }
  })
})
