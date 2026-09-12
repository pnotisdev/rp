import express from 'express'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openMayhemRouter } from './openMayhem'
import { originGuard } from './originCheck'

let server: http.Server
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(async () => {
  const app = express()
  app.use(originGuard, express.json())
  app.use('/api/openmayhem', openMayhemRouter())
  server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
function call(path: string, method = 'GET', headers: Record<string, string> = {}, body?: unknown) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port,
      path: `/api/openmayhem${path}`, method, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let content = ''
      res.on('data', (data) => { content += data })
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: content }))
    })
    req.on('error', reject)
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}
describe('OpenMayhem local forwarding', () => {
  it('rejects another website and unlisted paths without contacting upstream', async () => {
    expect((await call('/models', 'GET', { Origin: 'https://attacker.test' })).status).toBe(403)
    expect((await call('/https://attacker.test')).status).toBe(404)
    expect((await call('/chat/completions', 'POST', {}, { model: 'm' })).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('fetches only the fixed public catalog without forwarding cookies or keys', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"data":[]}', { headers: { 'Content-Type': 'application/json' } }))
    const result = await call('/models?url=https://attacker.test', 'GET', { Authorization: 'Bearer secret', Cookie: 'session=secret' })
    expect(result.status).toBe(200)
    expect(result.headers['cache-control']).toBe('no-store')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openmayhem.ai/v1/models?endpoint_family=CHAT&limit=100')
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Accept: 'application/json' })
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error')
  })
  it('forwards streaming output, bearer credentials and bodies without cookies or retries', async () => {
    const stream = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n'
    fetchMock.mockResolvedValueOnce(new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Set-Cookie': 'secret=1', 'x-request-id': 'request-123' } }))
    const body = { model: 'example/chat', stream: true, messages: [{ role: 'user', content: 'Hi' }] }
    const result = await call('/chat/completions', 'POST', { Authorization: 'Bearer test-key', Cookie: 'other=secret', Origin: 'http://localhost:5173' }, body)
    expect(result.body).toBe(stream)
    expect(result.headers['x-request-id']).toBe('request-123')
    expect(result.headers['set-cookie']).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ body: JSON.stringify(body), headers: { Authorization: 'Bearer test-key' } })
    expect(fetchMock.mock.calls[0][1].headers.Cookie).toBeUndefined()
  })
  it('preserves upstream errors and Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"Rate limited"}}', { status: 429, headers: { 'Retry-After': '15' } }))
    const result = await call('/chat/completions', 'POST', { Authorization: 'Bearer test-key' }, {})
    expect(result.status).toBe(429)
    expect(result.headers['retry-after']).toBe('15')
    expect(result.body).toContain('Rate limited')
  })
  it('does not leak upstream exception details', async () => {
    fetchMock.mockRejectedValueOnce(new Error('private diagnostic'))
    const result = await call('/campaign')
    expect(result.status).toBe(502)
    expect(result.body).not.toContain('private diagnostic')
  })
  it('forwards validated modality and cursor queries without exposing credentials', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"data":[]}'))
    expect((await call('/models?endpoint_family=AUDIO_SPEECH&cursor=page%2F%2B2', 'GET', { Authorization: 'Bearer secret' })).status).toBe(200)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openmayhem.ai/v1/models?endpoint_family=AUDIO_SPEECH&limit=100&cursor=page%2F%2B2')
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Accept: 'application/json' })
    expect((await call('/models?endpoint_family=ANYTHING')).status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('requires authorization for job status, cancellation, artifacts and both generation endpoints', async () => {
    for (const [path, method] of [['/jobs/job_1', 'GET'], ['/jobs/job_1', 'DELETE'], ['/artifacts/a_1', 'GET'], ['/images/generations', 'POST'], ['/workflows', 'POST'], ['/audio/speech', 'POST']]) {
      expect((await call(path, method)).status).toBe(401)
      fetchMock.mockResolvedValueOnce(new Response('{}'))
      expect((await call(path, method, { Authorization: 'Bearer media-key' }, method === 'POST' ? { model: 'test' } : undefined)).status).toBe(200)
      expect(fetchMock.mock.lastCall?.[0]).toBe(`https://api.openmayhem.ai/v1${path}`)
      expect(fetchMock.mock.lastCall?.[1].headers.Authorization).toBe('Bearer media-key')
      if (method !== 'POST') {
        expect(fetchMock.mock.lastCall?.[1].headers['Content-Type']).toBeUndefined()
        expect(fetchMock.mock.lastCall?.[1].body).toBeUndefined()
      }
    }
  })
  it('loads workflow metadata through the public catalog without forwarding credentials', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"data":[]}'))
    expect((await call('/models?endpoint_family=WORKFLOWS', 'GET', { Authorization: 'Bearer private' })).status).toBe(200)
    expect(fetchMock.mock.lastCall?.[0]).toBe('https://api.openmayhem.ai/v1/models?endpoint_family=WORKFLOWS&limit=100')
    expect(fetchMock.mock.lastCall?.[1].headers).toEqual({ Accept: 'application/json' })
  })
  it('downloads a signed artifact redirect without forwarding the bearer or cookies', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://bucket.s3.amazonaws.com/signed-artifact?signature=abc' } }))
      .mockResolvedValueOnce(new Response('audio bytes', { headers: { 'Content-Type': 'audio/wav' } }))
    const result = await call('/artifacts/a_1', 'GET', { Authorization: 'Bearer media-key', Cookie: 'session=private' })
    expect(result.status).toBe(200)
    expect(result.body).toBe('audio bytes')
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual')
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ redirect: 'error', headers: { Accept: expect.any(String) } })
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBeUndefined()
    expect(fetchMock.mock.calls[1][1].headers.Cookie).toBeUndefined()
  })
  it('rejects insecure artifact redirects and invalid resource IDs', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'http://localhost/private' } }))
    expect((await call('/artifacts/a_1', 'GET', { Authorization: 'Bearer media-key' })).status).toBe(502)
    expect((await call('/jobs/not%20an%20id', 'DELETE', { Authorization: 'Bearer media-key' })).status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
