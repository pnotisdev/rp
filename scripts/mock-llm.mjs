// A tiny OpenAI-compatible mock model for UI verification: streams a canned reply and echoes hook-injected prompt text.
import http from 'node:http'

const port = Number(process.env.MOCK_LLM_PORT) || 5555
let last = null
const history = []
let turn = Math.floor(Math.random() * 1000)
const LINES = [
  '"Hmm. Fine, sit down, I suppose."',
  '"Did anyone ever tell you that you talk too much?"',
  '"The library closes at nine, so choose your words wisely."',
  '"I was not smiling. That was a facial spasm."',
  '"Do not touch the index cards. They are in order."',
  '"If you are going to stay, at least be useful."',
  '"There is exactly one chair, and it is mine."',
  '"Rain again. Typical."',
  '"Stop hovering. I can hear you thinking."',
  '"Quiet zone. That means you, too."',
  '"Ask the librarian. Oh wait, that is me."',
  '"I bite only when interrupted during chapters."',
]
const FILLERS = ['She tucks a pencil behind her ear.', 'Her gaze drops back to the index cards.', 'A page turns, louder than necessary.', 'She sighs through her nose.', 'The radiator ticks twice.']

const call = (name, args) => `<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`

// Scripted Assistant tool loop: "workspace" asks list, read, edit in turn; "remember" saves a note; pictures are described.
function assistantScript(all, hasImage) {
  if (!all.includes('<tool_call>{"name"')) return null
  const lastResult = all.lastIndexOf('</tool_result>')
  const tail = lastResult >= 0 ? all.slice(lastResult + 14) : ''
  if (lastResult >= 0 && tail.length < 80) {
    const name = /<tool_result name="([\w.-]+)"/g
    let last = ''
    for (const m of all.matchAll(name)) last = m[1]
    if (last === 'list_files') return call('read_file', { path: 'notes.txt' })
    if (last === 'generate_image') return 'Here is the picture I made.'
    if (last === 'read_file') return call('edit_file', { path: 'notes.txt', old_text: 'Status: draft', new_text: 'Status: final' })
    return `Done: I looked at the workspace, read notes.txt and changed "draft" to "final". (last tool: ${last})`
  }
  const ask = all.slice(Math.max(0, all.lastIndexOf('\nUser: '))).toLowerCase()
  if (/draw/.test(ask)) return call('generate_image', { prompt: 'a silver-haired girl in a quiet library', save_as: 'art/library.png' })
  if (hasImage && /picture|image|see/.test(ask)) return 'I can see the picture you attached.'
  if (/remember/.test(ask)) return call('remember', { note: 'The user likes tea over coffee.' })
  if (/workspace|files/.test(ask)) return call('list_files', { path: '.' })
  return null
}

function replyFor(body) {
  const messages = body.messages ?? [{ role: 'user', content: body.prompt ?? '' }]
  const hasImage = messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'))
  const all = messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => p.text ?? '').join(''))).join('\n')
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const quests = /Quests the player is pursuing[^\n]*\n((?:- [^\n]*\n?)+)/.exec(all)?.[1]?.trim().replace(/\n/g, '; ')
  void lastUser
  // Canned answers for the bundled extensions' own model calls.
  if (/You keep a codex/.test(all)) {
    return JSON.stringify([
      { name: 'The Quiet Zone', kind: 'place', text: 'The silent second floor of the library, enforced by Sumire.', keys: ['quiet zone'] },
      { name: 'Index cards', kind: 'item', text: "Sumire's strictly ordered study cards." },
    ])
  }
  if (/learner\. From the text/.test(all)) {
    return JSON.stringify([
      { word: '図書館', reading: 'toshokan', meaning: 'library', example: '図書館は静かです。' },
      { word: '静か', reading: 'shizuka', meaning: 'quiet', example: '静かにして。' },
    ])
  }
  const scripted = assistantScript(all, hasImage)
  if (scripted) return scripted
  const pick = (list) => list[(turn++ * 7 + Math.floor(Math.random() * list.length)) % list.length]
  const event = /random event shakes up the story now: ([^\n]*?)\. Work it/.exec(all)?.[1]
  const bits = [
    `*${pick(FILLERS)}* ${pick(LINES)}`,
    quests ? `"About your quests: ${quests}."` : '',
    event ? `*Suddenly: ${event}.*` : '',
  ]
  const text = bits.filter(Boolean).join(' ')
  return /Track the sheet honestly/.test(all) ? `[HP -3] [GOLD +5] [ITEM +Rusty key]\n\n${text}` : text
}

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end()
    if (req.url === '/__history') return res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(history))
    if (req.url === '/__last') return res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(last))
    if (req.url?.startsWith('/v1/models')) return res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
    if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const body = JSON.parse(raw || '{}')
        last = body
        history.push(body)
        if (history.length > 12) history.shift()
        const text = replyFor(body)
        if (!body.stream) {
          return res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }))
        }
        res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        const words = text.split(/(?<= )/)
        let i = 0
        const tick = setInterval(() => {
          if (i >= words.length) {
            res.write('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
            clearInterval(tick)
            return res.end()
          }
          res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: words[i++] } }] })}\n\n`)
        }, 20)
      })
      return
    }
    res.writeHead(200, { ...cors, 'content-type': 'text/plain' }).end('rp mock llm: POST /v1/chat/completions, GET /v1/models, GET /__last')
  })
  .listen(port, '127.0.0.1', () => console.log(`[mock-llm] http://127.0.0.1:${port}/v1`))
