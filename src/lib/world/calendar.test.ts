import { describe, expect, it } from 'vitest'
import {
  DAYS_PER_YEAR,
  advancePhase,
  describePresence,
  describeWeather,
  describeWorldMoment,
  getCalendarInfo,
  getCurrentActivity,
  getEnergyRemaining,
  getMaxEnergyForDay,
  getMoodOfDay,
  getWeather,
  PHASES,
  spendEnergy,
  WEATHER_KINDS,
  type ScheduleEntry,
} from './calendar'

describe('getCalendarInfo', () => {
  it('starts day 0 on spring, day-of-season 1, Monday, no holiday', () => {
    const info = getCalendarInfo(0)
    expect(info).toEqual({ day: 0, season: 'spring', dayOfSeason: 1, weekday: 'monday', holiday: undefined })
  })

  it('every season starts on a Monday', () => {
    for (const seasonStart of [0, 28, 56, 84]) {
      expect(getCalendarInfo(seasonStart).weekday).toBe('monday')
      expect(getCalendarInfo(seasonStart).dayOfSeason).toBe(1)
    }
  })

  it('places each season in order across the 112-day year', () => {
    expect(getCalendarInfo(0).season).toBe('spring')
    expect(getCalendarInfo(27).season).toBe('spring')
    expect(getCalendarInfo(28).season).toBe('summer')
    expect(getCalendarInfo(55).season).toBe('summer')
    expect(getCalendarInfo(56).season).toBe('autumn')
    expect(getCalendarInfo(83).season).toBe('autumn')
    expect(getCalendarInfo(84).season).toBe('winter')
    expect(getCalendarInfo(111).season).toBe('winter')
  })

  it('wraps past the end of the year back to spring day 0', () => {
    expect(getCalendarInfo(DAYS_PER_YEAR)).toEqual(getCalendarInfo(0))
    expect(getCalendarInfo(DAYS_PER_YEAR + 5)).toEqual(getCalendarInfo(5))
  })

  it('wraps negative day numbers correctly instead of producing a negative index', () => {
    expect(getCalendarInfo(-1)).toEqual(getCalendarInfo(DAYS_PER_YEAR - 1))
  })

  it('fires exactly one holiday per season, at the midpoint', () => {
    expect(getCalendarInfo(13).holiday).toBe('First Bloom')
    expect(getCalendarInfo(12).holiday).toBeUndefined()
    expect(getCalendarInfo(14).holiday).toBeUndefined()
    expect(getCalendarInfo(28 + 13).holiday).toBe('Midsummer Night')
    expect(getCalendarInfo(56 + 13).holiday).toBe('Lantern Festival')
    expect(getCalendarInfo(84 + 13).holiday).toBe('Long Night')
  })
})

describe('getWeather / getMoodOfDay', () => {
  it('is deterministic — the same day always produces the same result', () => {
    expect(getWeather('world-1', 40)).toBe(getWeather('world-1', 40))
    expect(getMoodOfDay('char-1', 40)).toBe(getMoodOfDay('char-1', 40))
  })

  it('varies by world/character id, not just by day', () => {
    const results = new Set(['world-a', 'world-b', 'world-c', 'world-d'].map((id) => getWeather(id, 10)))
    expect(results.size).toBeGreaterThan(1)
  })

  it('only ever returns a defined weather kind', () => {
    for (let day = 0; day < DAYS_PER_YEAR; day++) {
      expect(WEATHER_KINDS).toContain(getWeather('w', day))
    }
  })

  it('never picks snow in summer', () => {
    for (let day = 28; day < 56; day++) {
      for (let seed = 0; seed < 20; seed++) {
        expect(getWeather(`world-${seed}`, day)).not.toBe('snow')
      }
    }
  })
})

describe('describeWeather', () => {
  it('has a display string for every weather kind', () => {
    for (const kind of WEATHER_KINDS) {
      expect(describeWeather(kind)).toBeTruthy()
    }
  })
})

describe('advancePhase', () => {
  it('steps through morning -> afternoon -> evening -> night within the same day', () => {
    let state = { day: 5, phaseIndex: 0 }
    for (let i = 1; i < PHASES.length; i++) {
      state = advancePhase(state.day, state.phaseIndex)
      expect(state).toEqual({ day: 5, phaseIndex: i })
    }
  })

  it('rolls over to the next day at morning after night', () => {
    expect(advancePhase(5, PHASES.length - 1)).toEqual({ day: 6, phaseIndex: 0 })
  })
})

describe('getMaxEnergyForDay', () => {
  it('gives 3 actions on a weekday', () => {
    for (const day of [0, 1, 2, 3, 4]) expect(getMaxEnergyForDay(day)).toBe(3)
  })

  it('gives 4 actions on a weekend', () => {
    expect(getMaxEnergyForDay(5)).toBe(4) // Saturday
    expect(getMaxEnergyForDay(6)).toBe(4) // Sunday
  })
})

describe('getEnergyRemaining', () => {
  it('starts the day at the full weekday allowance', () => {
    expect(getEnergyRemaining(0, 0)).toBe(3)
  })

  it('counts down as the phase advances', () => {
    expect(getEnergyRemaining(0, 1)).toBe(2)
    expect(getEnergyRemaining(0, 2)).toBe(1)
  })

  it('floors at 0 rather than going negative', () => {
    expect(getEnergyRemaining(0, 3)).toBe(0)
    expect(getEnergyRemaining(0, 10)).toBe(0)
  })

  it('reflects the weekend bonus action at night', () => {
    expect(getEnergyRemaining(5, 3)).toBe(1)
  })
})

