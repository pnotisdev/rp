import { Router } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const UPSTREAM = 'https://api.openmayhem.ai'

/** Fixed destinations only. Never persist keys, forward cookies, follow redirects, or retry inference. */
export function openMayhemRouter() {
  const router = Router()
  const routes = [
    ['get', '/models', '/v1/models?endpoint_family=CHAT&limit=100'],
    ['get', '/campaign', '/campaigns/featured'],
    ['post', '/chat/completions', '/v1/chat/completions'],
  ] as const
  for (const [method, localPath, remotePath] of routes) {
    router[method](localPath, async (req, res) => {
      const authorization = req.get('authorization')
      if (method === 'post' && !/^Bearer\s+\S+$/.test(authorization ?? '')) {
        res.status(401).json({ error: { message: 'Enter your OpenMayhem API key first.' } })
        return
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), method === 'post' ? 180000 : 10000)
      const close = () => controller.abort()
      res.on('close', close)
      try {
        const upstream = await fetch(`${UPSTREAM}${remotePath}`, {
          method: method.toUpperCase(),
          headers: method === 'post'
            ? { 'Content-Type': 'application/json', Authorization: authorization! }
            : { Accept: 'application/json' },
          ...(method === 'post' ? { body: JSON.stringify(req.body) } : {}),
          redirect: 'error',
          signal: controller.signal,
        })
        res.status(upstream.status)
        res.setHeader('Cache-Control', 'no-store')
        for (const name of ['content-type', 'retry-after', 'x-request-id', 'x-openmayhem-stream-mode']) {
          const value = upstream.headers.get(name)
          if (value) res.setHeader(name, value)
        }
        if (!upstream.body) { res.end(); return }
        res.flushHeaders()
        await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), res)
      } catch {
        if (!res.headersSent && !res.destroyed) {
          res.status(502).json({ error: { message: 'Could not reach OpenMayhem. Check your connection and try again.' } })
        } else if (!res.destroyed) res.destroy()
      } finally {
        clearTimeout(timer)
        res.off('close', close)
      }
    })
  }
  return router
}
