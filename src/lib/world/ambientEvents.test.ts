import { describe, expect, it } from 'vitest'
import { WEATHER_KINDS } from './calendar'
import { AMBIENT_EVENT_KINDS, ambientEventGuidance, describeAmbientEvent, selectAmbientEvent, type AmbientEvent } from './ambientEvents'

describe('selectAmbientEvent', () => {
  it('a holiday takes unconditional priority over every other qualifying hook', () => {
    // Day 13 -> getCalendarInfo -> spring, dayOfSeason 14 -> 'First Bloom' (calendar.ts's HOLIDAYS).
    const event = selectAmbientEvent({
      characterId: 'c1',
      day: 13,
      phaseIndex: 0,
      worldId: 'w1',
      goals: ['Something'],
      likes: ['Something else'],
      frequentedLocations: ['The Cafe'],
      weatherPreferences: { loves: [...WEATHER_KINDS] }, // guarantees a weather match too, whatever day 13 actually rolls
    })
    expect(event).toEqual({ kind: 'holiday', detail: 'First Bloom' })
  })

  it('surfaces weather_loved when today\'s weather is one the character loves', () => {
    const event = selectAmbientEvent({
      characterId: 'c1',
      day: 0, // non-holiday (spring, dayOfSeason 1)
      phaseIndex: 0,
      worldId: 'w1',
      weatherPreferences: { loves: [...WEATHER_KINDS] }, // guaranteed match regardless of which weather day 0 rolls
    })
    expect(event?.kind).toBe('weather_loved')
    expect(event?.detail.length).toBeGreaterThan(0)
  })

  it('surfaces weather_hated when today\'s weather is one the character dislikes', () => {
    const event = selectAmbientEvent({
      characterId: 'c1',
      day: 0,
      phaseIndex: 0,
      worldId: 'w1',
      weatherPreferences: { hates: [...WEATHER_KINDS] },
    })
    expect(event?.kind).toBe('weather_hated')
    expect(event?.detail.length).toBeGreaterThan(0)
  })

  it('never surfaces a weather-based hook with no worldId, even with a guaranteed-match preference', () => {
    const event = selectAmbientEvent({
      characterId: 'c1',
      day: 0,
      phaseIndex: 0,
      weatherPreferences: { loves: [...WEATHER_KINDS] },
    })
    expect(event).toBeUndefined()
  })

  it('surfaces routine_absence for a frequented location, with a plausible day-gap', () => {
    const event = selectAmbientEvent({
      characterId: 'c1',
      day: 0,
      phaseIndex: 0,
      frequentedLocations: ['The Bakery', 'The Library'],
    })
    expect(event?.kind).toBe('routine_absence')
    expect(['The Bakery', 'The Library']).toContain(event?.detail)
    expect(event?.daysSinceVisited).toBeGreaterThanOrEqual(5)
    expect(event?.daysSinceVisited).toBeLessThan(18)
  })

  it('does not surface routine_absence for the one frequented location that IS the current scheduled spot', () => {
    const event = selectAmbientEvent({
      characterId: 'c1',
      day: 0, // monday, per getCalendarInfo
      phaseIndex: 0, // morning
      schedule: [{ id: 's1', phase: 'morning', status: 'available', activity: 'Baking', location: 'The Bakery' }],
      frequentedLocations: ['The Bakery'],
    })
    expect(event).toBeUndefined()
  })

  it('surfaces goal_on_mind naming one of the authored goals', () => {
    const event = selectAmbientEvent({
      characterId: 'c1',
      day: 0,
      phaseIndex: 0,
      goals: ['Get into her dream firm', 'Finish the gallery submission'],
    })
    expect(event?.kind).toBe('goal_on_mind')
    expect(['Get into her dream firm', 'Finish the gallery submission']).toContain(event?.detail)
  })

  it('surfaces free_time_interest naming a like when the character is currently free', () => {
    const event = selectAmbientEvent({
      characterId: 'c1',
      day: 0,
      phaseIndex: 0, // no schedule at all -> getCurrentActivity defaults to 'available'
      likes: ['pressed flowers', 'jazz records'],
    })
    expect(event?.kind).toBe('free_time_interest')
    expect(['pressed flowers', 'jazz records']).toContain(event?.detail)
  })

  it('does not surface free_time_interest while the schedule marks the character busy', () => {
    const event = selectAmbientEvent({
      characterId: 'c1',
      day: 0,
      phaseIndex: 0,
      schedule: [{ id: 's1', phase: 'morning', status: 'busy', activity: 'In lecture' }],
      likes: ['pressed flowers'],
    })
    expect(event).toBeUndefined()
  })

  it('returns undefined with nothing authored and no holiday today', () => {
    expect(selectAmbientEvent({ characterId: 'c1', day: 0, phaseIndex: 0 })).toBeUndefined()
  })

  it('is fully deterministic for identical inputs', () => {
    const ctx = { characterId: 'c1', day: 5, phaseIndex: 1, goals: ['A goal'], likes: ['A like'], frequentedLocations: ['A place'] }
    expect(selectAmbientEvent(ctx)).toEqual(selectAmbientEvent(ctx))
  })

  it('draws from more than one qualifying kind across different characters/days, not always the same one', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const event = selectAmbientEvent({
        characterId: `c${i}`,
        day: i,
        phaseIndex: 0,
        goals: ['Goal A'],
        likes: ['Like A'],
        frequentedLocations: ['Place A'],
      })
      if (event) seen.add(event.kind)
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('describeAmbientEvent', () => {
  it('names the holiday and the character', () => {
    const line = describeAmbientEvent('Sumire', { kind: 'holiday', detail: 'First Bloom' })
    expect(line).toContain('First Bloom')
    expect(line).toContain('Sumire')
    expect(line).not.toContain('{{')
  })

  it('names the weather and reaction for weather_loved/weather_hated', () => {
    const loved = describeAmbientEvent('Sumire', { kind: 'weather_loved', detail: 'raining steadily' })
    expect(loved).toContain('raining steadily')
    expect(loved).toContain('loves')
    const hated = describeAmbientEvent('Sumire', { kind: 'weather_hated', detail: 'stormy' })
    expect(hated).toContain('stormy')
    expect(hated).toContain('dislikes')
  })

  it('names the location and day count for routine_absence', () => {
    const line = describeAmbientEvent('Sumire', { kind: 'routine_absence', detail: 'the corner bookstore', daysSinceVisited: 9 })
    expect(line).toContain('the corner bookstore')
    expect(line).toContain('9')
  })

  it('names the goal for goal_on_mind', () => {
    const line = describeAmbientEvent('Sumire', { kind: 'goal_on_mind', detail: 'finishing her thesis' })
    expect(line).toContain('finishing her thesis')
  })

  it('names the interest for free_time_interest', () => {
    const line = describeAmbientEvent('Sumire', { kind: 'free_time_interest', detail: 'pressed flowers' })
    expect(line).toContain('pressed flowers')
  })

  it('never emits a {{char}}/{{user}} macro for any kind — styleGuidance-shaped lines are not macro-substituted', () => {
    for (const kind of AMBIENT_EVENT_KINDS) {
      const line = describeAmbientEvent('Sumire', { kind, detail: 'something specific', daysSinceVisited: 7 })
      expect(line).not.toContain('{{')
    }
  })
})

describe('ambientEventGuidance', () => {
  const EVENT: AmbientEvent = { kind: 'goal_on_mind', detail: 'finishing her thesis' }

  it('returns empty with no event selected', () => {
    expect(ambientEventGuidance({ charName: 'Sumire', characterId: 'c1', chatId: 'chat1', charTurnCount: 10, event: undefined })).toBe('')
  })

  it('returns empty below the minimum turn floor even with an event ready', () => {
    expect(ambientEventGuidance({ charName: 'Sumire', characterId: 'c1', chatId: 'chat1', charTurnCount: 1, event: EVENT })).toBe('')
  })

  it('is deterministic for identical inputs', () => {
    const opts = { charName: 'Sumire', characterId: 'c1', chatId: 'chat1', charTurnCount: 20, event: EVENT }
    expect(ambientEventGuidance(opts)).toBe(ambientEventGuidance(opts))
  })

  it('fires on some turns and not others across a sweep, proving the roll actually gates (not always on, not always off)', () => {
    let sawFire = false
    let sawMiss = false
    for (let turn = 4; turn < 200; turn++) {
      const line = ambientEventGuidance({ charName: 'Sumire', characterId: 'c1', chatId: 'chat1', charTurnCount: turn, event: EVENT })
      if (line) sawFire = true
      else sawMiss = true
      if (sawFire && sawMiss) break
    }
    expect(sawFire).toBe(true)
    expect(sawMiss).toBe(true)
  })

  it('the fired line matches describeAmbientEvent exactly, with no extra wrapping', () => {
    let found: string | undefined
    for (let turn = 4; turn < 200; turn++) {
      const line = ambientEventGuidance({ charName: 'Sumire', characterId: 'c1', chatId: 'chat1', charTurnCount: turn, event: EVENT })
      if (line) {
        found = line
        break
      }
    }
    expect(found).toBe(describeAmbientEvent('Sumire', EVENT))
  })
})
