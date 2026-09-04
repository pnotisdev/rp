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
    // `presets/` is a user-dropped SillyTavern preset library (gitignored, reference/import only),
    // not app source. Vite's file watcher has crashed with EBUSY trying to watch files in it while
    // an editor or another process held one open — exclude it so a stray lock can't take the dev
    // server down. The glob alone wasn't reliably matching on Windows (backslash paths vs a
    // forward-slash pattern) and the crash still happened — the absolute path is included too,
    // since chokidar accepts a plain path prefix as well as a glob and this form is
    // separator-agnostic.
    watch: { ignored: ['**/presets/**', path.resolve(__dirname, 'presets')] },
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
