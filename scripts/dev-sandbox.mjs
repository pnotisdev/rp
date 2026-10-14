// Runs the dev client + API against a throwaway data folder on separate ports, so experiments never touch real data.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dataDir = process.env.RP_DATA_DIR || path.resolve(import.meta.dirname, '..', 'data-sandbox')
const apiPort = process.env.API_PORT || '3101'
const clientPort = process.env.PORT || '5273'
fs.mkdirSync(dataDir, { recursive: true })

const env = { ...process.env, RP_DATA_DIR: dataDir, API_PORT: apiPort, PORT: clientPort }
console.log(`[sandbox] data: ${dataDir}\n[sandbox] app: http://localhost:${clientPort}  api: http://127.0.0.1:${apiPort}`)

const opts = { env, stdio: ['ignore', 'inherit', 'inherit'] }
const server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', '--experimental-sqlite', 'server/index.ts'], opts)
const client = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], opts)

function stop() {
  server.kill()
  client.kill()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
