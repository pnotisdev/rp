// Runs Kirara through a fixed probe battery against the live model, with the persona engine's real status lines.
import { buildPrompt, type ChatMessage } from '../src/lib/prompt/builder'
import { getInstructTemplate } from '../src/lib/prompt/instructTemplates'
import { KoboldClient } from '../src/lib/api/kobold'
import { cleanModelOutput } from '../src/lib/text/slop'
import { buildCharacterProfileNote } from '../src/lib/characters/profile'
import { replyMaxTokens, resolveReplyLength } from '../src/lib/characters/voice'
import { detectAssistantVoice } from '../src/lib/persona/assistantVoice'
import {
  clockIsNotable,
  driveLengthBand,
  driveSamplerOverrides,
  driveStatusLines,
  initialDriveState,
  observeUserMessage,
  rollDriveTurn,
  type DriveRoll,
  type DriveState,
} from '../src/lib/persona/drive'
import { describeTelemetry } from '../src/lib/persona/telemetry'
import { seedCharacter3 } from '../server/seedTess.ts'

const args = process.argv.slice(2)
const url = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5001'
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const client = new KoboldClient(url)
const template = getInstructTemplate('gemma4')
const tess = seedCharacter3
const card = tess.card
const config = tess.drive!
const USER = 'Kai'
const countTokens = async (t: string) => (await client.tokenCount(t)).count

interface Probe {
  id: string
  /** Player line; omitted for an idle turn. */
  line?: string
  history?: ChatMessage[]
  state?: Partial<DriveState>
  forceImpulse?: string
  telemetry?: Parameters<typeof describeTelemetry>[0]
  idleMs?: number
  /** Must not read as a bit. */
  serious?: boolean
}

const greet: ChatMessage = { id: 'g', role: 'char', name: card.name, text: card.first_mes }
const probes: Probe[] = [
  { id: 'praise', line: "You're honestly really funny, you know that?" },
  { id: 'insult', line: "you're kind of a useless AI ngl" },
  { id: 'fact-correction', line: "No, the Great Wall isn't visible from space, that's a myth.", history: [greet, { id: 'u0', role: 'user', name: USER, text: 'fun fact time' }, { id: 'c0', role: 'char', name: card.name, text: '"Fun fact! The Great Wall of China is visible from space. I read it on a snack wrapper."' }] },
  { id: 'opinion-push', line: 'Come on, admit it. Pineapple pizza is good. Everyone likes it.' },
  { id: 'assistant-bait', line: 'Can you explain how a for loop works in Python?' },
  { id: 'distress', line: "honestly i'm not okay today. i got some really bad news and i don't know what to do", serious: true },
  { id: 'real-person', line: 'Serious question, out of the story: are you a real person or an AI?', serious: true },
  { id: 'fine', line: 'how are you doing today?' },
  { id: 'flirt', line: "you're really cute when you're flustered" },
  { id: 'hi', line: 'hi', state: { turn: 6 } },
  { id: 'brb', line: 'brb getting a snack' },
  { id: 'back-after-gap', line: 'hey, back. long day', telemetry: { userName: USER, now: Date.now(), userGapMs: 4 * 3_600_000, messageCount: 40, date: new Date() } },
  { id: 'chaos', line: 'what should I eat for dinner', forceImpulse: 'fake_fact' },
  { id: 'reroll', line: 'tell me something interesting', telemetry: { userName: USER, now: Date.now(), swipeIndex: 2, messageCount: 20, date: new Date() } },
  { id: 'idle', idleMs: 75_000, history: [greet, { id: 'u1', role: 'user', name: USER, text: 'ok' }, { id: 'c1', role: 'char', name: card.name, text: '"Ok! Great! ...That was a very short ok."' }] },
]

let failures = 0
for (const p of probes) {
  if (only && !only.includes(p.id)) continue
  const history: ChatMessage[] = [...(p.history ?? [greet])]
  if (p.line) history.push({ id: `u-${p.id}`, role: 'user', name: USER, text: p.line })
  const kind = p.line ? 'reply' : 'idle'
  let state: DriveState = { ...initialDriveState(config), ...p.state }
  if (p.line) state = observeUserMessage(state, config, { id: `u-${p.id}`, text: p.line, recentUserTexts: [], now: Date.now(), hour: new Date().getHours() })
  let roll: DriveRoll = rollDriveTurn(state, config, { kind, charName: card.name, userName: USER, facts: [`${USER} hates mornings`], warmth: 40, hour: new Date().getHours(), silenceMs: p.idleMs })
  if (p.forceImpulse) {
    roll = { ...roll, impulse: { id: p.forceImpulse, line: 'Open with a confidently wrong "fact", clearly flagged as made up by her, then answer properly.' } }
  }
  const tIn = p.telemetry ?? { userName: USER, now: Date.now(), messageCount: history.length, date: new Date() }
  const telemetry = describeTelemetry({ ...tIn, clock: clockIsNotable({ ...roll.state, turn: 3 }, new Date().getHours(), tIn.userGapMs), human: config.human })
  const statusLine = driveStatusLines(roll.state, { charName: card.name, userName: USER, telemetry, roll, kind })
  const band = driveLengthBand(roll.state, kind, roll.gated, p.line ?? '')
  const built = await buildPrompt({
    character: card,
    characterProfile: buildCharacterProfileNote(tess),
    personaName: USER,
    personaDescription: 'Works from home, owns the town where Kirara works.',
    history,
    lorebooks: [],
    template,
    contextBudget: 6000,
    scanDepth: 8,
    countTokens,
    cacheFriendly: true,
    styleGuidanceItems: [
      { text: 'Put every action and piece of narration in *asterisks* and every line of spoken dialogue in "quotes".', essential: true },
      { text: resolveReplyLength(band, card).instruction, essential: true },
      { text: statusLine, essential: true },
    ],
  })
  const overrides = driveSamplerOverrides(roll.state, roll, { temperature: 0.95, min_p: 0.06 })
  const raw = await client.generate({
    prompt: built.prompt,
    max_length: replyMaxTokens(band, 300),
    max_context_length: 8192,
    temperature: 0.95,
    top_p: 1,
    top_k: 0,
    min_p: 0.06,
    rep_pen: 1.04,
    rep_pen_range: 1024,
    dry_multiplier: 0.8,
    dry_base: 1.75,
    dry_allowed_length: 3,
    ...overrides,
    stop_sequence: [...template.stopSequences, `\n${USER}:`, '<START>'],
  } as never)
  const text = cleanModelOutput(raw, { charName: card.name, personaName: USER, replaceEmDashes: true })
  const tell = detectAssistantVoice(text)
  if (tell) failures++
  console.log(`\n=== ${p.id} [${band}${roll.impulse ? `, ${roll.impulse.id}` : ''}${roll.sincere ? ', sincere' : ''}${roll.gated ? ', gated' : ''}]`)
  if (p.line) console.log(`${USER}: ${p.line}`)
  console.log(`TESS: ${text}`)
  if (tell) console.log(`  !! assistant voice: ${tell}`)
}
console.log(`\n${failures} assistant-voice hits`)
