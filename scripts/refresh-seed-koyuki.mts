// Brings an existing install's Koyuki up to the bundled content (server/seedKoyuki.ts), or adds her if missing.
import fs from 'node:fs'
import path from 'node:path'
import { SEED_CHARACTER_4_ID, seedCharacter4 } from '../server/seedKoyuki.ts'

const api = process.argv[2] ?? 'http://localhost:3001/api'

async function call<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${api}${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${route} failed: ${res.status}`)
  return (await res.json()) as T
}

/** Seed entries win by id; anything the player added on top is kept. */
function mergeById<T extends { id: string }>(seed: T[] | undefined, existing: unknown): T[] {
  const mine = Array.isArray(existing) ? (existing as T[]) : []
  const seedIds = new Set((seed ?? []).map((e) => e.id))
  return [...(seed ?? []), ...mine.filter((e) => !seedIds.has(e.id))]
}

const existing = await call<Record<string, unknown>>('GET', `/characters/${SEED_CHARACTER_4_ID}`).catch(() => null)
if (!existing) {
  await call('POST', '/characters', seedCharacter4)
  console.log('added Koyuki')
} else {
  const backupDir = path.resolve('data', 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.writeFileSync(path.join(backupDir, `koyuki-before-refresh-${stamp}.json`), JSON.stringify(existing, null, 2))
  // Authored fields only: art, sprites and anything the player added stay as they are.
  const {
    card, replyLength, occupation, workplace, homeLocation, frequentedLocations, likes, goals, boundaries, socialConnections,
    voiceFingerprint, behavioralRules, loveLanguage, giftLikes, giftDislikes, explicitVoiceNote, relationshipStarters, touchProfile, outreach, drive,
  } = seedCharacter4
  await call('PUT', `/characters/${SEED_CHARACTER_4_ID}`, {
    card, replyLength, occupation, workplace, homeLocation, frequentedLocations, likes, goals, boundaries, socialConnections,
    voiceFingerprint, behavioralRules, loveLanguage, giftLikes, giftDislikes, explicitVoiceNote, relationshipStarters, touchProfile, outreach, drive,
    outfits: mergeById(seedCharacter4.outfits, existing.outfits),
    customExpressions: mergeById(seedCharacter4.customExpressions, existing.customExpressions),
    updatedAt: Date.now(),
  })
  console.log('updated Koyuki')
}
