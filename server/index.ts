import { app, purgeExpiredTrash } from './app.ts'
import { checkpointDb, dataDir } from './db.ts'
import { mcpPort, startMcpListener } from './mcp.ts'
import { runSeedIfNeeded } from './seed.ts'

runSeedIfNeeded()
purgeExpiredTrash()

const port = Number(process.env.API_PORT) || 3001

// Loopback-only by default — this API has no auth and full read/write/delete access to every character/chat/world
const host = process.env.API_HOST || '127.0.0.1'

app.listen(port, host, () => {
  console.log(`[rp-server] listening on http://${host}:${port} — data stored in ${dataDir}`)
})

// Agent access (MCP) also gets its own loopback port, so a tunnel can expose it without exposing the API.
startMcpListener({ host: process.env.MCP_HOST || '127.0.0.1', port: mcpPort(), apiBase: `http://127.0.0.1:${port}` })

// On a clean exit (Ctrl+C, or the dev watcher restarting the process), fold the write-ahead log back into rp.db so the main file is complete on its own.
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
