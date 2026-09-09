import { describe, expect, it } from 'vitest'
import {
  advanceContact,
  contactRegionsFor,
  describeContact,
  isMultiParticipantScene,
  isSceneOwner,
  isSceneParticipant,
  parseObservedContact,
  participantArousal,
  participantClothing,
  SCENE_PLAYER,
  sceneParticipants,
  withParticipant,
  withParticipantArousal,
  withParticipantClothing,
  type ContactEdge,
} from './sceneParticipants'
import type { IntimacyScene } from './intimacyScene'

const scene = (overrides: Partial<IntimacyScene> = {}): IntimacyScene => ({
  phase: 'building',
  activityLabel: 'kissing her neck',
  category: 'kissing_spot',
  updatedAtTurn: 10,
  ...overrides,
})

const NAMES: Record<string, string> = { sumire: 'Sumire', aoi: 'Aoi' }
const nameOf = (id: string) => NAMES[id] ?? id

describe('parseObservedContact', () => {
  it('accepts well-formed contact and de-duplicates it', () => {
    expect(
      parseObservedContact([
        { actor: SCENE_PLAYER, target: 'sumire', region: 'hips' },
        { actor: SCENE_PLAYER, target: 'sumire', region: 'hips' },
      ]),
    ).toEqual([{ actor: SCENE_PLAYER, target: 'sumire', region: 'hips' }])
  })

  it('drops anything that is not a known region', () => {
    expect(parseObservedContact([{ actor: 'a', target: 'b', region: 'elbow' }])).toEqual([])
  })

  it('drops self-contact — the shape a confused judge produces most often', () => {
    expect(parseObservedContact([{ actor: 'sumire', target: 'sumire', region: 'lips' }])).toEqual([])
  })

  it('drops entries with a missing or blank side, and non-objects', () => {
    expect(parseObservedContact([{ target: 'b', region: 'lips' }, { actor: '  ', target: 'b', region: 'lips' }, 42, null])).toEqual([])
  })

  it('is empty for anything that is not an array at all', () => {
    expect(parseObservedContact(undefined)).toEqual([])
    expect(parseObservedContact({ actor: 'a' })).toEqual([])
  })
})

describe('advanceContact', () => {
  it('stamps a new contact with the turn it started', () => {
    expect(advanceContact(undefined, [{ actor: SCENE_PLAYER, target: 'sumire', region: 'hips' }], 7)).toEqual([
      { actor: SCENE_PLAYER, target: 'sumire', region: 'hips', sinceTurn: 7 },
    ])
  })

  it('keeps the original turn for a contact that was already there — the whole point of the graph', () => {
    const prev: ContactEdge[] = [{ actor: SCENE_PLAYER, target: 'sumire', region: 'hips', sinceTurn: 4 }]
    const next = advanceContact(prev, [{ actor: SCENE_PLAYER, target: 'sumire', region: 'hips' }], 9)
    expect(next[0].sinceTurn).toBe(4)
  })

  it('re-stamps a contact that had actually stopped and started again', () => {
    const prev: ContactEdge[] = [{ actor: SCENE_PLAYER, target: 'sumire', region: 'hips', sinceTurn: 4 }]
    const moved = advanceContact(prev, [{ actor: SCENE_PLAYER, target: 'sumire', region: 'neck' }], 9)
    expect(moved).toEqual([{ actor: SCENE_PLAYER, target: 'sumire', region: 'neck', sinceTurn: 9 }])
  })

  it('leaves the graph standing through a turn that described no contact', () => {
    const prev: ContactEdge[] = [{ actor: SCENE_PLAYER, target: 'sumire', region: 'hips', sinceTurn: 4 }]
    expect(advanceContact(prev, [], 9)).toBe(prev)
  })

  it('drops a contact naming someone who is not in the scene', () => {
    const next = advanceContact(
      undefined,
      [
        { actor: SCENE_PLAYER, target: 'sumire', region: 'hips' },
        { actor: 'a-stranger', target: 'sumire', region: 'lips' },
      ],
      3,
      ['sumire'],
    )
    expect(next.map((e) => e.actor)).toEqual([SCENE_PLAYER])
  })

  it('accepts every side when no roster is supplied, rather than filtering everything out', () => {
    expect(advanceContact(undefined, [{ actor: 'anyone', target: 'sumire', region: 'lips' }], 3)).toHaveLength(1)
  })

  it('caps the graph so a runaway read cannot flood the prompt', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ actor: SCENE_PLAYER, target: `c${i}`, region: 'hands' as const }))
    expect(advanceContact(undefined, many, 1).length).toBeLessThanOrEqual(12)
  })
})

