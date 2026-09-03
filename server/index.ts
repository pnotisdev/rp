import { app } from './app.ts'
import { dataDir } from './db.ts'
import { runSeedIfNeeded } from './seed.ts'

runSeedIfNeeded()

const port = Number(process.env.API_PORT) || 3001

// 127.0.0.1 only — this API has no auth and full read/write/delete access to every
// character/chat/world, so it must never be reachable from other devices on the network.
app.listen(port, '127.0.0.1', () => {
  console.log(`[rp-server] listening on http://localhost:${port} — data stored in ${dataDir}`)
})
