import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

type Ext = typeof import('./extensions.ts')
let ext: Ext
let tmp: string
let server: Server
let base: string

function bundle(overrides: Record<string, unknown> = {}, files: Record<string, unknown> = { 'panel.html': '<p>hi</p>' }) {
  return {
    format: 'rp-extension',
    version: 1,
    manifest: {
      id: 'dice-tray',
      name: 'Dice Tray',
      version: '1.0.0',
      permissions: ['chat.read'],
      panels: [{ id: 'tray', title: 'Dice', entry: 'panel.html', slots: ['chat'] }],
      ...overrides,
    },
    files,
  }
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-ext-test-'))
  process.env.RP_DATA_DIR = tmp
  ext = await import('./extensions.ts')
  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  app.use('/api/extensions', ext.extensionsRouter())
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/extensions`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  const { db } = await import('./db.ts')
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('install + records', () => {
  it('installs disabled with nothing granted, then lists it', () => {
    const r = ext.installBundle(bundle(), 'example')
    expect(r.created).toBe(true)
    expect(r.record).toMatchObject({ id: 'dice-tray', enabled: false, grants: [], source: 'example', fileCount: 1 })
    expect(ext.listExtensions().map((e) => e.id)).toContain('dice-tray')
    expect(Object.keys(ext.readBundle('dice-tray')!.files)).toEqual(['panel.html'])
  })

  it('rejects an invalid bundle with details', () => {
    expect(() => ext.installBundle(bundle({}, {}))).toThrow(/Invalid extension bundle/)
    try {
      ext.installBundle(bundle({}, {}))
    } catch (e) {
      expect((e as { details: string[] }).details.join()).toMatch(/panel\.html/)
    }
  })

  it('grants only what the manifest requests', () => {
    expect(ext.updateExtension('dice-tray', { enabled: true, grants: ['chat.read'] })).toMatchObject({ enabled: true, grants: ['chat.read'] })
    expect(() => ext.updateExtension('dice-tray', { grants: ['generate'] })).toThrow(/does not request/)
    expect(() => ext.updateExtension('dice-tray', { grants: ['bogus'] })).toThrow(/known permissions/)
    expect(() => ext.updateExtension('nope-nope', { enabled: true })).toThrow(/No extension/)
  })

  it('re-installing keeps enabled state, trims stale grants and reports new permissions', () => {
    const r = ext.installBundle(bundle({ permissions: ['chat.write'] }))
    expect(r.created).toBe(false)
    expect(r.record.enabled).toBe(true)
    expect(r.record.grants).toEqual([])
    expect(r.newPermissions).toEqual(['chat.write'])
    ext.installBundle(bundle({ permissions: ['chat.read'] }))
  })
})

describe('rev and settings', () => {
  const withSettings = () =>
    bundle({
      settings: [
        { key: 'sides', type: 'number', label: 'Sides', default: 20 },
        { key: 'mode', type: 'select', label: 'Mode', options: ['a', 'b'] },
      ],
    })

  it('bumps rev on code changes only, never on toggles or settings', () => {
    const base = ext.installBundle(withSettings())
    const rev = base.record.rev
    expect(rev).toBeGreaterThanOrEqual(1)
    expect(ext.updateExtension('dice-tray', { enabled: false }).rev).toBe(rev)
    expect(ext.updateExtension('dice-tray', { settings: { sides: 6 } }).rev).toBe(rev)
    expect(ext.writeFile('dice-tray', 'x.js', '1').rev).toBe(rev + 1)
    expect(ext.deleteFile('dice-tray', 'x.js').rev).toBe(rev + 2)
    expect(ext.installBundle(withSettings()).record.rev).toBe(rev + 3)
  })

  it('keeps only valid declared settings and prunes removed ones on update', () => {
    ext.updateExtension('dice-tray', { settings: { sides: 12, mode: 'b', bogus: 1 } })
    expect(ext.getExtension('dice-tray')!.settings).toEqual({ sides: 12, mode: 'b' })
    ext.updateExtension('dice-tray', { settings: { sides: 'many', mode: 'zzz' } })
    expect(ext.getExtension('dice-tray')!.settings).toEqual({ sides: 12, mode: 'b' })
    const slim = bundle({ settings: [{ key: 'sides', type: 'number', label: 'Sides' }] })
    ext.installBundle(slim)
    expect(ext.getExtension('dice-tray')!.settings).toEqual({ sides: 12 })
    ext.installBundle(bundle())
    expect(ext.getExtension('dice-tray')!.settings).toEqual({})
  })
})

describe('files and manifest', () => {
  it('writes, overwrites and deletes files', () => {
    ext.writeFile('dice-tray', 'extra.js', 'console.log(1)')
    ext.writeFile('dice-tray', 'extra.js', 'console.log(2)')
    expect(ext.readFile('dice-tray', 'extra.js').content).toBe('console.log(2)')
    expect(ext.listFiles('dice-tray').map((f) => f.path).sort()).toEqual(['extra.js', 'panel.html'])
    expect(() => ext.deleteFile('dice-tray', 'panel.html')).toThrow(/referenced by the manifest/)
    expect(ext.deleteFile('dice-tray', 'extra.js').fileCount).toBe(1)
  })

  it('rejects unsafe paths, manifest.json and text sent as base64', () => {
    expect(() => ext.writeFile('dice-tray', '../x.js', 'x')).toThrow(/safe relative path/)
    expect(() => ext.writeFile('dice-tray', 'manifest.json', '{}')).toThrow(/PUT \/manifest/)
    expect(() => ext.writeFile('dice-tray', 'a.js', undefined, 'AAAA')).toThrow(/Text files/)
    ext.writeFile('dice-tray', 'logo.png', undefined, 'iVBORw0KGgo=')
    expect(ext.readFile('dice-tray', 'logo.png')).toMatchObject({ encoding: 'base64' })
  })

  it('validates a replacement manifest against existing files', () => {
    const m = bundle().manifest
    expect(() => ext.setManifest('dice-tray', { ...m, script: 'main.js' })).toThrow(/references files that do not exist/)
    expect(() => ext.setManifest('dice-tray', { ...m, id: 'other-one' })).toThrow(/must stay/)
    ext.writeFile('dice-tray', 'main.js', 'rp.log("x")')
    expect(ext.setManifest('dice-tray', { ...m, script: 'main.js' }).manifest.script).toBe('main.js')
  })

  it('lints an installed extension', () => {
    ext.writeFile('dice-tray', 'panel.html', '<script>rp.chat.append("x")</script>')
    expect(ext.lintExtension('dice-tray').some((f) => /chat\.write/.test(f.message))).toBe(true)
  })
})

describe('scoped key-value data', () => {
  it('stores values per scope and owner', () => {
    ext.kvSet('dice-tray', 'global', undefined, 'volume', 0.5)
    ext.kvSet('dice-tray', 'chat', 'chat-1', 'rolls', [1, 2, 3])
    ext.kvSet('dice-tray', 'chat', 'chat-2', 'rolls', [9])
    expect(ext.kvList('dice-tray', 'global', undefined)).toEqual({ volume: 0.5 })
    expect(ext.kvList('dice-tray', 'chat', 'chat-1')).toEqual({ rolls: [1, 2, 3] })
    ext.kvSet('dice-tray', 'chat', 'chat-1', 'rolls', [4])
    expect(ext.kvList('dice-tray', 'chat', 'chat-1')).toEqual({ rolls: [4] })
    ext.kvRemove('dice-tray', 'chat', 'chat-2', 'rolls')
    expect(ext.kvList('dice-tray', 'chat', 'chat-2')).toEqual({})
  })

  it('validates scope, key and size', () => {
    expect(() => ext.kvSet('dice-tray', 'planet', 'x', 'k', 1)).toThrow(/scope/)
    expect(() => ext.kvSet('dice-tray', 'chat', undefined, 'k', 1)).toThrow(/scopeId/)
    expect(() => ext.kvSet('dice-tray', 'global', undefined, '', 1)).toThrow(/key/)
    expect(() => ext.kvSet('dice-tray', 'global', undefined, 'big', 'x'.repeat(300_000))).toThrow(/at most/)
  })

  it('purges and clones data by scope owner', () => {
    ext.cloneScopeData('chat', 'chat-1', 'chat-fork')
    expect(ext.kvList('dice-tray', 'chat', 'chat-fork')).toEqual({ rolls: [4] })
    ext.purgeScopeData('chat', 'chat-1')
    expect(ext.kvList('dice-tray', 'chat', 'chat-1')).toEqual({})
    expect(ext.kvList('dice-tray', 'chat', 'chat-fork')).toEqual({ rolls: [4] })
    expect(ext.kvList('dice-tray', 'global', undefined)).toEqual({ volume: 0.5 })
  })
})

describe('http router', () => {
  it('serves validate before :id and maps errors to status codes', async () => {
    const ok = await fetch(`${base}/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bundle()) })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { ok: boolean }).ok).toBe(true)

    const bad = await fetch(`${base}/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'BAD' }) })
    expect(((await bad.json()) as { ok: boolean }).ok).toBe(false)

    expect((await fetch(`${base}/not-installed`)).status).toBe(404)
    expect((await fetch(`${base}/Bad_Id`)).status).toBe(404)
  })

  it('installs over http (201 then 200) and round-trips files, data and delete', async () => {
    const post = (b: unknown) => fetch(`${base}/install?source=agent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
    const first = await post(bundle({ id: 'http-demo', name: 'Http Demo' }))
    expect(first.status).toBe(201)
    expect(((await first.json()) as { record: { source: string } }).record.source).toBe('agent')
    expect((await post(bundle({ id: 'http-demo', name: 'Http Demo' }))).status).toBe(200)
    expect((await post(bundle({ id: 'http-demo' }, {}))).status).toBe(400)

    const put = await fetch(`${base}/http-demo/file`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'a.js', content: 'x' }) })
    expect(put.status).toBe(200)
    const got = await fetch(`${base}/http-demo/file?path=a.js`)
    expect(((await got.json()) as { content: string }).content).toBe('x')

    const kv = await fetch(`${base}/http-demo/data`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'global', key: 'a', value: { n: 1 } }) })
    expect(kv.status).toBe(204)
    expect(await (await fetch(`${base}/http-demo/data?scope=global`)).json()).toEqual({ a: { n: 1 } })

    expect((await fetch(`${base}/http-demo`, { method: 'DELETE' })).status).toBe(204)
    expect((await fetch(`${base}/http-demo`)).status).toBe(404)
    expect(() => ext.kvList('http-demo', 'global', undefined)).toThrow(/No extension/)
  })

  it('removing an extension deletes its files and data', () => {
    ext.removeExtension('dice-tray')
    expect(ext.getExtension('dice-tray')).toBeUndefined()
    ext.installBundle(bundle())
    expect(ext.listFiles('dice-tray').length).toBe(1)
    expect(ext.kvList('dice-tray', 'global', undefined)).toEqual({})
  })
})
