import { describe, expect, it } from 'vitest'
import { slashCommands } from './slashCommands'
import { runScript, sequence } from './harness'

describe('slash commands', () => {
  it('ignores ordinary messages', async () => {
    const s = await runScript(slashCommands)
    expect(await s.input('hello there')).toBeNull()
    expect(await s.input('what about 1/2 of it')).toBeNull()
  })

  it('rolls dice into the message', async () => {
    // 0.5 on a d20 is 11; 0.99 is 20
    const s = await runScript(slashCommands, { random: sequence(0.5) })
    expect(await s.input('/roll d20+4 to climb the wall')).toBe('*rolls to climb the wall* (d20+4: [11] + 4 = **15**)')
    const nat = await runScript(slashCommands, { random: sequence(0.99) })
    expect(await nat.input('/roll')).toContain('natural 20')
  })

  it('handles advantage, keep-highest and bad input', async () => {
    const adv = await runScript(slashCommands, { random: sequence(0.1, 0.9) })
    expect(await adv.input('/roll d20 adv')).toContain('[19] (dropped 3)')
    const keep = await runScript(slashCommands, { random: sequence(0, 0.4, 0.9, 0.2) })
    expect(await keep.input('/roll 4d6kh3')).toContain('dropped 1')
    expect(await keep.input('/roll banana')).toMatchObject({ cancel: true })
  })

  it('rewrites /me, /ooc, /gm and /time', async () => {
    const s = await runScript(slashCommands)
    expect(await s.input('/me waves')).toBe('*waves*')
    expect(await s.input('/ooc brb')).toBe('(OOC: brb)')
    expect(await s.input('/gm a storm rolls in')).toContain('a storm rolls in')
    expect(await s.input('/time three hours later')).toBe('*(Time passes: three hours later.)*')
    expect(await s.input('/me')).toMatchObject({ cancel: true })
  })

  it('remembers facts without sending', async () => {
    const s = await runScript(slashCommands)
    expect(await s.input('/remember she hates cats')).toMatchObject({ cancel: true })
    expect(s.calls.find((c) => c.method === 'facts.add')?.args).toEqual(['she hates cats', 0.8])
  })

  it('keeps notes and feeds them to the prompt', async () => {
    const s = await runScript(slashCommands)
    expect(await s.context()).toBeNull()
    await s.input('/note the guards are hunting us')
    await s.input('/note keep replies short')
    expect(await s.input('/note')).toMatchObject({ reason: expect.stringContaining('1. the guards') })
    const ctx = await s.context()
    expect(ctx.text).toContain('- keep replies short')
    await s.input('/note remove 1')
    expect((await s.context()).text).not.toContain('guards')
    await s.input('/note clear')
    expect(await s.context()).toBeNull()
  })

  it('blocks unknown commands unless told not to', async () => {
    expect(await (await runScript(slashCommands, { settings: {} })).input('/dance')).toMatchObject({ cancel: true })
    expect(await (await runScript(slashCommands, { settings: { warnUnknown: false } })).input('/dance')).toBeNull()
  })
})

describe('slash commands tool', () => {
  it('exposes roll_dice to the Assistant', async () => {
    const s = await runScript(slashCommands, { random: sequence(0.5) })
    expect(s.tools.roll_dice({ notation: '2d6+1' })).toMatchObject({ total: 9 })
    expect(() => s.tools.roll_dice({ notation: 'banana' })).toThrow('Not a dice expression')
  })
})
