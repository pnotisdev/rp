// Replays a long synthetic chat through the app's real prompt builder and assist prompts, tokenized by a live KoboldCpp
import { buildPrompt, renderHistoryTurn, DEFAULT_SYSTEM_PROMPT, type ChatMessage, type StyleGuidanceItem } from '../src/lib/prompt/builder'
import { getInstructTemplate } from '../src/lib/prompt/instructTemplates'
import { planCompaction } from '../src/lib/prompt/compaction'
import { summarizeMessages } from '../src/lib/prompt/summarize'
import { buildFactsLorebook } from '../src/lib/worldinfo/facts'
import { assessRelationshipMoment } from '../src/lib/dating/relationshipAssist'
import { generateChoices } from '../src/lib/prompt/choices'
import type { ChatBackend } from '../src/lib/api/chatBackend'
import type { Lorebook } from '../src/lib/characters/cardSpec'
import type { ChatFact } from '../src/lib/types'

const TURNS = Number(process.argv[2] ?? 60)
const KOBOLD = process.argv[3] ?? 'http://localhost:5001'
const CONTEXT = 12288
const MAX_REPLY = 400
const PREFILL_TPS = 3000 // measured on the 2080 Ti with this model
const DECODE_TPS = 24

let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const gauss = (m: number, sd: number) => Math.max(8, Math.round(m + sd * (rnd() + rnd() + rnd() - 1.5) * 2))
const VOCAB = 'quiet harbor lantern rain window tea silver coat letter bridge morning laughed whispered candle stairs garden shoulder smile hesitated afternoon kitchen river station bookshop umbrella music warm cold slowly softly suddenly remembered promised sister mother teacher coffee evening corner street shrine festival summer winter'.split(' ')
const words = (n: number) => Array.from({ length: n }, () => VOCAB[Math.floor(rnd() * VOCAB.length)]).join(' ')

const tokenCache = new Map<string, number[]>()
async function ids(text: string): Promise<number[]> {
  const hit = tokenCache.get(text)
  if (hit) return hit
  const r = (await fetch(`${KOBOLD}/api/extra/tokencount`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: text }) }).then((x) => x.json())) as { ids: number[] }
  tokenCache.set(text, r.ids)
  return r.ids
}
const countTokens = async (t: string) => (await ids(t)).length

