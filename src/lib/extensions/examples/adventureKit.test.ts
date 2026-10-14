import { describe, expect, it } from 'vitest'
import { adventureKit } from './adventureKit'
import { runScript } from './harness'

const sheet = (over: Record<string, unknown> = {}) => ({ name: 'Aria', cls: 'Rogue', level: 1, xp: 0, hp: { cur: 12, max: 20 }, mp: { cur: 3, max: 5 }, gold: 10, stats: { STR: 10, DEX: 16 }, items: [{ name: 'Torch', qty: 2 }], conds: [], ...over })

async function withSheet(settings: Record<string, unknown> = {}, over = {}) {
  const s = await runScript(adventureKit, { settings })
  s.store.set('chat:sheet', sheet(over))
  return s
}

describe('adventure kit script', () => {
  it('stays out of the way without a sheet', async () => {
    const s = await runScript(adventureKit)
    expect(await s.context()).toBeNull()
    expect(await s.output('You hit it. [HP -3]')).toBeNull()
  })

  it('describes the sheet and the tag rules to the AI', async () => {
    const s = await withSheet({ difficulty: 'gritty' })
    const sections = await s.context()
    expect(sections[0].text).toContain('Aria, level 1 Rogue. HP 12/20')
    expect(sections[0].text).toContain('DEX 16 (+3)')
    expect(sections[0].text).toContain('Torch x2')
    expect(sections[1].text).toContain('[HP -3]')
    expect(sections[1].text).toContain('Be harsh')
  })

  it('omits the rules when the AI may not update the sheet', async () => {
    const s = await withSheet({ aiUpdates: false })
    expect(await s.context()).toHaveLength(1)
    expect(await s.output('Hit. [HP -3]')).toBeNull()
  })

  it('applies tags, strips them and saves the sheet', async () => {
    const s = await withSheet()
    const text = await s.output('The goblin slashes you.\n\n[HP -5] [GOLD +7] [ITEM +2 Arrow] [ITEM -Torch] [COND +Poisoned] [XP +20]')
    expect(text).toBe('The goblin slashes you.')
    const saved = s.store.get('chat:sheet') as ReturnType<typeof sheet>
    expect(saved.hp.cur).toBe(7)
    expect(saved.gold).toBe(17)
    expect(saved.items).toEqual([{ name: 'Torch', qty: 1 }, { name: 'Arrow', qty: 2 }])
    expect(saved.conds).toEqual(['Poisoned'])
    expect(saved.xp).toBe(20)
    expect(s.calls.find((c) => c.method === 'notify')?.args[0]).toContain('HP -5')
  })

  it('clamps HP, marks a downed hero and clears it on healing', async () => {
    const s = await withSheet()
    await s.output('Ouch. [HP -99]')
    let saved = s.store.get('chat:sheet') as ReturnType<typeof sheet>
    expect(saved.hp.cur).toBe(0)
    expect(saved.conds).toContain('Downed')
    await s.output('A potion. [HP +4]')
    saved = s.store.get('chat:sheet') as ReturnType<typeof sheet>
    expect(saved.hp.cur).toBe(4)
    expect(saved.conds).not.toContain('Downed')
  })

  it('levels up and carries the XP over', async () => {
    const s = await withSheet()
    await s.output('Victory! [XP +130]')
    const saved = s.store.get('chat:sheet') as ReturnType<typeof sheet>
    expect(saved).toMatchObject({ level: 2, xp: 30, hp: { cur: 17, max: 25 } })
  })

  it('leaves replies without tags, and ignores junk tags, untouched', async () => {
    const s = await withSheet()
    expect(await s.output('Nothing happens [really].')).toBeNull()
    const text = await s.output('Fine. [HP -lots] [GOLD +x]')
    expect(text).toBe('Fine.')
    expect((s.store.get('chat:sheet') as ReturnType<typeof sheet>).hp.cur).toBe(12)
  })
})
