import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

// Both the database and the workspace live inside the project's gitignored data-sandbox folder.
const tmp = path.resolve('data-sandbox', `agent-ws-test-${process.pid}`)
const workspace = path.join(tmp, 'workspace')
let server: Server
let base: string

const json = async (method: string, route: string, body?: unknown) => {
  const res = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as any) }
}
const call = async (name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  (await json('POST', '/api/agent/call', { name, arguments: args, ...extra })).body as { text: string; isError: boolean; images?: string[] }

beforeAll(async () => {
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, 'notes.txt'), 'alpha\nbeta\n')
  fs.writeFileSync(path.join(workspace, 'pic.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
  process.env.RP_DATA_DIR = path.join(tmp, 'data')
  const { app } = await import('./app.ts')
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 60_000)

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  ;(await import('./db.ts')).db.close()
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
})

describe('agent workspace', () => {
  it('offers no file tools until a folder is chosen', async () => {
    const names = ((await json('GET', '/api/agent/tools')).body as { name: string }[]).map((t) => t.name)
    expect(names).not.toContain('read_file')
    expect(names).toContain('fetch_url')
    expect(names).toContain('remember')
    expect((await call('read_file', { path: 'notes.txt' })).isError).toBe(true)
  })

  it('validates the folder', async () => {
    expect((await json('PUT', '/api/agent/workspace', { root: path.join(tmp, 'nope') })).status).toBe(400)
    const inData = await json('PUT', '/api/agent/workspace', { root: path.join(tmp, 'data') })
    expect(inData.status).toBe(400)
    expect(inData.body.error).toContain('own data')
    const ok = await json('PUT', '/api/agent/workspace', { root: workspace, allowCommands: false })
    expect(ok.status).toBe(200)
    expect(ok.body.allowCommands).toBe(false)
    expect((await json('GET', '/api/agent/workspace')).body.root).toBe(fs.realpathSync.native(workspace))
  })

  it('reads, and marks which tools need approval', async () => {
    const tools = (await json('GET', '/api/agent/tools')).body as { name: string; write: boolean; confirm: boolean }[]
    expect(tools.find((t) => t.name === 'read_file')).toMatchObject({ write: false, confirm: false })
    expect(tools.find((t) => t.name === 'edit_file')).toMatchObject({ write: true, confirm: true })
    expect(tools.some((t) => t.name === 'run_command')).toBe(false)
    expect((await call('read_file', { path: 'notes.txt' })).text).toContain('    2  beta')
    expect((await call('read_file', { path: '../escape.txt' })).text).toContain('outside the workspace')
  })

  it('refuses edits in read-only mode or without approval, and applies approved ones', async () => {
    const args = { path: 'notes.txt', old_text: 'beta', new_text: 'gamma' }
    expect((await call('edit_file', args, { allowWrites: false, confirmed: true })).text).toContain('read-only')
    expect((await call('edit_file', args, { allowWrites: true })).text).toContain('approval')
    expect(fs.readFileSync(path.join(workspace, 'notes.txt'), 'utf8')).toBe('alpha\nbeta\n')
    expect((await call('edit_file', args, { allowWrites: true, confirmed: true })).isError).toBe(false)
    expect(fs.readFileSync(path.join(workspace, 'notes.txt'), 'utf8')).toBe('alpha\ngamma\n')
  })

  it('checks tool arguments', async () => {
    expect((await call('read_file', {})).text).toContain('Invalid arguments')
  })

  it('passes images through for vision', async () => {
    const out = await call('view_image', { path: 'pic.png' })
    expect(out.images?.[0]).toMatch(/^data:image\/png;base64,/)
  })

  it('saves a generated picture only with permission, to a new image file', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')}`
    const save = async (body: Record<string, unknown>) => (await json('POST', '/api/agent/save-image', body)).body as { text: string; isError: boolean }
    expect((await save({ path: 'art/a.png', dataUrl, allowWrites: false, confirmed: true })).text).toContain('read-only')
    expect((await save({ path: 'art/a.png', dataUrl, allowWrites: true })).text).toContain('approval')
    expect((await save({ path: 'art/a.txt', dataUrl, allowWrites: true, confirmed: true })).text).toContain('.png')
    expect((await save({ path: 'art/a.png', dataUrl: 'data:text/plain;base64,aGk=', allowWrites: true, confirmed: true })).text).toContain('not an image')
    expect((await save({ path: '../a.png', dataUrl, allowWrites: true, confirmed: true })).text).toContain('outside')
    expect((await save({ path: 'art/a.png', dataUrl, allowWrites: true, confirmed: true })).isError).toBe(false)
    expect(fs.readFileSync(path.join(workspace, 'art', 'a.png')).length).toBe(8)
    expect((await save({ path: 'art/a.png', dataUrl, allowWrites: true, confirmed: true })).text).toContain('already exists')
  })

  it('only runs commands when allowed', async () => {
    expect((await call('run_command', { command: 'node --version' }, { allowWrites: true, confirmed: true })).text).toContain('no tool')
    await json('PUT', '/api/agent/workspace', { root: workspace, allowCommands: true })
    const out = await call('run_command', { command: 'node --version' }, { allowWrites: true, confirmed: true })
    expect(out.text).toMatch(/Exit code 0/)
    await json('PUT', '/api/agent/workspace', { root: '' })
    expect((await json('GET', '/api/agent/workspace')).body).toEqual({ root: '', allowCommands: false })
  })

  it('keeps long-term notes, without duplicates', async () => {
    expect((await call('remember', { note: 'The user prefers metric units.' })).text).toContain('Remembered')
    await call('remember', { note: 'the user prefers metric units.' })
    const notes = (await json('GET', '/api/agent/memory')).body as { id: string; text: string }[]
    expect(notes).toHaveLength(1)
    expect((await call('recall', {})).text).toContain('metric units')
    expect((await json('DELETE', `/api/agent/memory/${notes[0].id}`)).status).toBe(204)
    expect((await json('GET', '/api/agent/memory')).body).toEqual([])
  })
})
