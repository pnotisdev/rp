/**
 * Cross-site guard for the API (no auth otherwise — see README threat model: local-only).
 * Allows any loopback origin (any port), rejects any other Origin, and passes requests
 * with no Origin at all (curl, same-origin requests that omit it).
 */

import type { RequestHandler } from 'express'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Extra origins to accept beyond loopback, for a deployment reached over a network — Docker on a
 * home server, a reverse proxy, another device on the LAN. Set `RP_ALLOWED_ORIGINS` to a
 * comma-separated list (`http://192.168.1.9:8080,https://rp.example.com`); a single `*` turns the
 * check off entirely, which only makes sense when something in front is doing auth. Read fresh
 * each call so tests (and a restart-free env change) take effect.
 */
function extraAllowedOrigins(): string[] {
  return (process.env.RP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true
  const extra = extraAllowedOrigins()
  if (extra.includes('*')) return true
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (LOOPBACK_HOSTS.has(url.hostname)) return true
  return extra.includes(url.origin)
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** Express middleware wrapping originAllowed; falls back to Referer only when Origin is absent. */
export const originGuard: RequestHandler = (req, res, next) => {
  const origin = headerValue(req.headers.origin)
  if (!originAllowed(origin)) {
    res.status(403).json({ error: 'Forbidden origin' })
    return
  }
  const referer = headerValue(req.headers.referer)
  if (!origin && referer) {
    try {
      if (!originAllowed(new URL(referer).origin)) {
        res.status(403).json({ error: 'Forbidden origin' })
        return
      }
    } catch {
      // Malformed Referer — ignore.
    }
  }
  next()
}
