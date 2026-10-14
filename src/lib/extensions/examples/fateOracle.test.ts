import { describe, expect, it } from 'vitest'
import { FATE_LIB, fateOracle } from './fateOracle'
import { loadLib, runScript, sequence } from './harness'

const fate = (...r: number[]) => loadLib<any>(FATE_LIB, 'Fate', r.length ? sequence(...r) : undefined)

describe('fate oracle odds', () => {
  it('shifts the chance with the chaos factor and keeps it inside 3-97', () => {
    const F = fate()
    expect(F.chance(4, 5)).toBe(50)
    expect(F.chance(4, 9)).toBe(66)
    expect(F.chance(0, 1)).toBe(3)
    expect(F.chance(8, 9)).toBe(97)
  })

  it('answers yes at or under the chance, with exceptional results at the extremes', () => {
    // d100 roll = 1 + floor(r * 100): r=0.40 -> 41 at 50% is a yes; 0.04 -> 5 is exceptional (<= 10); 0.60 -> 61 is a no; 0.95 -> 96 exceptional no
    expect(fate(0.4).ask(4, 5)).toMatchObject({ yes: true, strong: false, answer: 'Yes' })
    expect(fate(0.04).ask(4, 5)).toMatchObject({ yes: true, strong: true, answer: 'Yes (exceptional)' })
    expect(fate(0.6).ask(4, 5)).toMatchObject({ yes: false, strong: false, answer: 'No' })
    expect(fate(0.95).ask(4, 5)).toMatchObject({ yes: false, strong: true, answer: 'No (exceptional)' })
  })

  it('triggers a random event on doubles within the chaos factor', () => {
    expect(fate(0.32).ask(4, 5).event).toBe(true) // rolled 33, digit 3 <= 5
    expect(fate(0.65).ask(4, 5).event).toBe(false) // rolled 66, digit 6 > 5
    expect(fate(0.33).ask(4, 5).event).toBe(false) // rolled 34
  })

  it('checks scenes against chaos: odd alters, even interrupts', () => {
    expect(fate(0.0).scene(5)).toMatchObject({ kind: 'altered', r: 1 })
    expect(fate(0.1).scene(5)).toMatchObject({ kind: 'interrupted', r: 2 })
    expect(fate(0.9).scene(5)).toMatchObject({ kind: 'expected', r: 10 })
  })

  it('ties events to open threads and known characters', () => {
    const F = fate(0.2, 0, 0, 0) // roll 21 -> NPC action; pick first action/subject; pick first NPC
    const e = F.event({ threads: [], npcs: [{ text: 'Mara' }] })
    expect(e.focus).toBe('NPC action')
    expect(e.who).toBe('Mara')
    expect(e.text).toBe('NPC action (Mara): Abandon / Alliance')
    expect(fate(0.5, 0, 0, 0).event({ threads: [{ text: 'old', done: true }], npcs: [] }).who).toBe('') // finished threads are not used
  })
})

describe('fate oracle script', () => {
  it('is silent with nothing stored', async () => {
    const s = await runScript(fateOracle)
    expect(await s.context()).toBeNull()
  })

  it('injects a queued result once, until a reply completes', async () => {
    const s = await runScript(fateOracle)
    s.store.set('chat:fate', { chaos: 5, threads: [], npcs: [], log: [], pending: { kind: 'event', text: 'NPC action: Betray / Oath' } })
    expect((await s.context()).find((x: { label: string }) => x.label === 'fate').text).toContain('NPC action: Betray / Oath')
    expect((s.store.get('chat:fate') as { pending: unknown }).pending).not.toBeNull() // regenerating must still see it
    await s.output('A reply.')
    expect((s.store.get('chat:fate') as { pending: unknown }).pending).toBeNull()
    expect(await s.context()).toBeNull()
  })

  it('tells the AI about open threads and the cast, unless turned off', async () => {
    const state = { chaos: 5, threads: [{ id: 'a', text: 'find the ledger' }, { id: 'b', text: 'old news', done: true }], npcs: [{ id: 'c', text: 'Voss' }], log: [], pending: null }
    const on = await runScript(fateOracle)
    on.store.set('chat:fate', state)
    expect((await on.context())[0].text).toBe('Open plot threads: find the ledger. Recurring characters: Voss.')
    const off = await runScript(fateOracle, { settings: { injectLists: false } })
    off.store.set('chat:fate', state)
    expect(await off.context()).toBeNull()
  })

  it('rolls surprise events after replies when the chance hits', async () => {
    const hit = await runScript(fateOracle, { settings: { eventChance: 100 }, random: sequence(0, 0.5, 0, 0) })
    await hit.output('A reply.')
    const f = hit.store.get('chat:fate') as { pending: { kind: string; text: string }; log: unknown[] }
    expect(f.pending.text).toContain('Move away from a thread')
    expect(f.log).toHaveLength(1)
    const off = await runScript(fateOracle, { settings: { eventChance: 0 } })
    await off.output('A reply.')
    expect(off.store.has('chat:fate')).toBe(false)
  })
})

describe('fate oracle tools', () => {
  it('answers questions and draws events for the Assistant, using the stored chaos factor', async () => {
    const s = await runScript(fateOracle, { random: sequence(0.4, 0.5, 0, 0) })
    s.store.set('chat:fate', { chaos: 5, threads: [], npcs: [], log: [], pending: null })
    const a = await s.tools.ask_oracle({ question: 'Is the door locked?', likelihood: 'Likely' })
    expect(a).toMatchObject({ answer: 'Yes', chancePercent: 75, rolled: 41, randomEvent: null })
    expect((await s.tools.random_event({})).event).toContain(' / ')
    expect((s.store.get('chat:fate') as { log: unknown[] }).log).toHaveLength(2)
  })
})
