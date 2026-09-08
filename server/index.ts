import { app, purgeExpiredTrash } from './app.ts'
import { checkpointDb, dataDir } from './db.ts'
import { runSeedIfNeeded } from './seed.ts'

runSeedIfNeeded()
purgeExpiredTrash()

const port = Number(process.env.API_PORT) || 3001

// Loopback-only by default — this API has no auth and full read/write/delete access to every
// character/chat/world, so it must never be casually reachable from other devices. A container
// can't publish a port it can't reach, so Docker sets API_HOST=0.0.0.0 and leans on Docker's own
// port mapping (and whatever firewall / reverse-proxy auth you put in front) to control access.
const host = process.env.API_HOST || '127.0.0.1'

app.listen(port, host, () => {
  console.log(`[rp-server] listening on http://${host}:${port} — data stored in ${dataDir}`)
})

// On a clean exit (Ctrl+C, or the dev watcher restarting the process), fold the write-ahead log
// back into rp.db so the main file is complete on its own. WAL writes are already durable on
// disk either way; this just spares anyone who copies rp.db without its -wal sidecar. `db.exec`
// is synchronous and a signal handler runs between ticks, so nothing can be mid-write here.
let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  try {
    checkpointDb()
  } catch (e) {
    console.error('[rp-server] checkpoint on shutdown failed:', e)
  }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