describe('spendEnergy', () => {
  it('steps the phase forward normally while energy remains', () => {
    expect(spendEnergy(0, 0)).toEqual({ day: 0, phaseIndex: 1, slept: false })
    expect(spendEnergy(0, 1)).toEqual({ day: 0, phaseIndex: 2, slept: false })
  })

  it('forces a rollover to next morning once a weekday runs out at night', () => {
    // Monday evening (phase 2), remaining energy 1 — this spend reaches night with 0 left,
    // so it should roll straight on rather than stranding the world at night with nothing to do.
    expect(spendEnergy(0, 2)).toEqual({ day: 1, phaseIndex: 0, slept: true })
  })

  it("lets a weekend's bonus action be spent at night, rolling over naturally", () => {
    // Saturday night (phase 3) still has 1 energy left (weekend max 4) — advancePhase's own
    // night -> next-morning wraparound already lands exactly on the rollover, no forcing needed.
    expect(spendEnergy(5, 3)).toEqual({ day: 6, phaseIndex: 0, slept: true })
  })

  it('never leaves the day sitting at a phase with 0 energy remaining', () => {
    let state = { day: 0, phaseIndex: 0 }
    for (let i = 0; i < 3; i++) {
      const result = spendEnergy(state.day, state.phaseIndex)
      state = { day: result.day, phaseIndex: result.phaseIndex }
      if (i < 2) expect(result.slept).toBe(false)
    }
    expect(state).toEqual({ day: 1, phaseIndex: 0 })
    expect(getEnergyRemaining(state.day, state.phaseIndex)).toBe(3)
  })
})

describe('describeWorldMoment', () => {
  it('mentions the phase, season, weekday, and mood', () => {
    const line = describeWorldMoment({ worldId: 'w1', characterId: 'c1', day: 0, phaseIndex: 0 })
    expect(line).toContain('morning')
    expect(line).toContain('spring')
    expect(line).toContain('monday')
    expect(line).toMatch(/feeling .+ today/)
  })

  it('mentions the holiday on a holiday day', () => {
    const line = describeWorldMoment({ worldId: 'w1', characterId: 'c1', day: 13, phaseIndex: 0 })
    expect(line).toContain('First Bloom')
  })

  it('notes a loved weather kind without dictating the scene', () => {
    // Find a day where this world's weather actually is 'clear', then assert the note appears.
    let day = 0
    while (getWeather('w-loves-clear', day) !== 'clear' && day < DAYS_PER_YEAR) day++
    const line = describeWorldMoment({
      worldId: 'w-loves-clear',
      characterId: 'c1',
      day,
      phaseIndex: 0,
      weatherPreferences: { loves: ['clear'] },
    })
    expect(line).toContain('loves')
  })

  it('omits the preference note when the weather is neither loved nor hated', () => {
    const line = describeWorldMoment({
      worldId: 'w1',
      characterId: 'c1',
      day: 0,
      phaseIndex: 0,
      weatherPreferences: { loves: ['snow'], hates: ['storm'] },
    })
    expect(line).not.toContain('loves')
    expect(line).not.toContain('dislikes')
  })
})

describe('getCurrentActivity', () => {
  it('defaults to available with no schedule at all', () => {
    expect(getCurrentActivity(undefined, 0, 0)).toEqual({ status: 'available' })
    expect(getCurrentActivity([], 0, 0)).toEqual({ status: 'available' })
  })

  it('defaults to available when nothing matches the current phase', () => {
    const schedule: ScheduleEntry[] = [{ id: '1', phase: 'night', status: 'sleeping', activity: 'Asleep' }]
    // day 0 is a Monday; phaseIndex 0 is morning — the entry above only covers night.
    expect(getCurrentActivity(schedule, 0, 0)).toEqual({ status: 'available' })
  })

  it('matches an "every day" entry (no days set) for the right phase', () => {
    const schedule: ScheduleEntry[] = [
      { id: '1', phase: 'morning', status: 'busy', activity: 'Opening the bakery', location: 'Bakery' },
    ]
    expect(getCurrentActivity(schedule, 0, 0)).toEqual({
      status: 'busy',
      activity: 'Opening the bakery',
      location: 'Bakery',
    })
  })

  it('a day-specific entry beats an "every day" entry for the same phase', () => {
    const schedule: ScheduleEntry[] = [
      { id: '1', phase: 'morning', status: 'busy', activity: 'Opening the bakery' },
      { id: '2', phase: 'morning', status: 'traveling', activity: 'Market day in the city', days: ['monday'] },
    ]
    // day 0 is a Monday.
    expect(getCurrentActivity(schedule, 0, 0).activity).toBe('Market day in the city')
    // day 1 is a Tuesday — falls back to the every-day entry.
    expect(getCurrentActivity(schedule, 1, 0).activity).toBe('Opening the bakery')
  })

  it('does not match a day-specific entry on a day it does not cover', () => {
    const schedule: ScheduleEntry[] = [
      { id: '1', phase: 'evening', status: 'busy', activity: 'Weekend shift', days: ['saturday', 'sunday'] },
    ]
    // day 0 (Monday) isn't in the entry's days, and there's no every-day fallback.
    expect(getCurrentActivity(schedule, 0, 2)).toEqual({ status: 'available' })
  })
})

describe('describePresence', () => {
  it('describes a plain status with no activity', () => {
    expect(describePresence({ status: 'sleeping' })).toBe('{{char}} is currently asleep.')
  })

  it('includes the activity and location when present', () => {
    expect(describePresence({ status: 'busy', activity: 'Opening the bakery', location: 'Bakery' })).toBe(
      '{{char}} is currently busy — Opening the bakery at Bakery.',
    )
  })

  it('includes the activity without a location clause when location is unset', () => {
    expect(describePresence({ status: 'traveling', activity: 'Heading to market' })).toBe(
      '{{char}} is currently traveling — Heading to market.',
    )
  })
})
