import { describe, expect, it } from 'vitest'
import { lorekeeper } from './lorekeeper'
import { runScript } from './harness'

const messages = [
  { role: 'user', name: 'Kai', text: 'We enter the town of Brindle.' },
  { role: 'char', name: 'Mara', text: 'Mara nods. "Captain Voss rules Brindle with the Iron Guild."' },
]
const reply =
  'Here you go:\n```json\n[{"name":"Captain Voss","kind":"person","text":"Rules Brindle with the Iron Guild.","keys":["Voss"]},{"name":"Brindle","kind":"place","text":"A walled town."},{"name":"Mara","kind":"person","text":"skip me"},{"name":"","text":"bad"}]\n```'

describe('lorekeeper script', () => {
  it('scans on the Nth reply and queues new entries for review', async () => {
    const s = await runScript(lorekeeper, { settings: { scanEvery: 2 }, messages, generate: () => reply })
    await s.emit('turn', { phase: 'start' })
    await s.emit('turn', { phase: 'end' })
    expect(s.calls.some((c) => c.method === 'generate')).toBe(false)
    await s.emit('turn', { phase: 'end' })
    const codex = s.store.get('chat:codex') as { entries: { name: string; status: string; kind: string; keys: string[] }[]; turns: number }
    expect(codex.turns).toBe(0)
    expect(codex.entries.map((e) => [e.name, e.status, e.kind])).toEqual([
      ['Captain Voss', 'pending', 'person'],
      ['Brindle', 'pending', 'place'],
      ['Mara', 'pending', 'person'],
    ])
    expect(codex.entries[0].keys).toEqual(['Voss'])
    expect(s.calls.find((c) => c.method === 'notify')?.args[0]).toContain('3 new codex entries to review')
  })

  it('never scans when scanEvery is 0, and adds directly when auto-approving', async () => {
    const off = await runScript(lorekeeper, { settings: { scanEvery: 0 }, messages, generate: () => reply })
    await off.emit('turn', { phase: 'end' })
    expect(off.calls.some((c) => c.method === 'generate')).toBe(false)
    const auto = await runScript(lorekeeper, { settings: { scanEvery: 1, autoApprove: true }, messages, generate: () => reply })
    await auto.emit('turn', { phase: 'end' })
    expect((auto.store.get('chat:codex') as { entries: { status: string }[] }).entries.every((e) => e.status === 'active')).toBe(true)
  })

  it('skips names it already has and survives a bad model reply', async () => {
    const s = await runScript(lorekeeper, { settings: { scanEvery: 1 }, messages, generate: () => reply })
    s.store.set('chat:codex', { entries: [{ id: 'a', name: 'brindle', kind: 'place', text: 'x', keys: [], status: 'active', pinned: false, at: 1 }], turns: 0, last: 0 })
    await s.emit('turn', { phase: 'end' })
    expect((s.store.get('chat:codex') as { entries: { name: string }[] }).entries.map((e) => e.name)).toEqual(['brindle', 'Captain Voss', 'Mara'])
    const bad = await runScript(lorekeeper, { settings: { scanEvery: 1 }, messages, generate: () => 'I cannot do that.' })
    await expect(bad.emit('turn', { phase: 'end' })).resolves.toBeUndefined()
  })

  it('adds only matching, active entries to the prompt, pinned ones always', async () => {
    const s = await runScript(lorekeeper, { settings: { budget: 1000 }, messages: [] })
    const entry = (name: string, text: string, over = {}) => ({ id: name, name, kind: 'person', text, keys: [], status: 'active', pinned: false, at: 1, ...over })
    s.store.set('chat:codex', {
      entries: [entry('Voss', 'Captain of Brindle.', { keys: ['the captain'] }), entry('Mara', 'A rogue.'), entry('Old Rule', 'Magic costs blood.', { pinned: true }), entry('Muted', 'Hidden.', { status: 'muted' }), entry('Draft', 'Pending.', { status: 'pending' })],
      turns: 0,
    })
    expect(await s.context('We should ask the captain about it.')).toMatchObject({ label: 'codex' })
    const text = (await s.context('We should ask the captain about it.')).text
    expect(text).toContain('- Voss (person): Captain of Brindle.')
    expect(text).toContain('Old Rule')
    expect(text).not.toMatch(/Mara|Muted|Draft/)
    expect((await s.context('Nobody in particular.')).text).toBe('Established facts about this story. Stay consistent with them:\n- Old Rule (person): Magic costs blood.')
  })

  it('respects the character budget', async () => {
    const s = await runScript(lorekeeper, { settings: { budget: 200 }, messages: [] })
    const entries = ['Aaa', 'Bbb', 'Ccc'].map((n) => ({ id: n, name: n, kind: 'lore', text: 'x'.repeat(90), keys: [], status: 'active', pinned: false, at: 1 }))
    s.store.set('chat:codex', { entries, turns: 0 })
    const lines = (await s.context('Aaa Bbb Ccc')).text.split('\n').slice(1)
    expect(lines).toHaveLength(1)
  })
})
