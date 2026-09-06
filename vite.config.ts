import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    // Directories that are not app source and that another process writes to while Vite is up —
    // Vite's file watcher crashes the whole dev client with EBUSY the moment one of those files is
    // briefly locked (seen with `presets/`, and again when the sprite generator in `tools/comfy/`
    // wrote a batch of PNGs into `data/avatars/...`). `data/` is on-disk app state served by the
    // API server, never imported; `tools/comfy/out/` and `*.bak-*` are generator scratch/backups.
    // Both a glob and an absolute path are listed for each — the glob alone wasn't reliably
    // matching backslash paths on Windows; chokidar also accepts a plain path prefix.
    watch: {
      ignored: [
        '**/presets/**', path.resolve(__dirname, 'presets'),
        '**/data/**', path.resolve(__dirname, 'data'),
        '**/tools/comfy/out/**', path.resolve(__dirname, 'tools/comfy/out'),
        '**/sprites.bak-*/**',
      ],
    },
    // All app data now lives on disk via the local API server (see server/), reached
    // through this proxy so the browser only ever talks to one origin. If this port
    // were ever busy, Vite's default behavior is to silently bind the next free one
    // instead — same app, but a blank "new" origin with none of your data. Fail loudly
    // instead so a port conflict is obvious, not mistaken for lost data.
    strictPort: true,
    proxy: {
      '/api': `http://localhost:${Number(process.env.API_PORT) || 3001}`,
      '/avatars': `http://localhost:${Number(process.env.API_PORT) || 3001}`,
    },
  },
})