const lcp = (a: number[], b: number[]) => {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** Emulated backend cache: one slot (KoboldCpp default) or N snapshot slots (--smartcache N). */
let fakeId = -1
class KvCache {
  slots: number[][] = []
  /** `rewindLimit`: how far behind the cache end a prompt may diverge and still be reused (Gemma's sliding-window cache; measured ~470 tokens by default, raised by --swapadding). */
  constructor(private max: number, private rewindLimit: number) {}
  /** Tokens that must be prefilled for this prompt; updates the cache state (prompt plus the reply generated into it). */
  process(tokens: number[], outTokens: number): number {
    let best = -1
    let bestLcp = 0
    this.slots.forEach((s, i) => {
      const l = lcp(s, tokens)
      if (l > bestLcp) { bestLcp = l; best = i }
    })
    const reusable = best >= 0 && bestLcp >= Math.min(tokens.length, this.slots[best].length) * 0.3 && this.slots[best].length - bestLcp <= this.rewindLimit
    const processed = tokens.length - (reusable ? bestLcp : 0)
    if (best >= 0 && (reusable || this.slots[best].length - bestLcp > this.rewindLimit) && this.max === 1) this.slots.splice(best, 1)
    else if (reusable) this.slots.splice(best, 1)
    else if (this.slots.length >= this.max) this.slots.shift()
    this.slots.push([...tokens, ...Array.from({ length: outTokens }, () => fakeId--)])
    return processed
  }
}

interface Call { label: string; prompt: string; outTokens: number }

/** Records every prompt the assist modules build and answers with canned, representative output. */
function fakeClient(calls: Call[], canned: (label: string, prompt: string) => string): ChatBackend {
  let last = ''
  return {
    prefersJsonObject: false,
    async generate(params) {
      const prompt = params.prompt
      const label = /relationship momentum|scoring relationship/.test(prompt) ? 'judge' : /brainstorming what a roleplay participant/.test(prompt) ? 'choices' : 'other'
      const out = canned(label, prompt)
      calls.push({ label, prompt, outTokens: Math.max(1, Math.round(out.length / 3.3)) })
      last = out
      return out
    },
    async generateStream() { return last },
    async getEffectiveMaxContext() { return CONTEXT },
    async tokenCount(t: string) { return { count: await countTokens(t) } },
    async abort() {},
    async getChatTemplate() { return null },
  } as ChatBackend
}

const JUDGE_VERBOSE = '{"deltas":{"affection":1,"trust":0,"chemistry":0,"comfort":1,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"Stayed to help clean up","newFacts":[],"planUpdates":[],"beliefUpdates":[],"expectationUpdates":[]}'
const JUDGE_COMPACT = '{"deltas":{"affection":1,"comfort":1},"reason":"Stayed to help clean up"}'
const CHOICES = '[{"kind":"line","label":"Ask about her day","text":"So, how was your day? You look tired."},{"kind":"action","label":"Offer tea","text":"*puts the kettle on and sets out two cups*"},{"kind":"line","label":"Tease her gently","text":"You know, you could just admit you missed me."}]'

const PERSONA = words(60)
const CARD = {
  name: 'Sumire',
  description: `${words(260)}.`,
  personality: words(60),
  scenario: words(50),
  first_mes: 'Hello.',
  mes_example: `<START>\n{{user}}: ${words(30)}\n{{char}}: ${words(90)}`,
}
const STEER_WORDS = Number(process.env.STEER_WORDS ?? 220)
const STEER: StyleGuidanceItem[] = [
  { text: `Standing rules. ${words(STEER_WORDS)}`, essential: true },
  { text: 'Put every action and piece of narration in *asterisks* and every line of spoken dialogue in "quotes".', essential: true },
  { text: `Keep replies to about three sentences. ${words(40)}`, essential: true },
  { text: `Sumire feels guarded but curious. ${words(30)}`, essential: false },
  { text: `Sumire wants reassurance. ${words(25)}`, essential: false },
  { text: `Sumire privately fears being a burden. ${words(25)}`, essential: false },
  { text: `Avoid these stock phrases: ${words(30)}`, essential: true },
]
const KEYWORD_LORE: Lorebook = {
  name: 'town',
  entries: ['harbor', 'shrine', 'festival', 'bookshop', 'station', 'sister'].map((k, i) => ({
    id: i, keys: [k], content: `${k} lore: ${words(40)}`, constant: false, selective: false, insertion_order: 50 + i, enabled: true,
  })),
}

interface Policy {
  name: string
  cacheFriendly: boolean
  /** Fold 'old chat' into the summary: 'legacy' = every few turns, 'watermark' = rare large steps. */
  memory: 'legacy' | 'watermark'
  judge: 'verbose' | 'compact'
  choices: 'auto' | 'off'
}

async function run(policy: Policy, cache: KvCache) {
  seed = 7
  const template = getInstructTemplate('gemma')
  const history: (ChatMessage & { createdAt: number })[] = []
  const facts: ChatFact[] = []
  let summary = ''
  let cutoff = 0
  let clock = 1
  let gpuSeconds = 0
  let prefillTokens = 0
  let decodeTokens = 0
  let mainPrefill = 0
  const summaryEvents: number[] = []
  const perLabel: Record<string, { prefill: number; decode: number }> = {}
  const charge = async (label: string, prompt: string, out: number) => {
    const tokens = await ids(prompt)
    const processed = cache.process(tokens, out)
    prefillTokens += processed
    decodeTokens += out
    gpuSeconds += processed / PREFILL_TPS + out / DECODE_TPS
    const l = (perLabel[label] ??= { prefill: 0, decode: 0 })
    l.prefill += processed
    l.decode += out
    if (label === 'main') mainPrefill += processed
  }

  const build = async (h: typeof history, turn: number) => {
    const lore: Lorebook[] = [KEYWORD_LORE, ...buildFactsLorebook(facts, undefined, policy.cacheFriendly ? h.slice(-4).map((m) => m.text).join(' ') : '')]
    return buildPrompt({
      character: CARD, personaName: 'Pontus', personaDescription: PERSONA, history: h.filter((m) => m.createdAt > cutoff),
      chatSummary: summary, lorebooks: lore, template, contextBudget: CONTEXT - MAX_REPLY - 32, scanDepth: 8, countTokens,
      globalSystemPrompt: DEFAULT_SYSTEM_PROMPT, styleGuidanceItems: STEER.map((s, i) => ({ ...s, text: i === 2 ? `${s.text} ${turn}` : s.text })),
      cacheFriendly: policy.cacheFriendly, historyTrimGrid: policy.cacheFriendly ? 6 : 1,
    })
  }

  const summarize = async (batch: typeof history) => {
    const calls: Call[] = []
    const client = fakeClient(calls, () => words(150))
    summary = await summarizeMessages({
      existingSummary: summary, messages: batch, charName: 'Sumire', userName: 'Pontus', detail: 'concise',
      generate: async (p) => { calls.push({ label: 'summary', prompt: p, outTokens: 220 }); return words(150) },
    })
    void client
    await charge('summary', calls[0].prompt, calls[0].outTokens)
    cutoff = batch[batch.length - 1].createdAt
    summaryEvents.push(history.length)
  }

  for (let turn = 1; turn <= TURNS; turn++) {
    const keyword = rnd() < 0.3 ? ` ${['harbor', 'shrine', 'festival', 'bookshop', 'station', 'sister'][Math.floor(rnd() * 6)]}` : ''
    history.push({ id: `u${turn}`, role: 'user', name: 'Pontus', text: words(gauss(34, 14)) + keyword, createdAt: clock++ })

    let built = await build(history, turn)
    if (policy.memory === 'legacy' && built.excludedMessageCount > 0) {
      const eligible = history.filter((m) => m.createdAt > cutoff).slice(0, Math.max(0, history.length - 12))
      if (eligible.length) { await summarize(eligible); built = await build(history, turn) }
    }
    const replyTokens = gauss(220, 45)
    await charge('main', built.prompt, replyTokens)
    history.push({ id: `c${turn}`, role: 'char', name: 'Sumire', text: words(Math.round(replyTokens * 0.75)), createdAt: clock++ })

    // Post-reply assists, built by the app's real modules.
    const calls: Call[] = []
    const client = fakeClient(calls, (label) => (label === 'judge' ? (policy.judge === 'compact' ? JUDGE_COMPACT : JUDGE_VERBOSE) : label === 'choices' ? CHOICES : '{}'))
    const plain = history.map(({ id, role, name, text }) => ({ id, role, name, text }))
    await assessRelationshipMoment(client, {
      history: plain, latestReply: history[history.length - 1].text, charName: 'Sumire', userName: 'Pontus',
      current: { affection: 40, trust: 40, chemistry: 40, comfort: 40, respect: 40, curiosity: 40, tension: 10 },
      knownFacts: facts.map((f) => f.text), compactOutput: policy.judge === 'compact',
    } as never)
    if (policy.choices === 'auto') await generateChoices(client, { history: plain, charName: 'Sumire', userName: 'Pontus' })
    for (const c of calls) await charge(c.label, c.prompt, c.outTokens)

    if (turn % 4 === 0) facts.push({ id: `f${turn}`, chatId: 'c', text: `Fact ${turn}: ${words(8)}`, active: true, createdAt: turn, importance: 0.5 })

    if (policy.memory === 'legacy') {
      const eligible = history.filter((m) => m.createdAt > cutoff).slice(0, Math.max(0, history.length - 12))
      if (eligible.length >= 6) await summarize(eligible)
    } else {
      const verbatim = history.filter((m) => m.createdAt > cutoff)
      const probe = await build(history, turn + 1)
      const toks = await Promise.all(verbatim.map((m) => countTokens(renderHistoryTurn(m, template, { charName: 'Sumire', userName: 'Pontus' }))))
      const tail = toks.slice(-4)
      const fold = planCompaction({ turns: verbatim.map((m, i) => ({ role: m.role, tokens: toks[i] })), capacity: probe.historyCapacity, growth: (tail.reduce((a, b) => a + b, 0) / tail.length) * 2, lowWater: 0.5 })
      if (fold > 0) await summarize(verbatim.slice(0, fold))
    }
  }

  const perTurn = (n: number) => (n / TURNS).toFixed(0)
  console.log(`\n${policy.name}`)
  console.log(`  GPU seconds/turn: ${(gpuSeconds / TURNS).toFixed(1)}   (prefill ${perTurn(prefillTokens)} tok/turn, decode ${perTurn(decodeTokens)} tok/turn)`)
  console.log(`  main-reply prefill: ${perTurn(mainPrefill)} tok/turn   summary events: ${summaryEvents.length}`)
  console.log('  by call: ' + Object.entries(perLabel).map(([k, v]) => `${k} ${(v.prefill / TURNS).toFixed(0)}p/${(v.decode / TURNS).toFixed(0)}d`).join('  '))
  return gpuSeconds / TURNS
}

const policies: Policy[] = [
  { name: 'LEGACY (current app)', cacheFriendly: false, memory: 'legacy', judge: 'verbose', choices: 'auto' },
  { name: 'CACHE-FRIENDLY memory + layout', cacheFriendly: true, memory: 'watermark', judge: 'verbose', choices: 'auto' },
  { name: 'CACHE-FRIENDLY + compact judge JSON', cacheFriendly: true, memory: 'watermark', judge: 'compact', choices: 'auto' },
  { name: 'CACHE-FRIENDLY + compact judge + lazy choices', cacheFriendly: true, memory: 'watermark', judge: 'compact', choices: 'off' },
]
const servers = [
  { name: 'KoboldCpp as launched now (1 slot, default rewind)', slots: 1, rewind: 470 },
  { name: '--smartcache 6', slots: 6, rewind: 470 },
  { name: '--swapadding 2048', slots: 1, rewind: 2000 },
  { name: '--smartcache 6 --swapadding 2048', slots: 6, rewind: 2000 },
]
for (const sv of servers) {
  console.log(`
================ backend: ${sv.name} ================`)
  for (const p of policies) await run(p, new KvCache(sv.slots, sv.rewind))
}
