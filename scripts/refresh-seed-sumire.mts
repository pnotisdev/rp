// Brings an existing install's seeded Sumire, starter persona and seed-world gifts/items up to the bundled content.
import fs from 'node:fs'
import path from 'node:path'
import {
  SEED_CHARACTER_ID,
  SEED_PERSONA_ID,
  SEED_WORLD_ID,
  seedCharacter,
  seedPersona,
  seedWorld,
} from '../server/seedContent.ts'

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

const backupDir = path.resolve('data', 'backups')
fs.mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')

const oldCharacter = await call<Record<string, unknown>>('GET', `/characters/${SEED_CHARACTER_ID}`)
const oldPersona = await call<Record<string, unknown>>('GET', `/personas/${SEED_PERSONA_ID}`).catch(() => null)
const oldWorld = await call<Record<string, unknown>>('GET', `/worlds/${SEED_WORLD_ID}`)
fs.writeFileSync(path.join(backupDir, `seed-before-refresh-${stamp}.json`), JSON.stringify({ oldCharacter, oldPersona, oldWorld }, null, 2))

// Authored fields only: art, sprites, outfits and anything the player added stay as they are.
const {
  card, giftPreferences, giftLikes, giftDislikes, loveLanguage, relationshipStarters, schedule, occupation, workplace,
  homeLocation, frequentedLocations, likes, goals, boundaries, voiceFingerprint,
} = seedCharacter
await call('PUT', `/characters/${SEED_CHARACTER_ID}`, {
  card, giftPreferences, giftLikes, giftDislikes, loveLanguage, relationshipStarters, schedule, occupation, workplace,
  homeLocation, frequentedLocations, likes, goals, boundaries, voiceFingerprint, updatedAt: Date.now(),
})
console.log('updated Sumire')

if (oldPersona && typeof oldPersona.description === 'string' && oldPersona.description.includes('Sakura Hill High School')) {
  await call('PUT', `/personas/${SEED_PERSONA_ID}`, { description: seedPersona.description })
  console.log('updated the starter persona')
}

const have = (list: unknown, id: string) => Array.isArray(list) && list.some((x) => (x as { id?: string }).id === id)
const gifts = [...((oldWorld.gifts as unknown[]) ?? [])]
for (const g of seedWorld.gifts ?? []) if (!have(gifts, g.id)) gifts.push(g)
// An item the server flattened to the +1 affection fallback (older servers dropped multi/mood effects) is restored from the seed.
const isFallback = (e: unknown) => JSON.stringify(e) === JSON.stringify({ kind: 'relationship', dimension: 'affection', amount: 1 })
const items = [...((oldWorld.items as { id: string; effect: unknown }[]) ?? [])]
for (const i of seedWorld.items ?? []) {
  const at = items.findIndex((x) => x.id === i.id)
  if (at === -1) items.push(i)
  else if (isFallback(items[at].effect) && !isFallback(i.effect)) items[at] = { ...items[at], effect: i.effect }
}
await call('PUT', `/worlds/${SEED_WORLD_ID}`, { gifts, items })
console.log(`world now has ${gifts.length} gifts and ${items.length} items`)
