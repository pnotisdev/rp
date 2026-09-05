/**
 * The API's cross-site guard. Section 9's audit finding: this API had no Origin/Referer check at
 * all. A browser's CORS preflight already blocks a cross-site PUT/DELETE or a JSON POST (the shapes
 * every real mutation here uses), but a "simple" request — no custom headers, `Content-Type:
 * text/plain`, no body needed — reaches an action-only endpoint blind from *any other site or tab
 * open in the same browser*, no preflight involved. This app has no auth to fall back on (see the
 * README's threat model: local-only, must never be reachable off this machine), so Origin is the
 * only signal available.
 *
 * The job of this check is precisely to reject a request whose Origin is *another website*
 * (`https://evil.example`) — the browser sets Origin truthfully, so a remote page cannot forge a
 * loopback origin. It was never meant to pin the client to one exact port. The dev server is not
 * always on 5173: a second instance, or a sandboxed preview that had to pick a free port, serves
 * the same app from `http://localhost:<something-else>`, and the old code (allowlist derived from
 * `PORT`) answered every one of those requests with 403 — an app showing "none of your data", the
 * exact failure `vite.config.ts`'s own comment warns a port collision would cause.
 *
 * So: any loopback origin passes (all on-machine, which is the whole of the README's threat model),
 * and a present Origin that resolves to any other host is rejected. A missing Origin still passes —
 * curl, this project's own live-verification passes, and same-origin request shapes that omit it
 * are all legitimate, and a cross-site attacker's browser will always attach one.
 */

import type { RequestHandler } from 'express'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Kept free of `express` (type-only import above) so it's unit-testable without standing up the app. */
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

/**
 * The Express middleware. Referer is consulted only when Origin itself is missing — a fallback for
 * the rare request shape that sends Referer but not Origin, not a second check layered on a passing
 * Origin. A malformed Referer is ignored rather than blocked, the same leniency "no signal at all"
 * already gets.
 */
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
