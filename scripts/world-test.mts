// Drafts a world against the live model and prints each raw reply. Usage: npx tsx scripts/world-test.mts "brief" [koboldUrl] [loreCount]
import { KoboldClient } from '../src/lib/api/kobold'
import { getInstructTemplate } from '../src/lib/prompt/instructTemplates'
import { draftWorld } from '../src/lib/world/generateWorld'

const brief = process.argv[2] ?? 'A fog-bound fishing town where the tide decides the working day'
const url = process.argv[3] ?? 'http://localhost:5001'
const loreCount = Number(process.argv[4] ?? 8)
const client = new KoboldClient(url)
const original = client.generate.bind(client)
client.generate = async (params, signal) => {
  const out = await original(params, signal)
  console.log(`\n--- raw reply (${out.length} chars) ---\n${out.slice(0, 1500)}\n`)
  return out
}

const started = Date.now()
const draft = await draftWorld(client, { brief, loreCount }, { shaping: { template: getInstructTemplate('gemma4'), reasoningReserve: 0 }, onStage: (s, st) => console.log(`[${s}] ${st}`) })
console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s`)
console.log(JSON.stringify({ name: draft.name, rules: draft.rules, entries: draft.entries.length, failed: draft.failed }, null, 2))