describe('contactRegionsFor', () => {
  it("returns only the regions on that participant's own body", () => {
    const contact: ContactEdge[] = [
      { actor: SCENE_PLAYER, target: 'sumire', region: 'hips', sinceTurn: 1 },
      { actor: 'sumire', target: SCENE_PLAYER, region: 'back', sinceTurn: 1 },
      { actor: 'aoi', target: 'sumire', region: 'neck', sinceTurn: 1 },
    ]
    expect(contactRegionsFor(contact, 'sumire').sort()).toEqual(['hips', 'neck'])
    expect(contactRegionsFor(contact, SCENE_PLAYER)).toEqual(['back'])
  })

  it('is empty for someone nobody is touching, and for no graph at all', () => {
    expect(contactRegionsFor([{ actor: 'a', target: 'b', region: 'lips', sinceTurn: 1 }], 'c')).toEqual([])
    expect(contactRegionsFor(undefined, 'sumire')).toEqual([])
  })
})

describe('roster helpers', () => {
  it('treats a scene with no roster as belonging entirely to whoever holds it', () => {
    const s = scene()
    expect(sceneParticipants(s)).toEqual([])
    expect(isSceneOwner(s, 'anyone')).toBe(true)
    expect(isMultiParticipantScene(s)).toBe(false)
    expect(isSceneParticipant(s, 'sumire', 'sumire')).toBe(true)
    expect(isSceneParticipant(s, 'aoi', 'sumire')).toBe(false)
  })

  it('reads the owner off the front of the roster', () => {
    const s = scene({ participants: ['sumire', 'aoi'] })
    expect(isSceneOwner(s, 'sumire')).toBe(true)
    expect(isSceneOwner(s, 'aoi')).toBe(false)
    expect(isMultiParticipantScene(s)).toBe(true)
  })

  it('counts every named participant as in the scene, and nobody else', () => {
    const s = scene({ participants: ['sumire', 'aoi'] })
    expect(isSceneParticipant(s, 'aoi', 'sumire')).toBe(true)
    expect(isSceneParticipant(s, 'rei', 'sumire')).toBe(false)
  })

  it('adds a participant behind the owner, without duplicating one already there', () => {
    expect(withParticipant(scene(), 'aoi', 'sumire')).toEqual(['sumire', 'aoi'])
    expect(withParticipant(scene({ participants: ['sumire', 'aoi'] }), 'aoi', 'sumire')).toEqual(['sumire', 'aoi'])
    expect(withParticipant(scene({ participants: ['sumire', 'aoi'] }), 'rei', 'sumire')).toEqual(['sumire', 'aoi', 'rei'])
  })
})

describe('participant state maps', () => {
  it('round-trips a participant meter without disturbing anyone else', () => {
    const meter = { value: 30, regionExposure: {}, bandSinceTurn: 2 }
    const map = withParticipantArousal({ participantArousal: { rei: meter } }, 'aoi', { ...meter, value: 55 })
    expect(participantArousal({ participantArousal: map }, 'aoi')?.value).toBe(55)
    expect(participantArousal({ participantArousal: map }, 'rei')?.value).toBe(30)
  })

  it('round-trips a participant clothing ledger', () => {
    const map = withParticipantClothing({ participantClothing: {} }, 'aoi', { char: ['top'] })
    expect(participantClothing({ participantClothing: map }, 'aoi')).toEqual({ char: ['top'] })
  })

  it('is undefined for someone with nothing on record, rather than an empty default', () => {
    expect(participantArousal({ participantArousal: {} }, 'aoi')).toBeUndefined()
    expect(participantClothing({}, 'aoi')).toBeUndefined()
  })
})

describe('describeContact', () => {
  it('reads as prose from both directions, naming whose body each contact is on', () => {
    const contact: ContactEdge[] = [
      { actor: SCENE_PLAYER, target: 'sumire', region: 'hips', sinceTurn: 4 },
      { actor: 'sumire', target: SCENE_PLAYER, region: 'back', sinceTurn: 7 },
    ]
    expect(describeContact(contact, nameOf, 7)).toBe("You touching Sumire's hips (3 turns), Sumire touching your back")
  })

  it('names a third participant on both sides, which is the case the flat region list cannot state', () => {
    const contact: ContactEdge[] = [{ actor: 'aoi', target: 'sumire', region: 'inner_thigh', sinceTurn: 5 }]
    expect(describeContact(contact, nameOf, 5)).toBe("Aoi touching Sumire's inner thigh")
  })

  it('is empty with no graph, contributing nothing rather than an empty label', () => {
    expect(describeContact(undefined, nameOf, 3)).toBe('')
    expect(describeContact([], nameOf, 3)).toBe('')
  })
})
