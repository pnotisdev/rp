/**
 * Cross-site guard for the API (no auth otherwise — see README threat model: local-only).
 * Allows any loopback origin (any port), rejects any other Origin, and passes requests
 * with no Origin at all (curl, same-origin requests that omit it).
 */

import type { RequestHandler } from 'express'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true
  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    return false
  }
  return LOOPBACK_HOSTS.has(hostname)
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
