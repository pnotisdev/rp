import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DRIVE_CONFIG,
  DEFAULT_IMPULSES,
  inheritDriveState,
  chaosChance,
  driveLengthBand,
  driveSamplerOverrides,
  driveStatusLines,
  finishDriveTurn,
  formatSilence,
  idlePatienceMs,
  initialDriveState,
  isGated,
  observeUserMessage,
  openingRuts,
  overusedMotifs,
  rollDriveTurn,
  type DriveConfig,
  type DriveState,
  type RollContext,
} from './drive'
import { describeTelemetry } from './telemetry'

const config: DriveConfig = { ...DEFAULT_DRIVE_CONFIG, fixations: ['Gerald the fridge', 'the Big Card'], loves: ['horror games', 'gpu'], boredBy: ['weather'] }
const NOW = 1_700_000_000_000
const obs = (id: string, text: string, extra: Partial<Parameters<typeof observeUserMessage>[2]> = {}) => ({
  id,
  text,
  recentUserTexts: [],
  now: NOW,
  hour: 15,
  ...extra,
})
const ctx = (extra: Partial<RollContext> = {}): RollContext => ({
  kind: 'reply',
  charName: 'Tess',
  userName: 'Kai',
  facts: [],
  warmth: 40,
  hour: 15,
  ...extra,
})
const seq = (...values: number[]) => {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

describe('observeUserMessage', () => {
  it('is idempotent per message id', () => {
    const s0 = initialDriveState(config, NOW)
    const s1 = observeUserMessage(s0, config, obs('m1', 'ok'))
    expect(observeUserMessage(s1, config, obs('m1', 'ok'))).toBe(s1)
  })

  it('short low-effort replies raise boredom, loved topics drop it', () => {
    let s = initialDriveState(config, NOW)
    for (let i = 0; i < 3; i++) s = observeUserMessage(s, config, obs(`m${i}`, 'ok'))
    expect(s.boredom).toBeGreaterThanOrEqual(5)
    s = observeUserMessage(s, config, obs('m9', 'have you ever played any horror games that actually scared you?'))
    expect(s.boredom).toBeLessThan(5)
    expect(s.interest).toBe(3)
  })

  it('distress opens the seriousness gate', () => {
    const s = observeUserMessage(initialDriveState(config, NOW), config, obs('m1', "honestly i'm not okay today"))
    expect(isGated(s)).toBe(true)
    expect(chaosChance(s, config, 'playful')).toBe(0)
  })

  it('a correction bruises her ego and is flagged for this turn', () => {
    const s = observeUserMessage(initialDriveState(config, NOW), config, obs('m1', "that's wrong, it's Canberra"))
    expect(s.corrected).toBe(true)
    expect(s.ego).toBeLessThan(6)
  })

  it('learns from reactions to her last impulse', () => {
    let s: DriveState = { ...initialDriveState(config, NOW), lastImpulseId: 'fake_fact' }
    s = observeUserMessage(s, config, obs('m1', 'lmao what'))
    expect(s.weights.fake_fact).toBeGreaterThan(1)
    s = { ...s, lastImpulseId: 'conspiracy' }
    s = observeUserMessage(s, config, obs('m2', 'ok'))
    expect(s.weights.conspiracy).toBeLessThan(1)
  })

  it('keeps the line that made the player laugh as a running-joke seed', () => {
    const s = observeUserMessage(initialDriveState(config, NOW), config, obs('m1', 'LMAO', {
      lastCharText: '*She squints.* "Adding you to the List. Defended wet fruit, showed no remorse."',
    }))
    expect(s.bits?.[0].text).toBe('Defended wet fruit, showed no remorse.')
    const r = rollDriveTurn({ ...s, boredom: 8 }, { ...config, impulses: DEFAULT_IMPULSES.filter((i) => i.id === 'running_joke') }, ctx({ rng: () => 0 }))
    expect(r.impulse?.line).toContain('Defended wet fruit')
    expect(r.state.bits?.[0].uses).toBe(1)
  })

  it('a new chat inherits learned weights, a few jokes and notes', () => {
    const prev = { ...initialDriveState(config, NOW), weights: { fake_fact: 1.6 }, bits: [{ text: 'a joke that landed', turn: 9, uses: 2 }], turn: 40 }
    const s = inheritDriveState(prev, config, ['Kai hates mornings', 'Kai has a cat named Miso', '', 'x', 'y'])
    expect(s.turn).toBe(0)
    expect(s.weights.fake_fact).toBe(1.6)
    expect(s.bits).toEqual([{ text: 'a joke that landed', turn: 0, uses: 0 }])
    expect(s.inherited).toEqual(['Kai hates mornings', 'Kai has a cat named Miso', 'x'])
    const text = driveStatusLines(s, { charName: 'Tess', userName: 'Kai', kind: 'reply', telemetry: [], roll: { state: s, sincere: false, gated: false } })
    expect(text).toContain('Kai has a cat named Miso')
  })

  it('a long absence wakes her up', () => {
    const s0 = { ...initialDriveState(config, NOW), lastActivityAt: NOW - 3 * 3_600_000 }
    const s1 = observeUserMessage(s0, config, obs('m1', 'hey, I am back from work, long day'))
    expect(s1.energy).toBeGreaterThan(s0.energy)
  })
})

describe('rollDriveTurn', () => {
  it('fires a chaos impulse on a low roll and respects its cooldown', () => {
    const s0 = { ...initialDriveState(config, NOW), boredom: 6 }
    const r1 = rollDriveTurn(s0, config, ctx({ rng: seq(0, 0, 0, 0) }))
    expect(r1.impulse).toBeDefined()
    const id = r1.impulse!.id
    const next = { ...finishDriveTurn(r1.state, { kind: 'reply', now: NOW }), lastChaosTurn: -99 }
    const r2 = rollDriveTurn(next, config, ctx({ rng: seq(0, 0, 0, 0) }))
    expect(r2.impulse?.id).not.toBe(id)
  })

  it('skips fact impulses when there are no facts, and fills them when there are', () => {
    const custom: DriveConfig = { ...config, impulses: [{ id: 'callback', line: 'Bring up: {fact}.', weight: 1, cooldown: 1, needsFact: true }] }
    const s0 = { ...initialDriveState(custom, NOW), boredom: 8 }
    expect(rollDriveTurn(s0, custom, ctx({ rng: seq(0, 0, 0, 0.99) })).impulse).toBeUndefined()
    const r = rollDriveTurn(s0, custom, ctx({ facts: ['Kai hates mornings'], rng: seq(0, 0, 0, 0) }))
    expect(r.impulse?.line).toBe('Bring up: Kai hates mornings.')
  })

  it('stays quiet when gated', () => {
    const s0 = { ...initialDriveState(config, NOW), gateUntilTurn: 3 }
    const r = rollDriveTurn(s0, config, ctx({ rng: () => 0 }))
    expect(r.gated).toBe(true)
    expect(r.impulse).toBeUndefined()
    expect(r.sincere).toBe(false)
  })

  it('idle turns always carry an impulse and wind down after one unanswered line', () => {
    const s0 = initialDriveState(config, NOW)
    const first = rollDriveTurn(s0, config, ctx({ kind: 'idle', silenceMs: 75_000, rng: seq(0.5, 0.5, 0.5) }))
    expect(first.impulse?.id.startsWith('idle_')).toBe(true)
    expect(first.impulse?.line).not.toContain('{')
    const after = finishDriveTurn(first.state, { kind: 'idle', now: NOW })
    const second = rollDriveTurn(after, config, ctx({ kind: 'idle', silenceMs: 150_000 }))
    expect(second.impulse?.id).toBe('idle_wind_down')
  })

  it('a custom idle deck replaces the default one', () => {
    const custom = { ...config, idleImpulses: [{ id: 'idle_doing', line: '{user} has gone quiet for {silence}. {char} texts what she is up to.', weight: 1, cooldown: 2 }] }
    const r = rollDriveTurn(initialDriveState(custom, NOW), custom, ctx({ kind: 'idle', silenceMs: 75_000, rng: seq(0.5, 0.5, 0.5) }))
    expect(r.impulse?.id).toBe('idle_doing')
  })

  it('rotates in a fixation from the pool', () => {
    const r = rollDriveTurn(initialDriveState(config, NOW), config, ctx({ rng: () => 0.99 }))
    expect(config.fixations).toContain(r.state.fixation?.topic)
  })
})

describe('outputs', () => {
  it('maps energy, interest and boredom to a length band', () => {
    const s = initialDriveState(config, NOW)
    expect(driveLengthBand({ ...s, energy: 9, interest: 3, boredom: 0 }, 'reply', false)).toBe('detailed')
    expect(driveLengthBand({ ...s, energy: 2, interest: 0, boredom: 8 }, 'reply', false)).toBe('brief')
    expect(driveLengthBand({ ...s, energy: 9, interest: 3 }, 'idle', false)).toBe('brief')
    expect(driveLengthBand({ ...s, energy: 9, interest: 3, boredom: 0 }, 'reply', false, 'brb getting a snack')).toBe('brief')
    expect(driveLengthBand({ ...s, energy: 9, interest: 3, boredom: 0 }, 'reply', false, 'pizza is good')).toBe('moderate')
  })

  it('writes a compact status block with telemetry and the impulse', () => {
    const s = { ...initialDriveState(config, NOW), fixation: { topic: 'Gerald the fridge', sinceTurn: 0 } }
    const text = driveStatusLines(s, {
      charName: 'Tess',
      userName: 'Kai',
      kind: 'reply',
      telemetry: ['Kai was away 3h 12m before this message'],
      roll: { state: s, sincere: false, gated: false, impulse: { id: 'x', line: 'Invent a rule.' } },
    })
    expect(text).toContain('on her mind: Gerald the fridge')
    expect(text).toContain('never invent others')
    expect(text).toContain('This turn: Invent a rule.')
    expect(text.length).toBeLessThan(600)
  })

  it('cools the sampler on sincere turns and heats it on feral ones', () => {
    const s = initialDriveState(config, NOW)
    expect(driveSamplerOverrides(s, { state: s, sincere: true, gated: false }, { temperature: 1, min_p: 0.05 }).temperature).toBe(0.8)
    const feral = driveSamplerOverrides({ ...s, energy: 9 }, { state: s, sincere: false, gated: false, impulse: { id: 'a', line: 'b' } }, { temperature: 1, min_p: 0.05 })
    expect(feral.temperature).toBe(1.2)
    expect(feral.xtc_probability).toBe(0.4)
    expect(driveSamplerOverrides(s, { state: s, sincere: false, gated: false }, { temperature: 1, min_p: 0.05 })).toEqual({})
  })

  it('detects a fold from a moved summary cutoff', () => {
    let s = finishDriveTurn(initialDriveState(config, NOW), { kind: 'reply', now: NOW, summaryCutoff: 100 })
    expect(s.foldedAtTurn).toBeUndefined()
    s = finishDriveTurn(s, { kind: 'reply', now: NOW, summaryCutoff: 200 })
    expect(s.foldedAtTurn).toBe(2)
  })

  it('waits longer between repeated idle lines', () => {
    const s = initialDriveState(config, NOW)
    expect(idlePatienceMs({ ...s, idleInARow: 1 }, config, () => 0.5)).toBeGreaterThan(idlePatienceMs(s, config, () => 0.5))
  })

  it('flags motifs used in two of her last three replies', () => {
    const replies = ['"Anyway. Adding you to the List."', '"Fine." *loading rings spin*', '"Gerald says hi. Anyway."']
    expect(overusedMotifs(replies, ['Anyway.', 'Anyway', 'the List', 'loading ring', 'Gerald'])).toEqual(['Anyway'])
    expect(overusedMotifs(['"anyways"'], ['Anyway'], 3, 1)).toEqual(['Anyway'])
  })

  it('spots repeated openings and an action-first habit', () => {
    const replies = ['*She leans back.* "Fine."', '*Tess freezes.* "No."', '*She leans back, arms crossed.* "Wow."']
    expect(openingRuts(replies)).toEqual({ repeated: ['she leans'], actionFirst: true })
    expect(openingRuts(['"Hi."', '*She waves.*', '"Okay so."'])).toEqual({ repeated: [], actionFirst: false })
  })

  it('formats silence', () => {
    expect(formatSilence(45_000)).toBe('45 seconds')
    expect(formatSilence(5 * 60_000)).toBe('5 minutes')
    expect(formatSilence(192 * 60_000)).toBe('3h 12m')
  })
})

describe('describeTelemetry', () => {
  it('reports only notable facts', () => {
    const base = { userName: 'Kai', now: NOW, messageCount: 12, date: new Date(2026, 9, 11, 1, 40), clock: true }
    expect(describeTelemetry(base)).toEqual(["it's 1:40 (middle of the night) for Kai"])
    const full = describeTelemetry({ ...base, userGapMs: 3 * 3_600_000, fill: 0.85, swipeIndex: 2, messageCount: 101 })
    expect(full).toContain('Kai was away 3 hours before this message')
    expect(full.some((l) => l.includes('85% full'))).toBe(true)
    expect(full).toContain('Kai rerolled her reply, this is draft 3')
    expect(full).toContain('this chat just passed 100 messages')
  })

  it('a human character only gets the clock, time away and milestones', () => {
    const base = { userName: 'Kai', now: NOW, messageCount: 101, date: new Date(2026, 9, 11, 1, 40), clock: true, human: true }
    const out = describeTelemetry({ ...base, userGapMs: 3 * 3_600_000, fill: 0.9, justFolded: true, swipeIndex: 2, tokensPerSec: 4, modelName: 'gemma' })
    expect(out).toEqual(["it's 1:40 (middle of the night) for Kai", 'Kai was away 3 hours before this message', 'this chat just passed 100 messages'])
  })
})
