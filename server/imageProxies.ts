// Same-origin relays for image and text services that a browser cannot call directly (no CORS headers): a local ComfyUI, and NovelAI.

import { Router, type Request, type Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** ComfyUI paths the app uses. Nothing else is relayed. */
const COMFY_PATHS = /^\/(prompt|history(\/[\w-]+)?|view|object_info(\/\w+)?|system_stats|queue|interrupt|free)$/

export function comfyTarget(base: unknown, path: unknown): URL {
  if (typeof base !== 'string' || typeof path !== 'string') throw new Error('Missing base or path.')
  let root: URL
  try {
    root = new URL(base)
  } catch {
    throw new Error('The ComfyUI address is not a valid URL.')
  }
  if (root.protocol !== 'http:' && root.protocol !== 'https:') throw new Error('The ComfyUI address must start with http:// or https://.')
  const [pathname] = path.split('?')
  if (!COMFY_PATHS.test(pathname)) throw new Error('That ComfyUI path is not allowed.')
  const target = new URL(root.toString().replace(/\/+$/, '') + path)
  if (target.origin !== root.origin) throw new Error('The path points somewhere else.')
  return target
}

const NOVELAI_HOSTS: Record<string, string> = { image: 'https://image.novelai.net', text: 'https://text.novelai.net', api: 'https://api.novelai.net' }
const NOVELAI_PATHS = new Set(['/ai/generate-image', '/ai/generate', '/ai/generate-stream', '/user/subscription'])

/** `/image/ai/generate-image` becomes https://image.novelai.net/ai/generate-image. */
export function novelaiTarget(relative: string): URL {
  const m = /^\/(image|text|api)(\/[^?]*)(\?.*)?$/.exec(relative)
  if (!m || !NOVELAI_PATHS.has(m[2])) throw new Error('That NovelAI path is not allowed.')
  return new URL(NOVELAI_HOSTS[m[1]] + m[2] + (m[3] ?? ''))
}

async function relay(req: Request, res: Response, target: URL, headers: Record<string, string>, timeoutMs: number) {
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined && Object.keys(req.body ?? {}).length > 0
  let upstream: globalThis.Response
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: { ...headers, ...(hasBody ? { 'content-type': 'application/json' } : {}) },
      body: hasBody ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    res.status(502).json({ error: `Could not reach ${target.host}: ${e instanceof Error ? e.message : String(e)}` })
    return
  }
  res.status(upstream.status)
  const type = upstream.headers.get('content-type')
  if (type) res.set('content-type', type)
  if (!upstream.body) {
    res.end()
    return
  }
  try {
    await pipeline(Readable.fromWeb(upstream.body as never), res)
  } catch {
    // The client went away mid-stream; nothing more to send.
  }
}

export function imageProxyRouter(): Router {
  const router = Router()

  router.all('/api/comfy/proxy', async (req, res) => {
    let target: URL
    try {
      target = comfyTarget(req.query.base, req.query.path)
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) })
      return
    }
    await relay(req, res, target, {}, 300_000)
  })

  router.use('/api/novelai/proxy', async (req, res) => {
    let target: URL
    try {
      target = novelaiTarget(req.url)
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) })
      return
    }
    const authorization = req.get('authorization')
    await relay(req, res, target, authorization ? { authorization } : {}, 300_000)
  })

  return router
}
