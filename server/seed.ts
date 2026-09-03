import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { avatarsDir, characterStore, worldInfoBookStore, worldStore } from './db.ts'
import { SEED_BACKGROUND_KEYS, SEED_WORLD_ID, seedCharacter, seedWorld, seedWorldInfoBook } from './seedContent.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Committed at the repo root (not under data/, which is gitignored) — these ship with the app.
const seedAssetsDir = path.resolve(__dirname, '..', 'seed', 'backgrounds')

/**
 * Populates the one bundled world/character/World Info book on first run only. Idempotent by
 * construction: it checks for the seed world's own fixed id rather than "is the database empty",
 * so deleting other data never re-triggers it, and re-running it (e.g. after `npm install`) is a
 * harmless no-op once it's already been applied once.
 */
export function runSeedIfNeeded(): void {
  if (worldStore.get(SEED_WORLD_ID)) return

  const backgroundsDest = path.join(avatarsDir, 'worlds', SEED_WORLD_ID, 'backgrounds')
  fs.mkdirSync(backgroundsDest, { recursive: true })
  let copied = 0
  for (const key of SEED_BACKGROUND_KEYS) {
    const src = path.join(seedAssetsDir, `${key}.png`)
    if (!fs.existsSync(src)) continue // Missing art shouldn't block seeding the rest — the world just falls back to a placeholder gradient for that key, same as any world with unfinished art.
    fs.copyFileSync(src, path.join(backgroundsDest, `${key}.png`))
    copied++
  }

  // The stores are intentionally typed loosely (Record<string, unknown> in, out) since they're a
  // thin JSON-blob layer over SQLite shared by every entity kind — seedContent.ts's exports carry
  // the real, precise types for everything written by hand above.
  worldStore.insert(seedWorld as unknown as Record<string, unknown>)
  worldInfoBookStore.insert(seedWorldInfoBook as unknown as Record<string, unknown>)
  characterStore.insert(seedCharacter as unknown as Record<string, unknown>)

  console.log(`[rp-server] seeded starter content: 1 world, 1 World Info book, 1 character (${copied}/${SEED_BACKGROUND_KEYS.length} backgrounds copied)`)
}
