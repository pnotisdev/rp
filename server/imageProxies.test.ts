import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import express from 'express'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { comfyTarget, imageProxyRouter, novelaiTarget } from './imageProxies.ts'

let proxy: Server
let fake: Server
let proxyBase: string
let fakeBase: string
const seen: { method: string; url: string; body?: unknown }[] = []
const PNG = Buffer.from('89504e470d0a1a0a0102030405', 'hex')

beforeAll(async () => {
  const comfy = express()
  comfy.use(express.json())
  comfy.post('/prompt', (req, res) => {
    seen.push({ method: 'POST', url: '/prompt', body: req.body })
    res.json({ prompt_id: 'abc' })
  })
  comfy.get('/history/:id', (req, res) => res.json({ [req.params.id]: { outputs: { '9': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } }))
  comfy.get('/view', (req, res) => {
    seen.push({ method: 'GET', url: req.originalUrl })
    res.type('image/png').send(PNG)
  })
  comfy.get('/object_info/KSampler', (_req, res) => res.status(404).json({ error: 'nope' }))
  fake = comfy.listen(0, '127.0.0.1')
  await once(fake, 'listening')
  fakeBase = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`

  const app = express()
  app.use(express.json())
  app.use(imageProxyRouter())
  proxy = app.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  proxyBase = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((r) => proxy.close(r))
  await new Promise((r) => fake.close(r))
})

const viaProxy = (path: string, init?: RequestInit) => fetch(`${proxyBase}/api/comfy/proxy?base=${encodeURIComponent(fakeBase)}&path=${encodeURIComponent(path)}`, init)

describe('comfy proxy', () => {
  it('relays a queued prompt with its JSON body', async () => {
    const res = await viaProxy('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: { '1': { class_type: 'X', inputs: {} } } }) })
    expect(await res.json()).toEqual({ prompt_id: 'abc' })
    expect(seen[0].body).toEqual({ prompt: { '1': { class_type: 'X', inputs: {} } } })
  })

  it('relays history, binary images with their query string, and upstream errors', async () => {
    expect(((await (await viaProxy('/history/abc')).json()) as any).abc.outputs['9'].images[0].filename).toBe('a.png')
    const view = await viaProxy('/view?filename=a.png&subfolder=&type=output')
    expect(view.headers.get('content-type')).toContain('image/png')
    expect(Buffer.from(await view.arrayBuffer()).equals(PNG)).toBe(true)
    expect(seen.at(-1)?.url).toBe('/view?filename=a.png&subfolder=&type=output')
    expect((await viaProxy('/object_info/KSampler')).status).toBe(404)
  })

  it('refuses other paths, bad addresses and unreachable servers', async () => {
    expect((await viaProxy('/api/chats')).status).toBe(400)
    expect((await viaProxy('/prompt/../../etc')).status).toBe(400)
    expect((await fetch(`${proxyBase}/api/comfy/proxy?base=${encodeURIComponent('ftp://x')}&path=/prompt`)).status).toBe(400)
    const dead = await fetch(`${proxyBase}/api/comfy/proxy?base=${encodeURIComponent('http://127.0.0.1:1')}&path=/system_stats`)
    expect(dead.status).toBe(502)
  })
})

describe('target checks', () => {
  it('allows only the ComfyUI paths the app uses', () => {
    expect(comfyTarget('http://127.0.0.1:8188/', '/object_info/CheckpointLoaderSimple').toString()).toBe('http://127.0.0.1:8188/object_info/CheckpointLoaderSimple')
    expect(comfyTarget('http://host:8188', '/history/1-2').pathname).toBe('/history/1-2')
    for (const bad of ['/', '/api/chats', '/upload/image', '/view/../x', 'prompt']) expect(() => comfyTarget('http://host:8188', bad)).toThrow()
    expect(() => comfyTarget('javascript:alert(1)', '/prompt')).toThrow()
    expect(() => comfyTarget(undefined, '/prompt')).toThrow()
  })

  it('maps NovelAI hosts and rejects the rest', () => {
    expect(novelaiTarget('/image/ai/generate-image').toString()).toBe('https://image.novelai.net/ai/generate-image')
    expect(novelaiTarget('/text/ai/generate-stream').host).toBe('text.novelai.net')
    expect(novelaiTarget('/api/user/subscription').host).toBe('api.novelai.net')
    for (const bad of ['/evil/ai/generate', '/api/user/data', '/image/ai/other', '/image', '']) expect(() => novelaiTarget(bad)).toThrow()
  })
})
