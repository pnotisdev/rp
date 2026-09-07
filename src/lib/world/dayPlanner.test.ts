import { describe, expect, it } from 'vitest'
import type { ScheduleEntry } from './calendar'
import { buildDayPlannerActivities, dateEventCardForActivity } from './dayPlanner'

function character(overrides: { schedule?: ScheduleEntry[]; frequentedLocations?: string[]; homeLocation?: string; name?: string } = {}) {
  return {
    card: {
      name: overrides.name ?? 'Sumire',
      description: '',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
    },
    schedule: overrides.schedule,
    frequentedLocations: overrides.frequentedLocations,
    homeLocation: overrides.homeLocation,
  }
}

describe('buildDayPlannerActivities', () => {
  it("uses the character's scheduled location for this exact phase when one is authored", () => {
    const activities = buildDayPlannerActivities(
      character({
        schedule: [{ id: '1', phase: 'morning', status: 'available', activity: 'studying', location: 'the library' }],
        frequentedLocations: ['the café'],
        homeLocation: 'her apartment',
      }),
      { currentDay: 0, currentPhaseIndex: 0 }, // morning
    )
    const meet = activities.find((a) => a.id === 'meet')!
    expect(meet.location).toBe('the library')
    expect(meet.label).toBe('Meet Sumire at the library')
  })

  it('falls back to a frequented location when no schedule entry matches the current phase', () => {
    const activities = buildDayPlannerActivities(
      character({ frequentedLocations: ['the café'], homeLocation: 'her apartment' }),
      { currentDay: 0, currentPhaseIndex: 0 },
    )
    expect(activities.find((a) => a.id === 'meet')!.location).toBe('the café')
  })

  it('falls back to homeLocation when no schedule or frequentedLocations are authored', () => {
    const activities = buildDayPlannerActivities(character({ homeLocation: 'her apartment' }), {
      currentDay: 0,
      currentPhaseIndex: 0,
    })
    expect(activities.find((a) => a.id === 'meet')!.location).toBe('her apartment')
  })

  it('leaves Meet location-less (a generic "Meet {name}") when nothing is authored at all', () => {
    const activities = buildDayPlannerActivities(character(), { currentDay: 0, currentPhaseIndex: 0 })
    const meet = activities.find((a) => a.id === 'meet')!
    expect(meet.location).toBeUndefined()
    expect(meet.label).toBe('Meet Sumire')
  })

  it('always offers exactly meet, text, and rest, in that order', () => {
    const activities = buildDayPlannerActivities(character(), { currentDay: 0, currentPhaseIndex: 0 })
    expect(activities.map((a) => a.id)).toEqual(['meet', 'text', 'rest'])
  })

  it('disables meet and text once energy is exhausted, but never rest', () => {
    // Weekday (day 0 is a Monday per calendar.ts) has 3 actions; phaseIndex 3 ('night') leaves 0.
    const activities = buildDayPlannerActivities(character(), { currentDay: 0, currentPhaseIndex: 3 })
    expect(activities.find((a) => a.id === 'meet')!.disabled).toBe(true)
    expect(activities.find((a) => a.id === 'text')!.disabled).toBe(true)
    expect(activities.find((a) => a.id === 'rest')!.disabled).toBeFalsy()
  })

  it('leaves meet and text enabled while energy remains', () => {
    const activities = buildDayPlannerActivities(character(), { currentDay: 0, currentPhaseIndex: 0 })
    expect(activities.find((a) => a.id === 'meet')!.disabled).toBeFalsy()
    expect(activities.find((a) => a.id === 'text')!.disabled).toBeFalsy()
  })
})

describe('dateEventCardForActivity', () => {
  it("builds a 'meet' card mentioning the location, always kind 'hangout' (never 'date')", () => {
    const card = dateEventCardForActivity(
      { id: 'meet', label: 'Meet Sumire at the library', kind: 'hangout', location: 'the library' },
      'Sumire',
    )
    expect(card.kind).toBe('hangout')
    expect(card.title).toBe('Meet Sumire at the library')
    expect(card.description).toContain('the library')
    expect(card.objectiveTitle).toBe('Spend time with Sumire')
  })

  it("builds a 'meet' card with no location mention when none was resolved", () => {
    const card = dateEventCardForActivity({ id: 'meet', label: 'Meet Sumire', kind: 'hangout' }, 'Sumire')
    expect(card.description).not.toContain('undefined')
    expect(card.description).toBe('Sumire spends this part of the day with you.')
  })

  it("builds a 'text' card distinct from 'meet'", () => {
    const card = dateEventCardForActivity({ id: 'text', label: 'Text Sumire', kind: 'hangout' }, 'Sumire')
    expect(card.kind).toBe('hangout')
    expect(card.objectiveTitle).toBe('Check in with Sumire')
    expect(card.description).toContain('text exchange')
  })

  it('never sets a hiddenAgenda-triggering kind or startedAt — startDateEvent owns stamping those', () => {
    const card = dateEventCardForActivity({ id: 'meet', label: 'Meet Sumire', kind: 'hangout' }, 'Sumire')
    expect(card.kind).not.toBe('date')
    expect(card.startedAt).toBeUndefined()
  })
})
