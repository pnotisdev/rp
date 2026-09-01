import { app } from './app.ts'
import { dataDir } from './db.ts'

const port = Number(process.env.API_PORT) || 3001

app.listen(port, () => {
  console.log(`[rp-server] listening on http://localhost:${port} — data stored in ${dataDir}`)
})
