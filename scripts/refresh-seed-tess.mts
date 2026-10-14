// Brings an existing install's Kirara up to the bundled content (server/seedTess.ts), or adds her if missing.
import fs from 'node:fs'
import path from 'node:path'
import { SEED_CHARACTER_3_ID, seedCharacter3 } from '../server/seedTess.ts'

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

// Slots from older versions of her design, dropped on refresh.
const RETIRED_IDS = new Set(['star-eyes'])

/** Seed entries win by id; anything the player added on top is kept. */
function mergeById<T extends { id: string }>(seed: T[] | undefined, existing: unknown): T[] {
  const mine = Array.isArray(existing) ? (existing as T[]) : []
  const seedIds = new Set((seed ?? []).map((e) => e.id))
  return [...(seed ?? []), ...mine.filter((e) => !seedIds.has(e.id) && !RETIRED_IDS.has(e.id))]
}

const existing = await call<Record<string, unknown>>('GET', `/characters/${SEED_CHARACTER_3_ID}`).catch(() => null)
if (!existing) {
  await call('POST', '/characters', seedCharacter3)
  console.log('added Kirara')
} else {
  const backupDir = path.resolve('data', 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.writeFileSync(path.join(backupDir, `tess-before-refresh-${stamp}.json`), JSON.stringify(existing, null, 2))
  // Authored fields only: art, sprites and anything the player added stay as they are.
  const {
    card, replyLength, replyFormat, occupation, workplace, homeLocation, frequentedLocations, likes, goals, boundaries, socialConnections,
    voiceFingerprint, behavioralRules, loveLanguage, giftLikes, giftDislikes, explicitVoiceNote, relationshipStarters, outreach, drive,
  } = seedCharacter3
  await call('PUT', `/characters/${SEED_CHARACTER_3_ID}`, {
    card, replyLength, replyFormat, occupation, workplace, homeLocation, frequentedLocations, likes, goals, boundaries, socialConnections,
    voiceFingerprint, behavioralRules, loveLanguage, giftLikes, giftDislikes, explicitVoiceNote, relationshipStarters, outreach, drive,
    // The older Kirara opted out of the date system; an omitted key would leave that on.
    dateModeOptOut: false,
    outfits: mergeById(seedCharacter3.outfits, existing.outfits),
    customExpressions: mergeById(seedCharacter3.customExpressions, existing.customExpressions),
    updatedAt: Date.now(),
  })
  console.log('updated Kirara')
}
