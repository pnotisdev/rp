import { Router } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const UPSTREAM = 'https://api.openmayhem.ai'

/** Fixed API destinations. Artifact redirects come only from that API and receive no credentials. */
export function openMayhemRouter() {
  const router = Router()
  const routes = [
    ['get', '/models', '/v1/models?endpoint_family=CHAT&limit=100'],
    ['get', '/campaign', '/campaigns/featured'],
    ['post', '/chat/completions', '/v1/chat/completions'],
    ['post', '/images/generations', '/v1/images/generations'],
    ['post', '/audio/speech', '/v1/audio/speech'],
    ['get', '/jobs/:id', '/v1/jobs/'],
    ['delete', '/jobs/:id', '/v1/jobs/'],
    ['get', '/artifacts/:id', '/v1/artifacts/'],
  ] as const
  for (const [method, localPath, remotePath] of routes) {
    router[method](localPath, async (req, res) => {
      const authorization = req.get('authorization')
      const isPublic = localPath === '/models' || localPath === '/campaign'
      let destination = `${UPSTREAM}${remotePath}`
      if (localPath === '/models') {
        const endpoint = req.query.endpoint_family ?? 'CHAT'
        const cursor = req.query.cursor
        if (!['CHAT', 'IMAGES', 'AUDIO_SPEECH'].includes(endpoint as string)
          || (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 4096))) {
          res.status(400).json({ error: { message: 'Invalid model catalog query.' } }); return
        }
        const query = new URLSearchParams({ endpoint_family: endpoint as string, limit: '100' })
        if (cursor) query.set('cursor', cursor as string)
        destination = `${UPSTREAM}/v1/models?${query}`
      }
      if (localPath.includes(':id')) {
        const id = (req.params as Record<string, string>).id
        if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) {
          res.status(400).json({ error: { message: 'Invalid OpenMayhem resource ID.' } }); return
        }
        destination += id
      }
      if (!isPublic && !/^Bearer\s+\S+$/.test(authorization ?? '')) {
        res.status(401).json({ error: { message: 'Enter your OpenMayhem API key first.' } })
        return
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), isPublic ? 10000 : 180000)
      const close = () => controller.abort()
      res.on('close', close)
      try {
        let upstream = await fetch(destination, {
          method: method.toUpperCase(),
          headers: !isPublic
            ? { ...(method === 'post' ? { 'Content-Type': 'application/json' } : { Accept: 'application/json' }), Authorization: authorization! }
            : { Accept: 'application/json' },
          ...(method === 'post' ? { body: JSON.stringify(req.body) } : {}),
          redirect: localPath === '/artifacts/:id' ? 'manual' : 'error',
          signal: controller.signal,
        })
        if (localPath === '/artifacts/:id' && [301, 302, 303, 307, 308].includes(upstream.status)) {
          const location = new URL(upstream.headers.get('location') || '', UPSTREAM)
          if (location.protocol !== 'https:' || location.username || location.password || location.origin === UPSTREAM) {
            throw new Error('Invalid artifact redirect')
          }
          await upstream.body?.cancel()
          upstream = await fetch(location, { redirect: 'error', signal: controller.signal, headers: { Accept: 'image/*, audio/*, application/octet-stream' } })
        }
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
